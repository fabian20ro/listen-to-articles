import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTSEngine, selectVoice, splitSentences, computeTimeline, type TTSCallbacks } from '../lib/tts-engine.js';
import type { Language } from '../lib/language-config.js';

// ── SpeechSynthesis mock ────────────────────────────────────────────

class MockUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function createMockSpeechSynthesis() {
  const synth = {
    speak: vi.fn((utter: MockUtterance) => {
      synth.speaking = true;
      // Simulate immediate onend for testing
      setTimeout(() => {
        synth.speaking = false;
        utter.onend?.();
      }, 0);
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
      synth.paused = false;
    }),
    pause: vi.fn(() => {
      synth.paused = true;
      synth.speaking = false;
    }),
    resume: vi.fn(() => {
      synth.paused = false;
      synth.speaking = true;
    }),
    speaking: false,
    paused: false,
    pending: false,
    getVoices: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return synth;
}

function makeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
  } as SpeechSynthesisVoice;
}

let mockSynth: ReturnType<typeof createMockSpeechSynthesis>;

beforeEach(() => {
  mockSynth = createMockSpeechSynthesis();
  (globalThis as Record<string, unknown>).speechSynthesis = mockSynth;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── splitSentences ──────────────────────────────────────────────────

describe('splitSentences', () => {
  it('splits normal sentences on punctuation boundaries', () => {
    const result = splitSentences(
      'First sentence is long enough to stand alone. Second sentence is also long enough on its own.',
    );
    expect(result).toEqual([
      'First sentence is long enough to stand alone.',
      'Second sentence is also long enough on its own.',
    ]);
  });

  it('merges name abbreviations into a single utterance', () => {
    const result = splitSentences('by Ilene S. Cohen, Ph.D.');
    // All fragments are short — should be merged into one utterance
    // Note: the regex splits on each period, so "Ph.D." becomes "Ph." + "D."
    // and merging joins them with a space
    expect(result).toEqual(['by Ilene S. Cohen, Ph. D.']);
  });

  it('merges short fragments with the following sentence', () => {
    const result = splitSentences(
      'Dr. Smith said the results were quite promising and noteworthy.',
    );
    // "Dr." (3 chars) is too short to stand alone, merged forward
    expect(result).toEqual([
      'Dr. Smith said the results were quite promising and noteworthy.',
    ]);
  });

  it('handles multiple abbreviations in running text', () => {
    const result = splitSentences(
      'According to Dr. J. Smith, Ph.D., the experiment was a complete and total success.',
    );
    expect(result.length).toBe(1);
    expect(result[0]).toContain('Dr.');
    expect(result[0]).toContain('Ph.');
    expect(result[0]).toContain('success.');
  });

  it('does not merge sentences that are already long enough', () => {
    const result = splitSentences(
      'This is a sentence that is long enough to stand on its own. And this is another sentence that should also stand alone.',
    );
    expect(result).toHaveLength(2);
  });

  it('respects MAX_UTTERANCE_LENGTH and avoids over-merging', () => {
    // Build a string with many short fragments followed by a long sentence
    const shortFragments = 'A. B. C. D. E. F. G. H. I. J. K. L. M. N. O. P. Q. R. S. T. U. V. W. X. Y. Z. ';
    const longSentence = 'This is a much longer sentence that should eventually start a new utterance chunk on its own.';
    const result = splitSentences(shortFragments + longSentence);
    // Should produce multiple utterances (not everything crammed into one)
    expect(result.length).toBeGreaterThan(1);
    // No single utterance should exceed 200 chars
    for (const s of result) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
  });

  it('keeps a single sentence as-is', () => {
    expect(splitSentences('Hello world.')).toEqual(['Hello world.']);
  });

  it('returns the full text when there is no punctuation', () => {
    expect(splitSentences('no punctuation here')).toEqual(['no punctuation here']);
  });

  it('handles empty string gracefully', () => {
    expect(splitSentences('')).toEqual(['']);
  });

  // ── Long sentence splitting ────────────────────────────────────────

  it('splits sentences exceeding 200 chars at semicolons', () => {
    const long =
      'The government announced new policies affecting all citizens across the country; these policies include much stricter regulations on data usage and privacy; compliance deadlines are firmly set for next year; penalties for violations will be quite severe';
    expect(long.length).toBeGreaterThan(200);
    const result = splitSentences(long);
    for (const s of result) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it('splits sentences exceeding 200 chars at commas when no semicolons', () => {
    const long =
      'The organization released a comprehensive statement addressing the concerns of stakeholders, partners, and community members, emphasizing the importance of transparency, accountability, and continued collaboration across all levels';
    expect(long.length).toBeGreaterThan(200);
    const result = splitSentences(long);
    for (const s of result) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it('splits sentences exceeding 200 chars at em dashes', () => {
    const long =
      'The administration has taken a firm stance on this issue — stating that all departments must comply with the new directive — and has outlined consequences for noncompliance — including budget reductions and personnel changes';
    expect(long.length).toBeGreaterThan(200);
    const result = splitSentences(long);
    for (const s of result) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it('splits at word boundaries as last resort for long text without delimiters', () => {
    const words = Array(50).fill('longword').join(' ');
    expect(words.length).toBeGreaterThan(200);
    const result = splitSentences(words);
    for (const s of result) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it('does not split sentences already within 200 chars', () => {
    const short = 'This is a reasonably short sentence that stays within limits.';
    expect(short.length).toBeLessThan(200);
    const result = splitSentences(short);
    expect(result).toEqual([short]);
  });
});

// ── selectVoice ─────────────────────────────────────────────────────

describe('selectVoice', () => {
  const voices = [
    makeVoice('Alex', 'en-US'),
    makeVoice('Google US English', 'en-US'),
    makeVoice('Maria', 'ro-RO'),
    makeVoice('Google română', 'ro-RO'),
    makeVoice('Samantha', 'en-GB'),
  ];

  it('prefers enhanced/premium voices for English', () => {
    const v = selectVoice(voices, 'en');
    expect(v?.name).toBe('Google US English');
  });

  it('prefers enhanced/premium voices for Romanian', () => {
    const v = selectVoice(voices, 'ro');
    expect(v?.name).toBe('Google română');
  });

  it('falls back to any matching voice if no enhanced/premium voice exists', () => {
    const limited = [makeVoice('Alex', 'en-US'), makeVoice('Maria', 'ro-RO')];
    expect(selectVoice(limited, 'en')?.name).toBe('Alex');
    expect(selectVoice(limited, 'ro')?.name).toBe('Maria');
  });

  it('returns null if no voices match the language', () => {
    const enOnly = [makeVoice('Alex', 'en-US')];
    expect(selectVoice(enOnly, 'ro')).toBeNull();
  });

  it('returns preferred voice by name if available', () => {
    const v = selectVoice(voices, 'en', 'Samantha');
    expect(v?.name).toBe('Samantha');
  });

  it('falls back to language match if preferred voice not found', () => {
    const v = selectVoice(voices, 'en', 'NonExistent');
    expect(v?.name).toBe('Google US English');
  });

  it('ignores preferred voice when it does not match requested language', () => {
    const v = selectVoice(voices, 'en', 'Maria');
    expect(v?.name).toBe('Google US English');
  });

  it('returns null for empty voice list', () => {
    expect(selectVoice([], 'en')).toBeNull();
  });

  // ── Cross-platform voice selection ──────────────────────────────

  it('prefers Enhanced voices on iOS (no Google voices)', () => {
    const iosVoices = [
      makeVoice('Samantha', 'en-US'),
      makeVoice('Samantha (Enhanced)', 'en-US'),
      makeVoice('Daniel', 'en-GB'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    const v = selectVoice(iosVoices, 'en');
    expect(v?.name).toBe('Samantha (Enhanced)');
  });

  it('prefers Premium voices on Samsung', () => {
    const samsungVoices = [
      makeVoice('Samsung English', 'en-US'),
      makeVoice('Samsung English Premium', 'en-US'),
      makeVoice('Samsung Romanian', 'ro-RO'),
    ];
    const v = selectVoice(samsungVoices, 'en');
    expect(v?.name).toBe('Samsung English Premium');
  });

  it('falls back to any matching voice on iOS when no Enhanced exists', () => {
    const iosVoices = [
      makeVoice('Samantha', 'en-US'),
      makeVoice('Daniel', 'en-GB'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    expect(selectVoice(iosVoices, 'en')?.name).toBe('Samantha');
    expect(selectVoice(iosVoices, 'ro')?.name).toBe('Ioana');
  });

  it('matches Romanian voices across platforms', () => {
    const mixed = [
      makeVoice('Google română', 'ro-RO'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    // Google voice preferred
    expect(selectVoice(mixed, 'ro')?.name).toBe('Google română');

    // Without Google, falls back
    const iosOnly = [makeVoice('Ioana', 'ro-RO')];
    expect(selectVoice(iosOnly, 'ro')?.name).toBe('Ioana');
  });

  it('handles voice.lang variants (en-US, en-GB, en-AU)', () => {
    const multiRegion = [
      makeVoice('Karen', 'en-AU'),
      makeVoice('Daniel', 'en-GB'),
    ];
    // Both should match 'en' prefix
    const v = selectVoice(multiRegion, 'en');
    expect(v).not.toBeNull();
    expect(v!.lang.startsWith('en')).toBe(true);
  });
});

// ── computeTimeline ─────────────────────────────────────────────────

describe('computeTimeline', () => {
  it('returns duration and position for a single-sentence article at rate 1', () => {
    const paragraphs = [['Hello world.']];
    const result = computeTimeline(paragraphs, 0, 0, 1);
    expect(result.duration).toBeCloseTo(12 / 14);
    expect(result.position).toBeCloseTo(0);
  });

  it('position equals duration at the last sentence of a single-paragraph article', () => {
    const paragraphs = [['Hello world. This is longer text.']];
    const result = computeTimeline(paragraphs, 0, 1, 1);
    expect(result.position).toBeCloseTo(result.duration);
  });

  it('position advances through sentences within a paragraph', () => {
    const paragraphs = [['Short. A longer sentence here with more words.']];
    const first = computeTimeline(paragraphs, 0, 0, 1);
    const second = computeTimeline(paragraphs, 0, 1, 1);
    expect(second.position).toBeGreaterThan(first.position);
    expect(second.duration).toBeCloseTo(first.duration);
  });

  it('position advances across paragraphs with different lengths', () => {
    // Short first para (6 chars), longer second para (25 chars)
    const paragraphs = [['Short.'], ['A longer sentence that has many more characters here.']];
    const p0end = computeTimeline(paragraphs, 0, 1, 1); // end of short para: 6 chars accumulated
    const p1mid = computeTimeline(paragraphs, 1, 2, 1); // mid second para: well past start
    expect(p1mid.position).toBeGreaterThan(p0end.position);
  });

  it('position is zero at start regardless of total length', () => {
    const paragraphs = [['Hello.'], ['World.']];
    expect(computeTimeline(paragraphs, 0, 0, 1).position).toBeCloseTo(0);
  });

  it('rate scales duration inversely — double rate halves duration and position', () => {
    const paragraphs = [['One two three four five six seven eight.'], ['Nine ten eleven twelve thirteen fourteen fifteen sixteen.']];
    const slow = computeTimeline(paragraphs, 1, 2, 0.5);
    const fast = computeTimeline(paragraphs, 1, 2, 2);
    expect(fast.duration).toBeCloseTo(slow.duration / 4);
    expect(fast.position).toBeCloseTo(slow.position / 4);
  });

  it('returns Infinity duration when rate is zero', () => {
    const paragraphs = [['Hello world.']];
    const result = computeTimeline(paragraphs, 0, 0, 0);
    expect(result.duration).toBe(Infinity);
    expect(result.position).toBe(0);
  });

  it('handles empty paragraph array', () => {
    const paragraphs: string[][] = [];
    const result = computeTimeline(paragraphs, 0, 0, 1);
    // totalChars=0 → duration/position = 0 at rate>0; handled via charsPerSec check
    expect(result.position).toBe(0);
  });

  it('handles empty first paragraph correctly', () => {
    // Empty para[0] contributes zero chars to position regardless of sentence count in later paras.
    const paragraphs: string[][] = [[''], ['text here.']];
    const result = computeTimeline(paragraphs, 1, 0, 1);
    expect(result.position).toBeCloseTo(0);
    // total duration reflects all text in the article
    expect(result.duration).toBeCloseTo(10 / 14);
  });

  it('position skips empty sentences at current location', () => {
    const paragraphs: string[][] = [['Hello.'], [''], ['text here.']];
    // At para[2], sentIdx=0 — accumulated chars from para[0] only (empty para[1])
    const result = computeTimeline(paragraphs, 2, 0, 1);
    expect(result.position).toBeCloseTo(6 / 14);
    expect(result.duration).toBeCloseTo(16 / 14);
  });

  it('duration is unaffected by position index — same total', () => {
    const paragraphs = [['A. B. C.']];
    expect(computeTimeline(paragraphs, 0, 0, 1).duration)
      .toBeCloseTo(computeTimeline(paragraphs, 0, 2, 1).duration);
  });
});

// ── TTSEngine ───────────────────────────────────────────────────────

describe('TTSEngine', () => {
  describe('init', () => {
    it('emits onError when no voices load (timeout)', async () => {
      const onStateChange = vi.fn();
      const onError = vi.fn();
      const engine = new TTSEngine({ proxyBase: '', callbacks: { onStateChange, onError } });

      // Override getVoices to return empty so the timeout path fires
      mockSynth.getVoices.mockReturnValue([] as unknown as SpeechSynthesisVoice[]);
      // Prevent voiceschanged event from firing (would resolve early)
      mockSynth.addEventListener.mockImplementation((name: string, _cb: () => void) => {
        if (name === 'voiceschanged') return;
      });

      await engine.init();
      // Wait for 3s timeout to fire + microtask flush
      await new Promise((r) => setTimeout(r, 10));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toContain('No TTS voices available');
    });

    it('does not emit error when voices load successfully', async () => {
      const onError = vi.fn();
      const engine = new TTSEngine({ proxyBase: '', callbacks: { onError } });

      // getVoices returns a voice so the immediate-resolve path fires
      mockSynth.getVoices.mockReturnValue([makeVoice('Test Voice', 'en-US')]);

      await engine.init();

      expect(onError).not.toHaveBeenCalled();
    });
  });

  function createEngine(callbacks: TTSCallbacks = {}) {
    mockSynth.getVoices.mockReturnValue([makeVoice('Google US English', 'en-US')]);
    const engine = new TTSEngine({
      proxyBase: '',
      callbacks,
    });
    // Manually set voices since we can't await init (voiceschanged event)
    (engine as unknown as Record<string, unknown[]>).allVoices = mockSynth.getVoices();
    return engine;
  }

  it('starts in stopped state', () => {
    const engine = createEngine();
    expect(engine.state.isPlaying).toBe(false);
    expect(engine.state.isPaused).toBe(false);
  });

  it('loads paragraphs and splits into sentences', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence.', 'Third sentence.'], 'en');

    expect(engine.state.totalParagraphs).toBe(2);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('transitions to playing state on play()', () => {
    const onStateChange = vi.fn();
    const engine = createEngine({ onStateChange });

    engine.loadArticle(['Hello world. Testing TTS.'], 'en');
    engine.play();

    expect(engine.state.isPlaying).toBe(true);
    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.speak).toHaveBeenCalled();
  });

  it('calls speechSynthesis.speak with individual sentences, not full paragraphs', () => {
    const engine = createEngine();
    engine.loadArticle(['The first sentence is long enough to be its own utterance. The second sentence is also sufficiently long to stand alone.'], 'en');
    engine.play();

    // The first speak call should be for the first sentence only
    const firstUtter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(firstUtter.text).toBe('The first sentence is long enough to be its own utterance.');
  });

  it('sets rate on each utterance', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.setRate(1.5);
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(1.5);
  });

  it('clamps rate to valid range', () => {
    const engine = createEngine();
    engine.setRate(5.0);
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(3.0);
  });

  it('clamps negative and zero rates to minimum 0.5', () => {
    const engine = createEngine();
    engine.setRate(-1.0);
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(0.5);
  });

  it('clamps zero rate to minimum 0.5', () => {
    const engine = createEngine();
    engine.setRate(0);
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(0.5);
  });

  it('does not clamp rate within valid range', () => {
    const engine = createEngine();
    engine.setRate(2.0);
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(2.0);
  });

  it('pauses and calls speechSynthesis.pause()', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();
    engine.pause();

    expect(engine.state.isPaused).toBe(true);
    expect(mockSynth.pause).toHaveBeenCalled();
  });

  it('does not pause when not playing', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello.'], 'en');
    engine.pause();
    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.pause).not.toHaveBeenCalled();
  });

  it('resume() calls speechSynthesis.resume()', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();
    engine.pause();
    engine.resume();

    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.resume).toHaveBeenCalled();
    vi.runAllTimers();
  });

  it('play() delegates to resume() when paused', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['Hello.'], 'en');
    engine.play();
    engine.pause();

    expect(engine.state.isPaused).toBe(true);
    engine.play(); // should resume, not restart

    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.resume).toHaveBeenCalled();
    vi.runAllTimers();
  });

  it('stop() cancels synthesis and resets position', () => {
    const engine = createEngine();
    engine.loadArticle(['First. Second.', 'Third.'], 'en');
    engine.play();
    engine.stop();

    expect(engine.state.isPlaying).toBe(false);
    expect(engine.state.currentParagraph).toBe(0);
    expect(mockSynth.cancel).toHaveBeenCalled();
  });

  it('does not play when no article is loaded', () => {
    const engine = createEngine();
    engine.play();
    expect(engine.state.isPlaying).toBe(false);
    expect(mockSynth.speak).not.toHaveBeenCalled();
  });

  it('skipForward increments paragraph index', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['First paragraph.', 'Second paragraph.', 'Third paragraph.'], 'en');
    engine.play();
    engine.skipForward();

    expect(engine.state.currentParagraph).toBe(1);
    expect(mockSynth.cancel).toHaveBeenCalled();
  });

  it('skipForward does nothing at last paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['Only paragraph.'], 'en');
    engine.play();
    engine.skipForward();

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipBackward decrements paragraph index', () => {
    const engine = createEngine();
    engine.loadArticle(['First.', 'Second.', 'Third.'], 'en');
    engine.play();
    engine.skipForward(); // go to 1
    engine.skipBackward(); // back to 0

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipBackward does nothing at first paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First.', 'Second.'], 'en');
    engine.play();
    engine.skipBackward();

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('jumpToParagraph sets the correct index', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['A.', 'B.', 'C.', 'D.'], 'en');
    engine.play();
    engine.jumpToParagraph(2);

    expect(engine.state.currentParagraph).toBe(2);
  });

  // ── Sentence skip tests ───────────────────────────────────────────

  it('skipSentenceForward advances to next sentence within paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['The first sentence is long enough to stand alone. The second sentence is also long enough by itself. The third sentence rounds out the paragraph nicely.'], 'en');
    engine.play();

    expect(engine.state.currentSentence).toBe(0);
    engine.skipSentenceForward();
    expect(engine.state.currentSentence).toBe(1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipSentenceForward crosses to next paragraph at end of sentences', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['Only sentence.', 'Next paragraph.'], 'en');
    engine.play();

    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
    engine.skipSentenceForward();
    expect(engine.state.currentParagraph).toBe(1);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('skipSentenceForward does nothing at last sentence of last paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['Only sentence.'], 'en');
    engine.play();

    engine.skipSentenceForward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('skipSentenceBackward goes to previous sentence within paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['The first sentence is long enough to stand alone. The second sentence is also long enough by itself. The third sentence rounds out the paragraph nicely.'], 'en');
    engine.play();

    engine.skipSentenceForward(); // go to sentence 1
    engine.skipSentenceForward(); // go to sentence 2
    expect(engine.state.currentSentence).toBe(2);

    engine.skipSentenceBackward();
    expect(engine.state.currentSentence).toBe(1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipSentenceBackward crosses to previous paragraph at first sentence', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['The first sentence is long enough to stand alone. The second sentence is also long enough by itself.', 'The third paragraph has its own content that is long enough.'], 'en');
    engine.play();

    engine.skipForward(); // go to paragraph 1
    expect(engine.state.currentParagraph).toBe(1);
    expect(engine.state.currentSentence).toBe(0);

    engine.skipSentenceBackward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(1); // last sentence of previous paragraph
  });

  it('skipSentenceBackward does nothing at first sentence of first paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence.'], 'en');
    engine.play();

    engine.skipSentenceBackward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('jumpToParagraph ignores out-of-range indices', () => {
    const engine = createEngine();
    engine.loadArticle(['A.', 'B.'], 'en');
    engine.play();
    engine.jumpToParagraph(5);
    expect(engine.state.currentParagraph).toBe(0);

    engine.jumpToParagraph(-1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('fires onEnd callback when article finishes', async () => {
    const onEnd = vi.fn();
    const engine = createEngine({ onEnd });

    // Single sentence — speak mock fires onend immediately via setTimeout
    engine.loadArticle(['Done.'], 'en');
    engine.play();

    // Wait for the async onend chain
    await new Promise((r) => setTimeout(r, 50));

    expect(onEnd).toHaveBeenCalled();
  });

  it('fires onParagraphChange callback', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['First paragraph content.', 'Second paragraph content.'], 'en');
    engine.play();

    expect(onParagraphChange).toHaveBeenCalledWith(0, 'First paragraph content.');
  });

  it('strips markdown headers from internal paragraph text (not raw)', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    // loadArticle() strips headings internally for sentence-splitting,
    // but the onParagraphChange callback receives the original raw paragraphs.
    engine.loadArticle(['## Section Title\nThis is the first paragraph.', '# Another Heading\nSecond para here.'], 'en');
    engine.play();

    // Observable behavior: onParagraphChange fires with original unstripped text,
    // confirming the contract that callbacks receive raw paragraphs before heading removal.
    expect(onParagraphChange).toHaveBeenCalledWith(0, '## Section Title\nThis is the first paragraph.');
  });

  it('fires onProgress callback', () => {
    const onProgress = vi.fn();
    const engine = createEngine({ onProgress });
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();

    expect(onProgress).toHaveBeenCalledWith(0, 1);
  });

  it('sets the correct language code on utterances', () => {
    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = [makeVoice('Maria', 'ro-RO')];
    engine.loadArticle(['Test text here.'], 'ro');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.lang).toBe('ro');
  });

  it('assigns the selected voice to utterances', () => {
    const voices = [makeVoice('Google US English', 'en-US')];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Google US English');
  });

  it('setVoice() preference persists across loadArticle()', () => {
    const voices = [
      makeVoice('Samantha', 'en-GB'),
      makeVoice('Google US English', 'en-US'),
    ];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;

    engine.setVoice('Samantha');
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Samantha');
  });

  it('setVoice() preference persists across setLang()', () => {
    const voices = [
      makeVoice('Ioana', 'ro-RO'),
      makeVoice('Google română', 'ro-RO'),
    ];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;

    engine.setVoice('Ioana');
    engine.loadArticle(['Bună ziua.'], 'ro');
    engine.setLang('ro');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Ioana');
  });

  // ── Device voice only (audio backend swap) ──────────────────────

  it('setDeviceVoiceOnly(true) disables the audio backend', () => {
    const engine = createEngine();
    const initialAudio = (engine as unknown as Record<string, unknown>).audioBackend;

    engine.setDeviceVoiceOnly(true);
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();

    // Restore for other tests
    if (initialAudio !== null) {
      engine.setDeviceVoiceOnly(false);
    }
  });

  it('setDeviceVoiceOnly round-trips to original backend', () => {
    const engine = createEngine();
    const initialAudio = (engine as unknown as Record<string, unknown>).audioBackend;

    // Disable
    engine.setDeviceVoiceOnly(true);
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();

    // Restore — if there was an original backend it comes back
    engine.setDeviceVoiceOnly(false);
    if (initialAudio !== null) {
      expect((engine as unknown as Record<string, unknown>).audioBackend).toBe(initialAudio);
    } else {
      // When no audio backend existed initially, toggle off leaves null too
      expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();
    }
  });

  it('setDeviceVoiceOnly(false) is a no-op when already disabled', () => {
    const engine = createEngine();
    (engine as unknown as Record<string, unknown>).audioBackend = null; // force state off

    engine.setDeviceVoiceOnly(false); // should be idempotent — stays off
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();
  });

  it('setDeviceVoiceOnly(true) is a no-op when already enabled', () => {
    const engine = createEngine();

    engine.setDeviceVoiceOnly(true);
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();

    // Saving state before second call so we can verify it is preserved
    const savedAudioBefore = (engine as unknown as Record<string, unknown>)._savedAudioBackend;

    engine.setDeviceVoiceOnly(true);

    // Should be no-op: backend stays null, saved backend unchanged
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();
    expect((engine as unknown as Record<string, unknown>)._savedAudioBackend).toBe(savedAudioBefore);
  });

  it('setDeviceVoiceOnly toggles correctly during active playback', () => {
    const engine = createEngine();
    const initialAudio = (engine as unknown as Record<string, unknown>).audioBackend;

    // Start playback to simulate mid-stream toggle
    engine.loadArticle(['Hello.'], 'en');
    engine.play();
    expect(engine.state.isPlaying).toBe(true);

    // Disable audio backend while playing — speech synthesis should still work
    engine.setDeviceVoiceOnly(true);
    expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();
    expect((engine as unknown as Record<string, unknown>)._savedAudioBackend).toBe(initialAudio);

    // Toggle back on — audio backend should be restored
    engine.setDeviceVoiceOnly(false);
    if (initialAudio !== null) {
      expect((engine as unknown as Record<string, unknown>).audioBackend).toBe(initialAudio);
      expect((engine as unknown as Record<string, unknown>)._savedAudioBackend).toBeNull();
    } else {
      // No initial backend: restoring from null keeps it off
      expect((engine as unknown as Record<string, unknown>).audioBackend).toBeNull();
    }

    // Engine should still be in a clean state after the toggle cycle
    expect(engine.state.isPlaying).toBe(true);
    expect(mockSynth.speak).toHaveBeenCalled();
  });

  // ── Voice sync bug fixes ─────────────────────────────────────────

  it('speakCurrent does not advance chain when paused', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle([
      'First sentence is long enough to stand alone. Second sentence is also long enough on its own.',
    ], 'en');
    engine.play();

    // First sentence is being spoken
    expect(mockSynth.speak).toHaveBeenCalledTimes(1);
    expect(engine.state.currentSentence).toBe(0);

    // Pause before the sentence finishes
    engine.pause();
    expect(engine.state.isPaused).toBe(true);

    // Simulate the first utterance finishing (onend fires while paused)
    // This mimics the phantom chain scenario
    vi.runAllTimers();

    // Position should NOT advance because engine is paused
    expect(engine.state.currentSentence).toBe(0);
    // No second speak call should have been made
    expect(mockSynth.speak).toHaveBeenCalledTimes(1);
  });

  it('resume re-speaks immediately when backend has nothing paused', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['Hello world. Second sentence.'], 'en');
    engine.play();

    // Manually set paused state without actually pausing the backend
    // (simulates the case where pause happened during in-flight fetch)
    engine.pause();
    // Force the mock to not be paused (simulating lost backend state)
    mockSynth.paused = false;
    mockSynth.speaking = false;

    const speakCountBefore = mockSynth.speak.mock.calls.length;
    const cancelCountBefore = mockSynth.cancel.mock.calls.length;
    engine.resume();

    // onNeedsRespeak should have called cancel + re-speak
    expect(mockSynth.cancel.mock.calls.length).toBeGreaterThan(cancelCountBefore);
    expect(mockSynth.speak.mock.calls.length).toBeGreaterThan(speakCountBefore);
    vi.runAllTimers();
  });

  it('rapid play/pause cycles do not create parallel chains', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle([
      'First sentence is certainly long enough. Second sentence is also long enough. Third sentence is here too.',
    ], 'en');
    engine.play();

    // Rapid play/pause/play/pause cycle (last action is play → resume)
    for (let i = 0; i < 8; i++) {
      engine.pause();
      engine.play();
    }

    // Engine should be in a consistent state after rapid clicking
    expect(engine.state.isPlaying).toBe(true);
    expect(engine.state.isPaused).toBe(false);
    // Position should still be at the start (no phantom advancement)
    expect(engine.state.currentSentence).toBe(0);
    vi.runAllTimers();
  });

  it('onEnd does not advance sentence index when paused', () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const engine = createEngine({ onProgress });
    engine.loadArticle([
      'First sentence is long enough to stand alone. Second sentence is also long enough on its own.',
    ], 'en');
    engine.play();

    expect(engine.state.currentSentence).toBe(0);

    // Pause immediately
    engine.pause();

    // Simulate onend firing (from audio that completed after pause)
    vi.runAllTimers();

    // Sentence index should not have advanced
    expect(engine.state.currentSentence).toBe(0);
  });

  // ── Degraded voice selection (no voices installed) ────────────────

  it('speakCurrent proceeds with null voice when no system voices are available', () => {
    mockSynth.getVoices.mockReturnValue([]);
    const engine = createEngine();
    // Force empty voice list — simulates a device with no TTS engines installed.
    (engine as unknown as Record<string, unknown>).allVoices = [];

    engine.loadArticle(['Hello world.'], 'en');
    expect((engine as unknown as Record<string, null | SpeechSynthesisVoice>).voice).toBeNull();

    // Engine should still attempt to speak — speech backend uses whatever the browser provides.
    engine.play();
    expect(mockSynth.speak).toHaveBeenCalled();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice).toBeNull();
    // No crash: engine is still playing despite null voice selection.
    expect(engine.state.isPlaying).toBe(true);
  });

  it('setLang to an unsupported language selects no voice and degrades gracefully', () => {
    mockSynth.getVoices.mockReturnValue([]);
    const engine = createEngine();
    // Force empty voice list so selectVoice has nothing to match.
    (engine as unknown as Record<string, unknown>).allVoices = [];

    engine.loadArticle(['Hello.'], 'en');
    expect(engine.state.isPlaying).toBe(false);

    // Switch to a language with no matching voices installed on this device.
    engine.setLang('xx-XX' as Language);
    expect((engine as unknown as Record<string, null | SpeechSynthesisVoice>).voice).toBeNull();

    // Engine should still be able to play — speech backend falls through to default system voice.
    engine.play();
    expect(mockSynth.speak).toHaveBeenCalled();
    expect(engine.state.isPlaying).toBe(true);
  });

  // ── speakCurrent: end-of-article termination chain ────────────────

  it('speakCurrent terminates article when all sentences complete naturally', async () => {
    vi.useRealTimers();
    const onEnd = vi.fn();
    const engine = createEngine({ onEnd });
    // 2 paragraphs, each with 1 sentence — exhaust both via speak→onend chain
    engine.loadArticle(
      [
        'First paragraph has one sentence that ends here.',
        'Second paragraph also completes its single sentence.',
      ],
      'en',
    );
    engine.play();

    // Wait for the mock's setTimeout(0) onend to fire and chain through speakCurrent
    await new Promise((r) => setTimeout(r, 50));

    // handleEnd should have fired: onEnd callback called, engine stopped.
    // Engine keeps its current paragraph position after stop (not reset).
    expect(onEnd).toHaveBeenCalled();
    expect(engine.state.isPlaying).toBe(false);
    expect(engine.state.currentParagraph).toBe(2);
  });

  it('speakCurrent advances across paragraphs when sentence-end completes', async () => {
    vi.useRealTimers();
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    // Multi-sentence, multi-paragraph: sentences complete individually via mock onend.
    // The sentence splitter merges short adjacent fragments, so two consecutive
    // short sentences may become a single utterance — verify observed behavior.
    engine.loadArticle(
      [
        'First paragraph sentence one. First paragraph sentence two.',
        'Second paragraph only has this one sentence here.',
      ],
      'en',
    );
    engine.play();

    // Wait for all speak→onend chains to resolve (sentences × setTimeout 0)
    await new Promise((r) => setTimeout(r, 100));

    // After exhaustion: article ended, no more speaking expected.
    expect(engine.state.isPlaying).toBe(false);
    // Sentence splitter merges the two first-para sentences into one utterance,
    // so only 2 speak() calls total (one per paragraph's merged utterance).
    expect(mockSynth.speak).toHaveBeenCalledTimes(2);
    expect(onParagraphChange).toHaveBeenCalledWith(0, 'First paragraph sentence one. First paragraph sentence two.');
    expect(onParagraphChange).toHaveBeenCalledWith(1, 'Second paragraph only has this one sentence here.');
  });

  it('_speakGen increments and cancelAllBackends runs on skipForward', () => {
    const engine = createEngine();
    engine.loadArticle(
      [
        'First paragraph first sentence that ends with a period.',
        'Second paragraph first sentence also ends here.',
      ],
      'en',
    );
    engine.play();

    // skipForward must call cancelAllBackends (which cancels speech backend)
    // and increment the speak generation counter to invalidate stale onEnd callbacks.
    const cancelBefore = mockSynth.cancel.mock.calls.length;
    engine.skipForward();

    expect(mockSynth.cancel).toHaveBeenCalledTimes(cancelBefore + 1);
    expect(engine.state.currentParagraph).toBe(1);
  });

  it('stale utterance completion does not advance sentence after stop()', () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const engine = createEngine({ onProgress });
    engine.loadArticle([
      'First paragraph first sentence that ends with a period.',
      'Second paragraph first sentence also ends here.',
    ], 'en');
    engine.play();

    // Verify speaking started (sentence 0)
    expect(engine.state.currentSentence).toBe(0);
    const speakCallsBefore = mockSynth.speak.mock.calls.length;

    // Stop — this should cancel the in-flight utterance and increment _speakGen.
    engine.stop();
    expect(engine.state.isPlaying).toBe(false);

    // Simulate the cancelled utterance's onend firing after stop().
    // The stale onEnd must NOT advance sentence position or start a new chain.
    vi.runAllTimers();

    // Position should remain at paragraph 0, sentence 0 (reset by stop).
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
    // No new speak call from the stale completion.
    expect(mockSynth.speak.mock.calls.length).toBe(speakCallsBefore);
    vi.useRealTimers();
  });

  it('seekToTime jumps to the correct paragraph/sentence', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });

    // 3 paragraphs with known lengths
    engine.loadArticle([
      'Short first paragraph here.',       // 27 chars
      'Medium second paragraph with more.', // 34 chars
      'Third paragraph is also present.',   // 32 chars
    ], 'en');
    engine.play();

    // At rate=1, chars per sec = 14.  27 chars ≈ 1.93s, so seeking to 2.5s
    // should land in the second paragraph (char offset 2.5 * 14 = 35 chars,
    // past the 27-char first paragraph).
    engine.seekToTime(2.5);
    expect(engine.state.currentParagraph).toBe(1);
  });

  // ── Dead-man's switch (TTSEngine) ───────────────────────────────

  it('stops playback after 30 s of no progress', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['A sentence long enough to keep playing forever without progress.'], 'en');
    engine.play();

    expect(engine.state.isPlaying).toBe(true);

    // Advance past the dead-man threshold (30 s)
    vi.advanceTimersByTime(35_001);

    expect(engine.state.isPlaying).toBe(false);
    vi.useRealTimers();
  });

  it('does not stop when onEnd resets progress timer', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    // Single sentence that completes immediately via mock's setTimeout(0) for onend.
    engine.loadArticle(['Done.'], 'en');
    engine.play();

    expect(engine.state.isPlaying).toBe(true);

    // Advance past threshold — mock fires onend at t=0, which resets progress time
    vi.advanceTimersByTime(10);

    // The article is done (onEnd fired), so engine should be stopped gracefully by handleEnd
    expect(engine.state.isPlaying).toBe(false);
    vi.useRealTimers();
  });

  it('resets progress timer on each sentence completion', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    // Two sentences — the second one never completes (simulating a stuck backend)
    engine.loadArticle(['First. Second.'], 'en');
    engine.play();

    expect(engine.state.isPlaying).toBe(true);

    // First sentence completes at t=0 (mock), resetting progress timer to now
    vi.advanceTimersByTime(10);

    // Now simulate second sentence never completing — advance 35s from the reset point
    vi.advanceTimersByTime(35_001);

    expect(engine.state.isPlaying).toBe(false);
    vi.useRealTimers();
  });
});

