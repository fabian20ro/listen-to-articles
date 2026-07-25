/**
 * TTSBackend interface — abstraction for different TTS playback mechanisms.
 *
 * The TTSEngine orchestrates playback (position tracking, generation counters,
 * dead-man's switch, media session). Backends handle the actual audio output:
 * speaking text, pausing, resuming, and canceling.
 */

/**
 * Callbacks for backend → engine communication.
 * Passed to speak() so the engine can track progress.
 */
export interface TTSBackendCallbacks {
  /** Called when the current sentence finishes playing successfully. */
  onEnd: () => void;
  /**
   * Called on playback error.
   * @param shouldFallback - true if the engine should try the fallback backend
   *
   * Contract: exactly one of `onEnd` or `onError` must be invoked per call to
   * `TTSBackend.speak()`, never both and never neither (unless canceled before
   * speaking begins). Neither callback may throw — backends must guard against
   * engine-side failures inside callbacks.
   */
  onError: (shouldFallback: boolean) => void;
}

export interface TTSBackend {
  /**
   * Speak the given text.
   * Must call callbacks.onEnd() when done, or callbacks.onError() on failure.
   */
  speak(
    text: string,
    lang: string,
    rate: number,
    voice: SpeechSynthesisVoice | null,
    callbacks: TTSBackendCallbacks,
  ): void;

  /** Pause playback. */
  pause(): void;

  /**
   * Resume playback.
   * @param onNeedsRespeak - called if resume fails and the engine should re-speak
   */
  resume(onNeedsRespeak: () => void): void;

  /** Cancel current playback immediately. */
  cancel(): void;

  /** Update playback rate. */
  setRate(rate: number): void;

  /** Clean up resources. */
  dispose(): void;
}
