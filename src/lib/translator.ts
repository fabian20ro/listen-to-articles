import { createLogger } from './logger.js';

const log = createLogger('Translator');

/**
 * Text translation via the CORS proxy's translate endpoint.
 * Batches paragraphs to minimize API calls while staying under per-request limits.
 */

const MAX_BATCH_CHARS = 3000;
const MAX_CONCURRENT = 3;
const BATCH_SEPARATOR = '\n\n';

interface TranslateResponse {
  translatedText: string;
  detectedLang: string;
}

/**
 * Translate an array of paragraphs via the worker's translate endpoint.
 * Returns a translated array with the same length as the input.
 */
export async function translateParagraphs(
  paragraphs: string[],
  sourceLang: string,
  targetLang: string,
  proxyBase: string,
): Promise<string[]> {
  if (paragraphs.length === 0) return [];

  const batches = buildBatches(paragraphs);
  const translated = await translateBatches(batches, sourceLang, targetLang, proxyBase);

  // Flatten translated batches back into individual paragraphs
  const result: string[] = [];
  for (const batch of translated) {
    const parts = batch.split(BATCH_SEPARATOR);
    result.push(...parts);
  }

  // Ensure output length matches input — trim or pad if the API merged/split paragraphs
  if (result.length > paragraphs.length) {
    // API may have split text differently; merge extras into the last expected slot
    while (result.length > paragraphs.length) {
      const extra = result.pop()!;
      result[result.length - 1] += ' ' + extra;
    }
  } else if (result.length < paragraphs.length) {
    // Pad with empty strings (shouldn't happen, but be safe)
    while (result.length < paragraphs.length) {
      result.push('');
    }
  }

  return result;
}

/** Group paragraphs into batches that stay under MAX_BATCH_CHARS. */
export function buildBatches(paragraphs: string[]): string[] {
  const batches: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (current.length === 0) {
      current = p;
    } else if (current.length + BATCH_SEPARATOR.length + p.length <= MAX_BATCH_CHARS) {
      current += BATCH_SEPARATOR + p;
    } else {
      batches.push(current);
      current = p;
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/** Translate batches with concurrency limit. */
async function translateBatches(
  batches: string[],
  sourceLang: string,
  targetLang: string,
  proxyBase: string,
): Promise<string[]> {
  const results: string[] = new Array(batches.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < batches.length) {
      const idx = nextIndex++;
      results[idx] = await translateSingle(batches[idx], sourceLang, targetLang, proxyBase, idx, batches.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, batches.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

const FETCH_TIMEOUT_MS = 10_000;

/** Send a single text chunk to the worker translate endpoint. */
async function translateSingle(
  text: string,
  sourceLang: string,
  targetLang: string,
  proxyBase: string,
  batchIndex?: number,
  batchTotal?: number,
): Promise<string> {
  const batchInfo = batchIndex != null && batchTotal != null
    ? ` (batch ${batchIndex + 1}/${batchTotal})`
    : '';

  let resp: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      resp = await fetch(`${proxyBase}?action=translate`, {
        method: 'POST',
        headers: buildProxyHeaders(true),
        body: JSON.stringify({ text, from: sourceLang, to: targetLang }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach translation service: ${cause}`);
  }

  if (!resp.ok) {
    const detail = await readErrorDetail(resp);

    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      const waitMsg = retryAfter ? ` Try again in ${retryAfter}s.` : '';
      throw new Error(`Translation rate limited${batchInfo}.${waitMsg}${detail ? ' ' + detail : ''}`);
    }
    if (resp.status === 405) {
      log.warn('POST translate rejected with 405, falling back to GET', detail || resp.statusText);
      try {
        return await translateSingleGet(text, sourceLang, targetLang, proxyBase);
      } catch (fallbackErr: unknown) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Translation failed with status ${resp.status}${batchInfo}: ${detail || resp.statusText}. GET fallback failed: ${fallbackMsg}`,
        );
      }
    }

    throw new Error(
      `Translation failed with status ${resp.status}${batchInfo}: ${detail || resp.statusText}`,
    );
  }

  const data: TranslateResponse = await resp.json();
  return data.translatedText;
}

function buildProxyHeaders(includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) headers['Content-Type'] = 'application/json';
  return headers;
}

async function readErrorDetail(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    return body?.error ? String(body.error) : '';
  } catch {
    return '';
  }
}

async function translateSingleGet(
  text: string,
  sourceLang: string,
  targetLang: string,
  proxyBase: string,
): Promise<string> {
  const params = new URLSearchParams({
    action: 'translate',
    text,
    from: sourceLang,
    to: targetLang,
  });

  const resp = await fetch(`${proxyBase}?${params.toString()}`, {
    method: 'GET',
    headers: buildProxyHeaders(),
  });

  if (!resp.ok) {
    const detail = await readErrorDetail(resp);
    throw new Error(`status ${resp.status}: ${detail || resp.statusText}`);
  }

  const data: TranslateResponse = await resp.json();
  return data.translatedText;
}