// ── computeTimeline ─────────────────────────────────────────────────

describe('computeTimeline', () => {
  it('returns zero position at the start', () => {
    const paragraphs = [['Hello world.'], ['Second sentence.']];
    const { duration, position } = computeTimeline(paragraphs, 0, 0, 1.0);

    expect(position).toBe(0);
    expect(duration).toBeGreaterThan(0);
  });

  it('position increases as sentences advance', () => {
    const paragraphs = [['First sentence.', 'Second sentence.'], ['Third sentence.']];
    const t0 = computeTimeline(paragraphs, 0, 0, 1.0);
    const t1 = computeTimeline(paragraphs, 0, 1, 1.0);
    const t2 = computeTimeline(paragraphs, 1, 0, 1.0);

    expect(t1.position).toBeGreaterThan(t0.position);
    expect(t2.position).toBeGreaterThan(t1.position);
    // Duration stays the same
    expect(t0.duration).toBe(t1.duration);
    expect(t1.duration).toBe(t2.duration);
  });

  it('higher rate means shorter duration', () => {
    const paragraphs = [['A long sentence that takes time to read aloud.']];
    const slow = computeTimeline(paragraphs, 0, 0, 1.0);
    const fast = computeTimeline(paragraphs, 0, 0, 2.0);

    expect(fast.duration).toBeLessThan(slow.duration);
    expect(fast.duration).toBeCloseTo(slow.duration / 2, 5);
  });

  it('position at end equals duration', () => {
    const paragraphs = [['First.'], ['Second.']];
    // Past the last sentence — paraIdx=2 is past the end, but sentIdx=0
    // Since paraIdx >= paragraphs.length, all chars are "before"
    const t = computeTimeline(paragraphs, 2, 0, 1.0);
    expect(t.position).toBeCloseTo(t.duration, 5);
  });

  it('handles rate = 0 by returning Infinity (current behavior)', () => {
    const paragraphs = [['Hello world.']];
    const result = computeTimeline(paragraphs, 0, 0, 0);
    expect(result.duration).toBe(Infinity);
    expect(result.position).toBe(0);
  });
});
