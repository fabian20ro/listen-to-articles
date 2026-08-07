/**
 * URL fetch orchestration — detects format (HTML, PDF, EPUB, YouTube) and
 * dispatches to the correct parser.
 */

import {
  type Article,
  MAX_ARTICLE_SIZE,
  MAX_PDF_SIZE,
  PDF_FETCH_TIMEOUT,
  UpstreamResponseError,
} from './types.js';
import { parsePdfFromArrayBuffer } from './extract-pdf.js';
import { parseEpubFromArrayBuffer } from './extract-epub.js';
import { parseArticleFromHtml } from './extract-html.js';

export interface ExtractArticleOptions {
  domParserCtor?: new () => { parseFromString(html: string, type: string): Document };
  onProgress?: (message: string) => void;
  fetcher?: typeof fetch;
}

/**
 * Handle non-OK proxy responses with detailed error messages.
 */
async function handleProxyError(resp: Response): Promise<never> {
  let detail = '';
  try {
    const body = await resp.json();
    if (body.error) detail = body.error;
  } catch { /* ignore parse errors */ }

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('Retry-After');
    const waitMsg = retryAfter ? ` Try again in ${retryAfter} seconds.` : ' Please wait a moment and try again.';
    throw new UpstreamResponseError(429, detail || `Rate limit exceeded — too many requests.${waitMsg}`);
  }
  if (resp.status === 403) {
    throw new UpstreamResponseError(403, detail || 'Proxy rejected the request.');
  }
  throw new UpstreamResponseError(resp.status, detail || `Proxy returned ${resp.status}: ${resp.statusText}`);
}

/** Check if a URL likely points to a PDF based on its path or content-disposition. */
function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Match .pdf at end of pathname (with or without query/fragment)
    const pathPart = parsed.pathname.toLowerCase();
    if (pathPart.endsWith('.pdf') || /\?[^/]*\.pdf/i.test(parsed.search)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Check if a URL likely points to an EPUB based on its path. */
function isEpubUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    // Matches .epub at end AND .epub.<variant> at end (e.g. .epub.noimages, .epub.images)
    return pathname.endsWith('.epub') || /\.epub\.[^/]+$/.test(pathname);
  } catch {
    return false;
  }
}

/** Check if a URL is a YouTube URL. */
export function isYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be') {
      return parsed.pathname.length > 1;
    }
    const isYoutubeHost = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    if (!isYoutubeHost) {
      return false;
    }
    return parsed.pathname.startsWith('/watch')
      || parsed.pathname.startsWith('/embed/')
      || parsed.pathname.startsWith('/shorts/')
      || parsed.pathname.startsWith('/live/')
      || parsed.pathname.startsWith('/v');
  } catch {
    return false;
  }
}

function buildWorkerParseUrl(proxyBase: string): string {
  return `${proxyBase.replace(/\/$/, '')}/parse`;
}

async function extractArticleViaWorkerParse(
  url: string,
  proxyBase: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Article> {
  let resp: Response;

  try {
    resp = await fetcher(buildWorkerParseUrl(proxyBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: 'article' }),
    });
  } catch (err: unknown) {
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  }

  if (!resp.ok) {
    await handleProxyError(resp);
  }

  return await resp.json() as Article;
}

/**
 * Fetch a binary file (PDF or EPUB) via the CORS proxy.
 * Returns the response as an ArrayBuffer with size checks.
 */
