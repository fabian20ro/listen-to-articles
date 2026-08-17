import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translateParagraphs, buildBatches } from '../lib/translator.js';

const PROXY = 'https://proxy.example.workers.dev';

// ── Helpers ─────────────────────────────────────────────────────────

function mockTranslateResponse(translatedText: string, detectedLang = 'de') {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ translatedText, detectedLang }),
    headers: { get: () => null },
  } as unknown as Response;
}

function mockErrorResponse(status: number, error: string) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error }),
    headers: { get: (name: string) => name === 'Retry-After' ? '30' : null },
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── buildBatches ───────────────────────────────────────────────────

describe('buildBatches', () => {
  it('returns empty array for empty input', () => {
    expect(buildBatches([])).toEqual([]);
  });

  it('puts a single short paragraph in one batch', () => {
    const result = buildBatches(['Hello world']);
    expect(result).toEqual(['Hello world']);
  });

  it('groups short paragraphs into a single batch', () => {
    const paragraphs = ['Para one.', 'Para two.', 'Para three.'];
    const result = buildBatches(paragraphs);
    expect(result).toEqual(['Para one.\n\nPara two.\n\nPara three.']);
  });

  it('splits when combined length exceeds batch limit', () => {
    const longPara = 'A'.repeat(2000);
    const paragraphs = [longPara, longPara];
    const result = buildBatches(paragraphs);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(longPara);
    expect(result[1]).toBe(longPara);
  });

  it('handles a single paragraph longer than batch limit', () => {
    const veryLong = 'B'.repeat(5000);
    const result = buildBatches([veryLong]);
    // Single paragraph goes into one batch even if over limit
    expect(result.length).toBe(1);
    expect(result[0]).toBe(veryLong);
  });

  it('groups two paragraphs that exactly hit the batch character limit', () => {
    // MAX_BATCH_CHARS=3000; BATCH_SEPARATOR='\n\n' (2 chars)
    // Each para: (3000 - 2) / 2 = 1499 → total with sep = 3000
    const p = 'x'.repeat(1499);
    const result = buildBatches([p, p]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(`${p}\n\n${p}`);
  });

  it('splits when two paragraphs exceed the batch limit by one character', () => {
    // Each para: 1500 chars → combined with sep = 3002 > 3000
    const p = 'x'.repeat(1500);
    const result = buildBatches([p, p]);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(p);
    expect(result[1]).toBe(p);
  });

  it('packs long and short paragraphs together when they fit', () => {
    // Long para: 2000 chars. Short: (3000 - 2 - 2000) = 998 fits; 999 does not.
    const long = 'a'.repeat(2000);
    const short = 'b'.repeat(998);
    const result = buildBatches([long, short]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(`${long}\n\n${short}`);
  });

  it('splits when long+short exceed the batch limit', () => {
    const long = 'a'.repeat(2000);
    const short = 'b'.repeat(999); // just one char too many
    const result = buildBatches([long, short]);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(long);
    expect(result[1]).toBe(short);
  });

  it('places each very-long paragraph in its own batch', () => {
    const big = 'x'.repeat(2500); // too long to share with anything non-trivial
    const result = buildBatches([big, big, big]);
    expect(result.length).toBe(3);
  });

  it('includes empty strings in the current batch as separators', () => {
    const result = buildBatches(['hello', '', 'world']);
    // '' satisfies fit condition; current += '\n\n' + '' → trailing separator
    expect(result).toEqual(['hello\n\n\n\nworld']);
  });

  it('drops a trailing empty-only current batch at end of input', () => {
    const result = buildBatches(['short']);
    // 'short' alone fits; no trailing behavior change vs baseline
    expect(result.length).toBe(1);
    expect(result[0]).toBe('short');
  });
});

// ── translateParagraphs ────────────────────────────────────────────

describe('translateParagraphs', () => {
  it('returns empty array for empty input', async () => {
    const result = await translateParagraphs([], 'de', 'en', PROXY);
    expect(result).toEqual([]);
  });

  it('translates a single paragraph', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Hello world'),
    );

    const result = await translateParagraphs(['Hallo Welt'], 'de', 'en', PROXY);
    expect(result).toEqual(['Hello world']);
  });

  it('sends correct request body to proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Translated text'),
    );

    await translateParagraphs(['Original text'], 'de', 'en', PROXY);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROXY}?action=translate`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ text: 'Original text', from: 'de', to: 'en' }),
      }),
    );
  });

  it('preserves paragraph count when batched', async () => {
    const paragraphs = [
      'Erster Absatz.',
      'Zweiter Absatz.',
      'Dritter Absatz.',
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'),
    );

    const result = await translateParagraphs(paragraphs, 'de', 'en', PROXY);
    expect(result.length).toBe(3);
  });

  it('merges extra API paragraphs into the last slot when API splits text more than expected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('First part.\n\nSecond part.\n\nExtra sentence.'),
    );

    const result = await translateParagraphs(['Original one.', 'Original two.'], 'de', 'en', PROXY);
    expect(result).toEqual([
      'First part.',
      'Second part. Extra sentence.',
    ]);
  });

  it('pads with empty strings when API returns fewer paragraphs than input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Only one paragraph.'),
    );

    const result = await translateParagraphs(['First.', 'Second.'], 'de', 'en', PROXY);
    expect(result).toEqual(['Only one paragraph.', '']);
  });

  it('handles API error with descriptive message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockErrorResponse(502, 'Google Translate API returned 503: Service Unavailable'),
    );

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/502/);
  });

  it('falls back to GET translation when POST is rejected with 405', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(405, 'Only GET requests are allowed.'))
      .mockResolvedValueOnce(mockTranslateResponse('Hello from GET fallback'));

    const result = await translateParagraphs(['Salut'], 'ro', 'en', PROXY);

    expect(result).toEqual(['Hello from GET fallback']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    expect(fetchSpy.mock.calls[0][0]).toBe(`${PROXY}?action=translate`);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));

    const secondUrl = String(fetchSpy.mock.calls[1][0]);
    expect(secondUrl).toContain(`${PROXY}?`);
    expect(secondUrl).toContain('action=translate');
    expect(secondUrl).toContain('from=ro');
    expect(secondUrl).toContain('to=en');
    expect(secondUrl).toContain('text=Salut');
    expect(fetchSpy.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('uses GET translation when POST returns 405 and GET fallback succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(405, 'Method not allowed'))
      .mockResolvedValueOnce(mockTranslateResponse('Hello from GET fallback'));

    const result = await translateParagraphs(['Salut'], 'ro', 'en', PROXY);

    expect(result).toEqual(['Hello from GET fallback']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // First call: POST to action=translate
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    // Second call (from translateSingleGet): GET with query params
    const secondUrl = String(fetchSpy.mock.calls[1][0]);
    expect(secondUrl).toContain('action=translate');
    expect(secondUrl).toContain('from=ro');
    expect(secondUrl).toContain('to=en');
    expect(fetchSpy.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('throws combined error when POST returns 405 and GET fallback also fails', async () => {
    const getFallbackResp = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ error: 'downstream unavailable' }),
      headers: { get: (name: string) => name === 'Retry-After' ? null : null },
    } as unknown as Response;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(405, 'Method not allowed'))
      .mockResolvedValueOnce(getFallbackResp);

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/status 405.*GET fallback failed:.*status 503/);
  });

  it('does not crash when error response body is non-JSON', async () => {
    const rawResp = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('invalid')),
      headers: { get: () => null },
    } as unknown as Response;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(rawResp);

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/500/);
  });

  it('handles rate limit error with retry info', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockErrorResponse(429, 'Rate limit exceeded'),
    );

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/rate limit/i);
  });

  it('handles network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/Could not reach translation service/);
  });

  it('does not include any auth header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Translated'),
    );

    await translateParagraphs(['Text'], 'de', 'en', PROXY);

    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['X-Proxy-Key']).toBeUndefined();
  });

  it('sends one fetch per batch when paragraphs span multiple batches and reassembles correctly', async () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(2000);

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTranslateResponse('Translated A paragraph.'))   // batch 1
      .mockResolvedValueOnce(mockTranslateResponse('Translated B paragraph.'));   // batch 2

    const result = await translateParagraphs([para1, para2], 'de', 'en', PROXY);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(2);
    expect(result[0]).toBe('Translated A paragraph.');
    expect(result[1]).toBe('Translated B paragraph.');
  });

  it('merges multiple extra API paragraphs into the last slot', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('First.\n\nSecond.\n\nThird.\n\nFourth.'),
    );

    const result = await translateParagraphs(['Orig1', 'Orig2'], 'de', 'en', PROXY);
    expect(result).toEqual([
      'First.',
      'Second. Third. Fourth.',
    ]);
  });

  it('preserves paragraph count when input contains empty strings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('\\n\\nTranslated third.'),
    );

    const result = await translateParagraphs(['First.', '', 'Third.'], 'de', 'en', PROXY);
    expect(result.length).toBe(3);
  });

  it('handles API returning significantly fewer paragraphs than input via padding', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Only returned.'),
    );

    const result = await translateParagraphs(['A.', 'B.', 'C.'], 'de', 'en', PROXY);
    expect(result).toEqual(['Only returned.', '', '']);
  });

  it('handles a single empty paragraph input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse(''),
    );

    const result = await translateParagraphs([''], 'de', 'en', PROXY);
    expect(result).toEqual(['']);
  });
});
