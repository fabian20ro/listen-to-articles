/**
 * Media Session controller — keeps PWA alive in background on Android.
 *
 * Chrome on Android suspends JavaScript when a PWA goes to background,
 * which kills the speechSynthesis callback chain.  Playing an inaudible
 * <audio> track creates a real media session that Android keeps alive.
 * Registering navigator.mediaSession handlers adds lock-screen controls.
 *
 * Critical for reliability:
 *  - The <audio> element MUST be appended to document.body — Android Chrome
 *    ignores detached audio elements when deciding whether to suspend a page.
 *  - A periodic keep-alive watchdog restarts audio if the browser pauses it.
 *  - The visibilitychange handler re-ensures audio on return from background.
 */

import { createLogger } from './logger.js';

const log = createLogger('MediaSession');
const ICON_192_URL = new URL('./icons/icon-192.png', document.baseURI).href;
const ICON_512_URL = new URL('./icons/icon-512.png', document.baseURI).href;

export interface MediaSessionActions {
  play: () => void;
  pause: () => void;
  stop: () => void;
  nexttrack: () => void;
  previoustrack: () => void;
  seekforward?: () => void;
  seekbackward?: () => void;
  seekto?: (positionSeconds: number) => void;
}

/**
 * Build a blob URL for a 10-second silent WAV (8 kHz, 8-bit, mono).
 * Sample value 128 = zero crossing in unsigned 8-bit PCM = silence.
 * 10 seconds (vs 1 second) reduces loop restarts and is more reliably
 * treated as "real" media by Android Chrome.
 */
function createSilentWavUrl(): string {
  const sampleRate = 8000;
  const durationSeconds = 10;
  const numSamples = sampleRate * durationSeconds;
  const headerSize = 44;
  const dataSize = numSamples;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeStr(8, 'WAVE');

  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample

  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, headerSize).fill(128);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export class MediaSessionController {
  private audio: HTMLAudioElement | null = null;
  private silentUrl: string | null = null;
  private actions: MediaSessionActions | null = null;
  private _active = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // Named handler for proper removal in dispose()
  private readonly _onVisibilityChange: () => void;

  constructor() {
    // When page returns from background, re-ensure silent audio is playing.
    // Android Chrome may pause the audio element when the page goes hidden.
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this._active) {
        if (this.audio && this.audio.paused) {
          Promise.resolve(this.audio.play()).catch((err) => {
            log.warn('Silent audio resume failed on visibility change', err);
          });
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  setActions(actions: MediaSessionActions): void {
    this.actions = actions;
    this.registerHandlers();
  }

  /** Whether the media session is currently active (audio playing). */
  get active(): boolean {
    return this._active;
  }

  /**
   * Start silent audio loop and set media session to "playing".
   * Must be called from a user-gesture call stack (click handler)
   * so the browser allows audio.play().
   */
  activate(title?: string): void {
    // Idempotent: skip if already active with audio in DOM.
    if (this._active && this.audio) return;

    this.ensureAudio();
    if (!this.audio) return;

    this._active = true;
    Promise.resolve(this.audio.play()).catch((err) => {
      log.warn('Silent audio play failed on activate', err);
    });
    this.updateMetadata(title);
    this.setPlaybackState('playing');
    this.startKeepAlive();
  }

  /** Stop silent audio and clear media session. */
  deactivate(): void {
    this._active = false;
    this.stopKeepAlive();
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.setPlaybackState('none');
  }

  updateMetadata(title?: string, subtitle?: string): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Listen to Articles',
      artist: subtitle || 'Listen to Articles',
      artwork: [
        { src: ICON_192_URL, sizes: '192x192', type: 'image/png' },
        { src: ICON_512_URL, sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  /**
   * Update the OS notification seekbar with the current position.
   * Requires duration (total estimated seconds), position (current seconds),
   * and playbackRate.  Wraps in try/catch because setPositionState throws
   * if values are out of range.
   */
  updatePositionState(duration: number, position: number, playbackRate: number): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: Math.max(0, duration),
        position: Math.max(0, Math.min(position, duration)),
        playbackRate: Math.max(0.1, playbackRate),
      });
    } catch (err) {
      log.warn('setPositionState failed', err);
    }
  }

  dispose(): void {
    this.deactivate();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this.silentUrl) {
      URL.revokeObjectURL(this.silentUrl);
      this.silentUrl = null;
    }
    if (this.audio) {
      this.audio.remove();
      this.audio = null;
    }
  }

  private ensureAudio(): void {
    if (this.audio) return;
    this.silentUrl = createSilentWavUrl();
    this.audio = document.createElement('audio');
    this.audio.src = this.silentUrl;
    this.audio.loop = true;
    this.audio.setAttribute('playsinline', '');
    // Append to DOM — Android Chrome requires the element to be in the
    // document for the media session to prevent page suspension.
    document.body.appendChild(this.audio);
  }

  /**
   * Periodic watchdog that restarts the silent audio if the browser paused it.
   * Runs every 5 seconds while the session is active.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this._active && this.audio && this.audio.paused) {
        Promise.resolve(this.audio.play()).catch((err) => {
          log.warn('Keep-alive audio restart failed', err);
        });
      }
    }, 5000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private registerHandlers(): void {
    if (!('mediaSession' in navigator) || !this.actions) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.actions?.play());
    ms.setActionHandler('pause', () => this.actions?.pause());
    ms.setActionHandler('stop', () => this.actions?.stop());
    ms.setActionHandler('nexttrack', () => this.actions?.nexttrack());
    ms.setActionHandler('previoustrack', () => this.actions?.previoustrack());
    ms.setActionHandler('seekforward', () => this.actions?.seekforward?.());
    ms.setActionHandler('seekbackward', () => this.actions?.seekbackward?.());
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) {
        this.actions?.seekto?.(details.seekTime);
      }
    });
  }

  private setPlaybackState(state: MediaSessionPlaybackState): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }
}
