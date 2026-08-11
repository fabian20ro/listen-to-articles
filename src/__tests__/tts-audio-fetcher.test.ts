import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTtsAudio } from '../lib/tts-audio-fetcher.js';

describe('fetchTtsAudio', () => {
  const config = { proxyBase: 'https://api.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('returns blob url on success', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBe('blob:url');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on failure and returns null', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null if fetch fails with ok: false', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on permanent 4xx errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    // Only one attempt — permanent error path throws immediately
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 (rate limit) as transient', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    // Two attempts — 429 is treated as transient despite being in 4xx range
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('encodes text and lang params in the fetch URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello & world', 'en-US', config);
    expect(result).toBe('blob:url');
    const [calledUrl] = vi.mocked(fetch).mock.calls[0];
    expect(calledUrl).toContain(encodeURIComponent('hello & world'));
    expect(calledUrl).toContain(encodeURIComponent('en-US'));
    // No space literal — must be percent-encoded
    expect(calledUrl).not.toContain(' ');
  });

  it('treats fetch abort (timeout) as transient and retries', async () => {
    // Stub setTimeout to fire synchronously so the timeout fires immediately,
    // triggering AbortController.abort() without real wall-clock delays.
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (cb: any) => { cb(); return 0; },
    );

    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    // First attempt: setTimeout fires immediately → AbortController.abort() → fetch rejects
    vi.mocked(fetch).mockRejectedValueOnce(abortError);
    // Second attempt: succeeds after retry delay stubbed synchronously
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBe('blob:url');
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('clears the timeout after successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    await fetchTtsAudio('hello', 'en', config);

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('retries once when resp.blob() throws on a successful response and returns null', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (cb: any) => { cb(); return 0; },
    );

    let blobCallCount = 0;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => {
        blobCallCount++;
        throw new Error('corrupt stream');
      },
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(blobCallCount).toBe(2);
    // Verify the retry delay constant is used (stubbed to fire synchronously)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('returns null when both attempts fail transiently', async () => {
    // Stub setTimeout to fire the callback synchronously so await delays resolve immediately — avoids wall-clock flakiness.
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (cb: any) => { cb(); return 0; },
    );

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network error')) // first: transient
      .mockRejectedValueOnce(new Error('Network error')); // second: also transient

    const result = await fetchTtsAudio('hello', 'en', config);

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    // Verify the retry delay constant is used (stubbed to fire synchronously)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('returns null when caller passes already-aborted AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await fetchTtsAudio('hello', 'en', config, controller.signal);
    expect(result).toBeNull();
    // No fetch should have been attempted.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('builds the fetch URL with the correct structure and encoded params', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello world', 'en-US', config);
    expect(result).toBe('blob:url');

    const [calledUrl] = vi.mocked(fetch).mock.calls[0];
    // URL must start with proxyBase + literal /?action=tts separator
    expect(calledUrl).toMatch(
      new RegExp(`^${escapeRegExp(config.proxyBase)}/\\?action=tts&text=.*&lang=.*`),
    );
    // Parameters must be percent-encoded — no raw spaces or special chars
    expect(calledUrl).not.toContain(' ');
    expect(calledUrl).toContain(encodeURIComponent('hello world'));
    expect(calledUrl).toContain(encodeURIComponent('en-US'));
  });

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  it('cancels in-flight fetch when caller aborts signal mid-call', async () => {
    const controller = new AbortController();

    // Stub setTimeout so the retry delay fires synchronously (avoids wall-clock timing).
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (cb: any) => { cb(); return 0; },
    );

    let resolveFetch!: () => void;
    const fetchPromise = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });

    // Make mock actually check the signal and reject with AbortError if aborted.
    vi.mocked(fetch).mockImplementation((_url, init?: any) => {
      if (init?.signal?.aborted) {
        const err = new Error('The user aborted a request.');
        (err as any).name = 'AbortError';
        return Promise.reject(err);
      }
      // Resolve the pending promise so we don't hang on await below.
      resolveFetch();
      return Promise.resolve({ ok: true, blob: async () => new Blob(['audio']) });
    });

    // Kick off the fetch.
    const promise = fetchTtsAudio('hello', 'en', config, controller.signal);

    // Let it start — abort before it resolves.
    controller.abort();

    const result = await promise;
    expect(result).toBeNull();
  });
});
