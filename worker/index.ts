/**
 * Listen to Articles — Cloudflare Worker
 *
 * Implements CORS proxy and REST API for article extraction.
 */

import { DOMParser as LinkedomBaseDOMParser } from 'linkedom';
import { extractArticle } from '../src/lib/extractors/extract-url.js';
import { extractArticleFromYoutube, extractYoutubeVideoId } from '../src/lib/extractors/extract-youtube.js';
import { type Article, UpstreamResponseError } from '../src/lib/extractors/types.js';

export interface Env {
  ALLOWED_ORIGIN: string;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB (HTML articles)
const MAX_PDF_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB (PDF documents)
const MAX_TRANSLATE_CHARS = 5000;
const MAX_TTS_CHARS = 200;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^fd/i, /^localhost$/i, /^::ffff:127\./i, /^::ffff:10\./i, /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, /^::ffff:192\.168\./i, /^::ffff:169\.254\./i, /^::ffff:0\./i, /^\[::1\]$/, /^\[::ffff:/i,
];

const LANG_CODE_RE = /^[a-z]{2,5}(-[a-zA-Z]{2,5})?$/;

const rateLimitMap = new Map<string, number[]>();
let lastCleanup = Date.now();

type ParseFormat = 'markdown' | 'article';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return handleOptions(origin, env.ALLOWED_ORIGIN);
    }

    // Rate limiting
    const rateCheck = applyRateLimit(request);
    if (!rateCheck.allowed) {
      return errorResponse(
        429,
        `Rate limit exceeded. Try again in ${rateCheck.retryAfter} seconds.`,
        env.ALLOWED_ORIGIN,
        { 'Retry-After': String(rateCheck.retryAfter), 'X-RateLimit-Remaining': '0' }
      );
    }
    const remaining = rateCheck.allowed ? rateCheck.remaining ?? 0 : 0;

    // API Route: /parse (Markdown API for AI Agents)
    if (url.pathname === '/parse') {
      return handleParseRequest(request, env, remaining);
    }

    // Action-based Routes (Legacy PWA)
    const action = url.searchParams.get('action');
    if (action === 'translate') return handleTranslate(request, env, remaining);
    if (action === 'tts') return handleTts(request, env, remaining);

    // Default: CORS Proxy for raw content
    if (url.searchParams.has('url')) {
      return handleProxyFetch(url.searchParams.get('url')!, env, remaining);
    }

    return errorResponse(404, 'Not Found', env.ALLOWED_ORIGIN);
  }
};

/** Handle Markdown extraction API. */
async function handleParseRequest(request: Request, env: Env, remaining: number): Promise<Response> {
  let targetUrl: string | null = null;
  let format: ParseFormat = 'markdown';

  if (request.method === 'POST') {
    try {
      const body = await request.json() as { url?: string; format?: ParseFormat };
      targetUrl = body.url || null;
      format = body.format === 'article' ? 'article' : 'markdown';
    } catch {
      return errorResponse(400, 'Invalid JSON body.', env.ALLOWED_ORIGIN);
    }
  } else {
    const params = new URL(request.url).searchParams;
    targetUrl = params.get('url');
    format = params.get('format') === 'article' ? 'article' : 'markdown';
  }

  if (!targetUrl) return errorResponse(400, 'Missing url parameter.', env.ALLOWED_ORIGIN);
  const validated = validateTargetUrl(targetUrl, env.ALLOWED_ORIGIN);
  if (validated instanceof Response) return validated;

  try {
    const article = await parseArticleFromUrl(validated, fetch);

    if (format === 'article') {
      return jsonResponse(article, env.ALLOWED_ORIGIN, {
        'X-Resolved-Url': article.resolvedUrl,
      }, 200, remaining);
    }

    return new Response(article.markdown, {
      status: 200,
      headers: successHeaders(env.ALLOWED_ORIGIN, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Resolved-Url': article.resolvedUrl,
      }, remaining),
    });
  } catch (err: unknown) {
    if (err instanceof UpstreamResponseError) {
      return errorResponse(err.status, err.message, env.ALLOWED_ORIGIN);
    }
    return errorResponse(500, `Extraction failed: ${String(err)}`, env.ALLOWED_ORIGIN);
  }
}

