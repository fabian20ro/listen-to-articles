/**
 * TTS Audio Fetcher — fetches sentence-level TTS audio from the Worker.
 * Stateless: each call fetches one sentence's audio from the proxy's
 * ?action=tts endpoint and returns a blob URL for <audio> playback.
 * Includes a single retry on transient errors.
 */

const FETCH_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;

export interface TtsAudioFetcherConfig {
  proxyBase: string;
}

/**
 * Fetch TTS audio for a single sentence.
 * Returns a blob URL that can be assigned to audio.src, or null on failure.
 * Retries once on transient errors (network failures, 5xx status, 429).
 */
export async function fetchTtsAudio(
  text: string,
  lang: string,
  config: TtsAudioFetcherConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  // Caller-supplied already-aborted signal: short-circuit.
  if (signal?.aborted) return null;

  try {
    return await attemptFetch(text, lang, config, signal);
  } catch (err) {
    // If it's a permanent error, don't retry.
    if (err instanceof Error && err.message.startsWith('Permanent error')) {
      return null;
    }
    // Transient error (network error, timeout, or non-retryable HTTP status)
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    // If caller aborted during the retry delay, skip the second attempt.
    if (signal?.aborted) return null;
    try {
      return await attemptFetch(text, lang, config, signal);
    } catch {
      return null;
    }
  }
}

async function attemptFetch(
  text: string,
  lang: string,
  config: TtsAudioFetcherConfig,
  callerSignal?: AbortSignal,
): Promise<string | null> {
  const url =
    `${config.proxyBase}/?action=tts` +
    `&text=${encodeURIComponent(text)}` +
    `&lang=${encodeURIComponent(lang)}`;

  const controller = new AbortController();
  // Merge caller-supplied signal so abort propagates to the fetch.
  let onCallerAbort: (() => void) | null = null;
  if (callerSignal) {
    onCallerAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) {
      onCallerAbort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        throw new Error(`Permanent error: ${resp.status}`);
      }
      throw new Error(`Transient error: ${resp.status}`);
    }

    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Permanent error')) {
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (onCallerAbort) callerSignal?.removeEventListener('abort', onCallerAbort as EventListener);
  }
}
