// jsdom intentionally leaves media playback unimplemented. Tests assert calls
// with local spies where behavior matters; the shared baseline prevents noise elsewhere.
if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: {
      configurable: true,
      value: () => Promise.resolve(),
    },
    pause: {
      configurable: true,
      value: () => {},
    },
  });
}

// Stubs for Web Speech API. The TTS backend constructs SpeechSynthesisUtterance
// objects and calls speechSynthesis methods; jsdom has no real implementation.
if (typeof SpeechSynthesis === 'undefined') {
  class FakeSpeechSynthesisUtterance {
    text = '';
    lang = '';
    rate = 1;
    pitch = 1;
    voice: SpeechSynthesisVoice | null = null;
    onstart: ((ev: Event) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
  }

  const fakeSpeechSynthesis = {
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
    getVoices(): SpeechSynthesisVoice[] { return []; },
    get speaking() { return false; },
    get paused() { return false; },
    get pending() { return false; },
  };

  (globalThis as unknown as { SpeechSynthesisUtterance: typeof FakeSpeechSynthesisUtterance }).SpeechSynthesisUtterance = FakeSpeechSynthesisUtterance;
  (globalThis as unknown as { speechSynthesis: typeof fakeSpeechSynthesis }).speechSynthesis = fakeSpeechSynthesis;
}