async function fetchBinaryViaProxy(
  url: string,
  proxyBase: string,
  onProgress?: (message: string) => void,
  label = 'file',
): Promise<{ buffer: ArrayBuffer; finalUrl: string }> {
  onProgress?.(`Downloading ${label}...`);

  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    if (!resp.ok) {
      await handleProxyError(resp);
    }

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE) {
      throw new Error(`${label} is too large (>10 MB).`);
    }

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_SIZE) {
      throw new Error(`${label} is too large (>10 MB).`);
    }

    const finalUrl = resp.headers.get('X-Final-URL') || resp.url || url;
    return { buffer, finalUrl };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timed out downloading the ${label}. The file may be too large or the connection is slow.`);
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch an article URL and extract readable content.
 * Supports both CORS proxy path (browser) and direct path (worker/AI).
 */
export async function extractArticle(
  url: string,
  proxyBase: string,
  legacySecretOrOptions: string | ExtractArticleOptions = {},
  optionsArg?: ExtractArticleOptions,
): Promise<Article> {
  const targetUrl = url.trim();
  const options = optionsArg
    ?? (typeof legacySecretOrOptions === 'string' ? {} : legacySecretOrOptions);
  const {
    domParserCtor: DOMParserConstructor = globalThis.DOMParser,
    onProgress,
    fetcher = globalThis.fetch,
  } = options;
  const useProxy = proxyBase !== '';

  // YouTube path
  if (isYoutubeUrl(targetUrl)) {
    onProgress?.('Fetching YouTube transcript...');
    if (!useProxy) {
      throw new Error('Direct YouTube extraction is only supported through the worker parse API.');
    }
    return extractArticleViaWorkerParse(targetUrl, proxyBase, fetcher);
  }

  // Fast path: URL clearly ends in .pdf
  if (isPdfUrl(targetUrl)) {
    return useProxy 
      ? extractArticleFromPdfUrl(targetUrl, proxyBase, onProgress)
      : extractArticleFromPdfDirect(targetUrl, onProgress, fetcher);
  }

  // Fast path: URL clearly points to an EPUB
  if (isEpubUrl(targetUrl)) {
    return useProxy
      ? extractArticleFromEpubUrl(targetUrl, proxyBase, DOMParserConstructor, onProgress)
      : extractArticleFromEpubDirect(targetUrl, DOMParserConstructor, onProgress, fetcher);
  }

  onProgress?.('Fetching content...');

  const proxyUrl = useProxy ? `${proxyBase}?url=${encodeURIComponent(targetUrl)}` : targetUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);

  try {
    const resp = await fetcher(proxyUrl, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) {
      if (useProxy) await handleProxyError(resp);
      throw new Error(`Request failed: ${resp.status} ${resp.statusText}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    const finalUrl = resp.headers.get('X-Final-URL') || resp.url || targetUrl;
    const respBuffer = await resp.arrayBuffer();

    // Check magic bytes for PDF fallback
    const header = new Uint8Array(respBuffer.slice(0, 4));
    const isActuallyPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF

    if (contentType.includes('application/pdf') || isActuallyPdf) {
      onProgress?.('Extracting text from PDF...');
      if (respBuffer.byteLength > MAX_PDF_SIZE) throw new Error('PDF is too large (>10 MB).');
      return parsePdfFromArrayBuffer(respBuffer, finalUrl, onProgress);
    }

    if (contentType.includes('application/epub+zip')) {
      onProgress?.('Extracting text from EPUB...');
      return parseEpubFromArrayBuffer(respBuffer, finalUrl, DOMParserConstructor, onProgress);
    }

    if (contentType.includes('application/json')) {
      try {
        const jsonBody = new TextDecoder().decode(respBuffer);
        const parsed = JSON.parse(jsonBody) as Article;
        // Validate required fields — reject incomplete responses early.
        if (!parsed.content && !parsed.markdown) {
          throw new Error('Response is missing article content.');
        }
        return parsed;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON response.';
        throw new Error(`Failed to parse article response from ${targetUrl}: ${msg}`);
      }
    }

    // Fallback to HTML
    const body = new TextDecoder().decode(respBuffer);
    if (body.length > MAX_ARTICLE_SIZE) throw new Error('Article is too large (>2 MB).');

    return parseArticleFromHtml(body, finalUrl, DOMParserConstructor);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out fetching the content. Try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch PDF directly (no proxy). */
async function extractArticleFromPdfDirect(url: string, onProgress?: (message: string) => void, fetcher: typeof fetch = globalThis.fetch): Promise<Article> {
  const resp = await fetcher(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return parsePdfFromArrayBuffer(buffer, resp.url || url, onProgress);
}

/** Fetch EPUB directly (no proxy). */
async function extractArticleFromEpubDirect(url: string, DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document } = globalThis.DOMParser, onProgress?: (message: string) => void, fetcher: typeof fetch = globalThis.fetch): Promise<Article> {
  const resp = await fetcher(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`EPUB fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return parseEpubFromArrayBuffer(buffer, resp.url || url, DOMParserConstructor, onProgress);
}

/**
 * Fetch a PDF via the CORS proxy and extract readable text using pdf.js.
 */
export async function extractArticleFromPdfUrl(
  url: string,
  proxyBase: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  const { buffer, finalUrl } = await fetchBinaryViaProxy(url, proxyBase, onProgress, 'PDF');
  onProgress?.('Extracting text from PDF...');
  return parsePdfFromArrayBuffer(buffer, finalUrl, onProgress);
}

/**
 * Fetch an EPUB via the CORS proxy and extract readable text using JSZip.
 */
export async function extractArticleFromEpubUrl(
  url: string,
  proxyBase: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document } = globalThis.DOMParser,
  onProgress?: (message: string) => void,
): Promise<Article> {
  const { buffer, finalUrl } = await fetchBinaryViaProxy(url, proxyBase, onProgress, 'EPUB');
  onProgress?.('Extracting text from EPUB...');
  return parseEpubFromArrayBuffer(buffer, finalUrl, DOMParserConstructor, onProgress);
}