/** Proxy raw content bytes with validation. */
async function handleProxyFetch(targetUrl: string, env: Env, remaining: number): Promise<Response> {
  const validated = validateTargetUrl(targetUrl, env.ALLOWED_ORIGIN);
  if (validated instanceof Response) return validated;

  try {
    const resp = await fetchWithRedirectValidation(validated, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,application/epub+zip;q=0.8,*/*;q=0.7',
      }
    });

    if (!resp.ok) return errorResponse(502, `Upstream returned ${resp.status}`, env.ALLOWED_ORIGIN);

    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) {
      return fetchBinaryResponse(resp, env.ALLOWED_ORIGIN, remaining, 'PDF', 'application/pdf', '%PDF-');
    }
    if (ct.includes('application/epub') || ct.includes('application/epub+zip')) {
      return fetchBinaryResponse(resp, env.ALLOWED_ORIGIN, remaining, 'EPUB', 'application/epub+zip', 'PK\x03\x04');
    }
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return errorResponse(400, 'URL does not point to an HTML page, PDF, or EPUB.', env.ALLOWED_ORIGIN);
    }

    const html = await readTextWithLimit(resp, MAX_RESPONSE_BYTES);
    return new Response(html, {
      status: 200,
      headers: successHeaders(env.ALLOWED_ORIGIN, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Final-URL': resp.url,
      }, remaining),
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return errorResponse(504, 'Upstream request timed out.', env.ALLOWED_ORIGIN);
    }
    return errorResponse(502, `Fetch failed: ${String(err)}`, env.ALLOWED_ORIGIN);
  }
}

async function handleTranslate(request: Request, env: Env, remaining: number): Promise<Response> {
  let text = '';
  let from = 'auto';
  let to = 'en';

  if (request.method === 'POST') {
    const body = await request.json() as any;
    text = body.text;
    from = body.from || 'auto';
    to = body.to || 'en';
  } else {
    const params = new URL(request.url).searchParams;
    text = params.get('text') || '';
    from = params.get('from') || 'auto';
    to = params.get('to') || 'en';
  }

  if (!text || text.length > MAX_TRANSLATE_CHARS) return errorResponse(400, 'Invalid text.', env.ALLOWED_ORIGIN);
  if (!LANG_CODE_RE.test(to)) return errorResponse(400, 'Invalid lang.', env.ALLOWED_ORIGIN);

  const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  
  try {
    const resp = await fetchWithTimeout(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) {
      return errorResponse(502, `Translation API returned ${resp.status}.`, env.ALLOWED_ORIGIN);
    }
    const data = await resp.json() as any;
    const translatedText = data[0].map((s: any) => s[0]).join('');
    const detectedLang = data[2] || from;

    return jsonResponse({ translatedText, detectedLang }, env.ALLOWED_ORIGIN, {
      'Cache-Control': 'no-store',
    }, 200, remaining);
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'Translation request timed out.', env.ALLOWED_ORIGIN);
    }
    return errorResponse(502, 'Translation failed.', env.ALLOWED_ORIGIN);
  }
}

async function handleTts(request: Request, env: Env, remaining: number): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const text = params.get('text') || '';
  const lang = params.get('lang') || 'en';

  if (!text || text.length > MAX_TTS_CHARS) return errorResponse(400, 'Invalid text.', env.ALLOWED_ORIGIN);

  const ttsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  
  try {
    const resp = await fetchWithTimeout(ttsUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) {
      return errorResponse(502, `TTS API returned ${resp.status}.`, env.ALLOWED_ORIGIN);
    }
    return new Response(resp.body, {
      headers: successHeaders(env.ALLOWED_ORIGIN, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      }, remaining),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'TTS request timed out.', env.ALLOWED_ORIGIN);
    }
    return errorResponse(502, 'TTS failed.', env.ALLOWED_ORIGIN);
  }
}

/** Lightweight DOMParser polyfill. */
class LinkedomDOMParser extends LinkedomBaseDOMParser {}

async function fetchWithRedirectValidation(url: string, init: RequestInit = {}) {
  let currentUrl = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetchWithTimeout(currentUrl, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) throw new Error('Redirect without location');
      const next = new URL(loc, currentUrl);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error('Redirect to non-HTTP protocol');
      }
      if (isPrivateHost(next.hostname)) throw new Error('Private IP blocked');
      currentUrl = next.href;
      continue;
    }
    Object.defineProperty(response, 'url', { value: currentUrl, writable: false });
    return response;
  }
  throw new Error('Too many redirects');
}

