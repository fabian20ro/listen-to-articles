import { describe, it, expect } from 'vitest';
import { 
  mergeShortSentences, 
  splitKeepingDelimiter,
  splitLongSentence, 
  splitSentences,
  MAX_UTTERANCE_LENGTH
} from '../lib/sentence-splitter';

describe('sentence-splitter', () => {
  describe('mergeShortSentences', () => {
    it('should return original if only one sentence', () => {
      expect(mergeShortSentences(['Hello.'])).toEqual(['Hello.']);
    });

    it('should merge sentences shorter than MIN_SENTENCE_LENGTH (40)', () => {
      const input = ['Short.', 'Another short one.'];
      expect(mergeShortSentences(input)).toEqual(['Short. Another short one.']);
    });

    it('should not merge sentences if the result exceeds MAX_UTTERANCE_LENGTH', () => {
      const longPart = 'A'.repeat(150);
      const input = [longPart + '.', 'Next sentence.'];
      expect(mergeShortSentences(input)).toEqual([longPart + '.', 'Next sentence.']);
    });

    it('should NOT merge when current length equals MIN_SENTENCE_LENGTH (40)', () => {
      const boundary = 'A'.repeat(40);
      const input = [boundary, 'short.'];
      expect(mergeShortSentences(input)).toEqual([boundary, 'short.']);
    });

    it('should merge when current is one char below MIN_SENTENCE_LENGTH (39)', () => {
      const short = 'A'.repeat(39);
      const next = 'B'.repeat(10) + '.';
      expect(mergeShortSentences([short, next])).toEqual([`${short} ${next}`]);
    });

    it('should start a new segment when merge would exceed MAX_UTTERANCE_LENGTH mid-chain', () => {
      // x + y merge (39 chars total, still < MIN_SENTENCE_LENGTH). z is long enough
      // that the merged chunk + z would be 201 chars > MAX_UTTERANCE_LENGTH (200),
      // so z must start a fresh segment.
      const x = 'x'.repeat(18) + '.';     // 19 chars
      const y = 'y'.repeat(18) + '.';     // 19 chars — merged with x → 39
      const z = 'Z'.repeat(160) + '.';    // 161 chars — 39 + 1 + 161 = 201 > 200
      expect(mergeShortSentences([x, y, z])).toEqual([`${x} ${y}`, z]);
    });

    it('should handle empty input array', () => {
      expect(mergeShortSentences([])).toEqual([]);
    });
  });

  describe('splitLongSentence', () => {
    it('should return original if below maxLen', () => {
      const text = 'This is fine.';
      expect(splitLongSentence(text, 20)).toEqual(['This is fine.']);
    });

    it('should split at semicolons', () => {
      const text = 'Part 1; Part 2';
      expect(splitLongSentence(text, 5)).toEqual(['Part 1;', 'Part 2']);
    });

    it('should split at colons', () => {
       const text = 'Wait: here it is.';
       expect(splitLongSentence(text, 10)[0]).toBe('Wait:');
    });

    it('should fallback to whitespace splitting when no delimiter is found', () => {
      const text = 'This is a very long sentence that has no punctuation at all but needs splitting.';
      // splitLongSentence(text, maxLen)
      const result = splitLongSentence(text, 20);
      expect(result.length).toBeGreaterThan(1);
      expect(result[0].length).toBeLessThanOrEqual(20);
    });
    it('should split multiple semicolons into separate segments', () => {
      const text = 'First; Second; Third; Fourth';
      expect(splitLongSentence(text, 5)).toEqual(['First;', 'Second;', 'Third;', 'Fourth']);
    });

    it('should split by commas when requested', () => {
       const text = 'One, two, three';
       expect(splitLongSentence(text, 5)).toEqual(['One,', 'two,', 'three']);
    });
    it('should split basic sentences', () => {
      // Using long enough sentences to avoid merging during testing
      const text = 'This is a much longer first sentence with enough words. This is another long sentence with enough words.';
      expect(splitSentences(text)).toEqual([
        'This is a much longer first sentence with enough words.',
        'This is another long sentence with enough words.'
      ]);
    });

    it('should handle no punctuation', () => {
      const text = 'No punctuation here';
      expect(splitSentences(text)).toEqual(['No punctuation here']);
    });

    it('should handle empty string', () => {
      expect(splitSentences('')).toEqual(['']);
    });

    it('should merge very short fragments into one sentence', () => {
      const text = 'A. B. C. D.';
      expect(splitSentences(text)).toEqual(['A. B. C. D.']);
    });

    it('should chain merge-then-split when merged segments exceed MAX_UTTERANCE_LENGTH', () => {
      // Build many short sentences (~20 chars each) so the merged chunk exceeds 200,
      // forcing splitLongSentence to fire. With MIN_SENTENCE_LENGTH=40 and 8 segments of ~21 chars,
      // mergeShortSentences concatenates them all into one chunk well over MAX_UTTERANCE_LENGTH (200).
      const short = 'A shorter sentence.';
      const text = [...Array(13)].map(() => short).join(' ');
      expect(text.length).toBeGreaterThan(MAX_UTTERANCE_LENGTH);
      const result = splitSentences(text);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const seg of result) {
        expect(seg.length).toBeLessThanOrEqual(MAX_UTTERANCE_LENGTH);
      }
    });

    it('should split on em-dash delimiters', () => {
      const text = 'Before — after';
      // Text is short so no splitting needed unless below threshold. Test via long sentence.
      const longText = 'X'.repeat(50) + ' — ' + 'Y'.repeat(50);
      expect(splitLongSentence(longText, 30).length).toBeGreaterThan(1);
    });

    it('should keep leading whitespace in segment after trim', () => {
      const text = 'first;   second; third';
      const result = splitLongSentence(text, 5);
      expect(result[1].startsWith('second')).toBe(true);
    });

    it('should handle mixed punctuation marks (?!.) as sentence boundaries', () => {
      const text = 'Hello! What? Yes.';
      // Each segment is < MIN_SENTENCE_LENGTH, so mergeShortSentences joins them.
      expect(splitSentences(text)).toEqual(['Hello! What? Yes.']);
    });

    it('should keep mixed-punctuation segments separate when merged length exceeds MAX_UTTERANCE_LENGTH', () => {
      const long = 'A'.repeat(65);
      const text = `${long}! ${long}? ${long}.`;
      // Each piece is ~66 chars (>= 40), so mergeShortSentences does NOT merge them.
      expect(splitSentences(text).length).toBeGreaterThanOrEqual(2);
    });

    it('should return single segment when long-split produces only whitespace after trim', () => {
      // Delimiter segments collapse to empty after trim — production keeps non-empty only,
      // so the result should be a single non-empty chunk from the trailing text.
      const text = '   ...  ';
      const result = splitLongSentence(text, 5);
      expect(result.every(s => s.length > 0)).toBe(true);
    });
  });

  describe('splitKeepingDelimiter', () => {
    it('should split on semicolon keeping delimiter in segment end', () => {
      const result = splitKeepingDelimiter('one; two;', /;\s*/);
      expect(result).toEqual(['one;', 'two;']);
    });

    it('should return single segment when no match is found', () => {
      const result = splitKeepingDelimiter('plain text, no delimiters here', /;/);
      expect(result).toEqual(['plain text, no delimiters here']);
    });

    it('should split on adjacent semicolons keeping delimiter in each segment', () => {
      // Adjacent semicolons each become their own segments with delimiters kept
      const result = splitKeepingDelimiter('a;;b', /;/);
      expect(result).toEqual(['a;', ';', 'b']);
    });

    it('should include trailing text as tail segment after last match when regex captures surrounding whitespace', () => {
      const result = splitKeepingDelimiter('alpha; beta; gamma delta', /;\s*/);
      expect(result[result.length - 1]).toBe('gamma delta');
    });

    it('should normalize output chunks by trimming and filtering empty segments', () => {
      const text = 'Before — after — done.';
      const result = splitSentences(text);
      for (const seg of result) {
        expect(seg).not.toMatch(/^\s/);
        expect(seg).not.toMatch(/\s$/);
        expect(seg.length).toBeGreaterThan(0);
      }
    });
  });
});
