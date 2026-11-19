/**
 * Audio-based TTS backend — fetches MP3 per sentence from the Worker proxy
 * and plays through an <audio> element. Works in background on Android.
 */

import { langToCode, type Language } from './language-config.js';
import { fetchTtsAudio, type TtsAudioFetcherConfig } from './tts-audio-fetcher.js';
import type { TTSBackend, TTSBackendCallbacks } from './tts-backend.js';
import { createLogger } from './logger.js';

const log = createLogger('AudioTTS');

export class AudioTTSBackend implements TTSBackend {
  private audio: HTMLAudioElement | null = null;
  private audioCache = new Map<string, Promise<string | null>>();
  private config: TtsAudioFetcherConfig;
  private lang: Language = 'en';
  private rate = 1.0;

  constructor(config: TtsAudioFetcherConfig) {
    this.config = config;
  }

  speak(
    text: string,
    lang: string,
    rate: number,
    _voice: SpeechSynthesisVoice | null,
    callbacks: TTSBackendCallbacks,
    isValid?: () => boolean,
  ): void {
    this.lang = lang as Language;
    this.rate = rate;
    this.ensureAudio();

    this.fetchAudio(text).then((audioUrl) => {
      const valid = isValid ? isValid() : true;
      if (!valid) return; // stale fetch — abort

      if (!audioUrl) {
        callbacks.onError(true); // fallback to speech
        return;
      }
      this.playAudio(audioUrl, rate, callbacks);
    }).catch((err) => {
      log.warn('Audio fetch/playback failed, falling back to speech', err);
      if (isValid && !isValid()) return;
      callbacks.onError(true);
    });
  }

  pause(): void {
    if (this.audio && !this.audio.paused && this.audio.src) {
      this.audio.pause();
    }
  }

  resume(onNeedsRespeak: () => void): void {
    if (this.audio && this.audio.src && this.audio.paused && this.audio.currentTime > 0) {
      Promise.resolve(this.audio.play()).catch(() => {
        onNeedsRespeak();
      });
    } else {
      onNeedsRespeak();
    }
  }

  cancel(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
  }

  dispose(): void {
    this.cancel();
    this.clearCache();
    if (this.audio) {
      this.audio.remove();
      this.audio = null;
    }
  }

  /** Pre-fetch audio for upcoming sentences (fire-and-forget, populates cache). */
  prefetch(texts: string[], lang: Language): void {
    this.lang = lang;
    for (const text of texts) {
      this.fetchAudio(text);
    }
  }

  /** Clear the audio cache and revoke blob URLs. */
  clearCache(): void {
    for (const p of this.audioCache.values()) {
      p.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    }
    this.audioCache.clear();
  }

  /** Check if this backend is currently playing (audio element has a src). */
  isActive(): boolean {
    return !!(this.audio && this.audio.src && !this.audio.paused);
  }

  /** Check if this backend is paused mid-playback. */
  isPaused(): boolean {
    return !!(this.audio && this.audio.src && this.audio.paused && this.audio.currentTime > 0);
  }

  /** Ensure the <audio> element is created and attached to the DOM. */
  ensureAudio(): void {
    if (this.audio) return;
    this.audio = document.createElement('audio');
    this.audio.setAttribute('playsinline', '');
    document.body.appendChild(this.audio);
  }

  private fetchAudio(text: string): Promise<string | null> {
    const key = `${this.lang}:${text}`;
    const cached = this.audioCache.get(key);
    if (cached) return cached;
    const promise = fetchTtsAudio(text, langToCode(this.lang), this.config);
    this.audioCache.set(key, promise);
    return promise;
  }

  private playAudio(
    url: string,
    rate: number,
    callbacks: TTSBackendCallbacks,
  ): void {
    this.ensureAudio();
    if (!this.audio) return;

    this.audio.src = url;
    this.audio.playbackRate = rate;

    this.audio.onended = () => {
      URL.revokeObjectURL(url);
      callbacks.onEnd();
    };

    this.audio.onerror = () => {
      URL.revokeObjectURL(url);
      callbacks.onError(true); // fallback to speech
    };

    Promise.resolve(this.audio.play()).catch(() => {
      URL.revokeObjectURL(url);
      if (!this.audio || !this.audio.src) return; // canceled/disposed — no fallback speech
      callbacks.onError(true); // fallback to speech
    });
  }
}