function applyRateLimit(request: Request) {
  cleanupRateLimitMap();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return { allowed: true, remaining: RATE_LIMIT_MAX - timestamps.length, retryAfter: 0 };
}

function cleanupRateLimitMap() {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_WINDOW_MS) return;
  lastCleanup = now;
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const recent = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (recent.length > 0) {
      rateLimitMap.set(ip, recent);
    } else {
      rateLimitMap.delete(ip);
    }
  }
}

function validateTargetUrl(targetUrl: string, allowedOrigin: string): string | Response {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return errorResponse(400, 'Invalid URL.', allowedOrigin);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return errorResponse(400, 'Only http and https URLs are allowed.', allowedOrigin);
  }
  if (isPrivateHost(parsed.hostname)) {
    return errorResponse(403, 'Access to internal addresses is not allowed.', allowedOrigin);
  }
  return parsed.href;
}

function isPrivateHost(hostname: string) {
  return PRIVATE_IP_PATTERNS.some(re => re.test(hostname));
}

function handleOptions(origin: string | null, allowed: string) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  });
}

function errorResponse(status: number, message: string, allowed: string, extra: Record<string, string> = {}) {
  return jsonResponse({ error: message }, allowed, extra, status);
}

function successHeaders(allowed: string, extra: Record<string, string> = {}, remaining = RATE_LIMIT_MAX): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowed || '*',
    'Access-Control-Expose-Headers': 'Content-Type, X-Final-URL, X-Resolved-Url, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    ...extra,
  };
}

function jsonResponse(
  body: unknown,
  allowed: string,
  extra: Record<string, string> = {},
  status = 200,
  remaining = RATE_LIMIT_MAX,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: successHeaders(allowed, {
      'Content-Type': 'application/json',
      ...extra,
    }, remaining),
  });
}

async function parseArticleFromUrl(url: string, fetcher: typeof fetch): Promise<Article> {
  if (extractYoutubeVideoId(url)) {
    return extractArticleFromYoutube(url, fetcher);
  }

  return extractArticle(url, '', {
    domParserCtor: LinkedomDOMParser as any,
    fetcher,
  });
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error('Response too large.');
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error('Response too large.');
  }

  return new TextDecoder().decode(buffer);
}

async function fetchBinaryResponse(
  response: Response,
  allowedOrigin: string,
  remaining: number,
  label: string,
  contentType: string,
  magicPrefix: string,
): Promise<Response> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_PDF_RESPONSE_BYTES) {
    return errorResponse(400, `${label} too large (>10 MB).`, allowedOrigin);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_RESPONSE_BYTES) {
    return errorResponse(400, `${label} too large (>10 MB).`, allowedOrigin);
  }

  const header = new Uint8Array(buffer, 0, Math.min(magicPrefix.length, buffer.byteLength));
  const magic = String.fromCharCode(...header);
  if (!magic.startsWith(magicPrefix)) {
    return errorResponse(400, `Response claims to be ${label} but has invalid format.`, allowedOrigin);
  }

  return new Response(buffer, {
    status: 200,
    headers: successHeaders(allowedOrigin, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Final-URL': response.url,
    }, remaining),
  });
}
