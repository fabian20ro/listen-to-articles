import { describe, it, expect } from 'vitest';
import { isSpeakableText } from '../lib/extractors/utils.js';

describe('isSpeakableText', () => {
  it('returns true for a long paragraph', () => {
    expect(isSpeakableText('This is a normal paragraph of text that should be speakable.')).toBe(true);
  });

  it('returns false for a very short string', () => {
    expect(isSpeakableText('A')).toBe(false);
    expect(isSpeakableText('Hi')).toBe(false);
  });

  it('returns false for string with only special characters', () => {
    expect(isSpeakableText('!!! ??? ...')).toBe(false);
  });

  it('returns false for short strings with no "real" words', () => {
    expect(isSpeakableText('a b c')).toBe(false);
  });

  it('returns true for string with a few real words', () => {
    expect(isSpeakableText('The cat sat.')).toBe(true);
  });

  it('uses character-count fallback when word count is below threshold but chars are sufficient', () => {
    // Two valid tokens (wordCount=2 < 3) triggers the char-count fallback;
    // stripped characters "abcd" has length 4 >= 4, so returns true.
    expect(isSpeakableText('ab cd')).toBe(true);
  });

  it('returns false when word count is below threshold and chars are insufficient', () => {
    // Two valid tokens (wordCount=2 < 3), but only "a" left after stripping punctuation — charCount=1 < 4.
    expect(isSpeakableText('a b!')).toBe(false);
  });

  it('treats strings with digits as speakable', () => {
    // Digits count toward wordCount via the /[a-zA-Z0-9]/ check.
    expect(isSpeakableText('Version 2 is out.')).toBe(true);
  });

  it('returns false for a single-character string', () => {
    expect(isSpeakableText('X')).toBe(false);
    expect(isSpeakableText('5')).toBe(false);
  });

  it('treats HTML-like strings with embedded alphanumeric content as speakable', () => {
    // isSpeakableText receives plain text only after stripNonTextContent pre-strips tags.
    // If raw HTML reaches this function, the tag body letters (e.g., "img", "br") count toward wordCount.
    expect(isSpeakableText('<img><br>')).toBe(true);
  });

  it('returns true for a long string with only one valid word', () => {
    // After whitespace split: ["a", "b", "c"] → wordCount=3 (each token has >=2 chars with alnum), so direct pass.
    expect(isSpeakableText('x'.repeat(10) + ' y'.repeat(10))).toBe(true);
  });

  it('returns false for a string whose only long token is digits', () => {
    // No Unicode letter (\p{L}) → filtered by the letter gate before wordCount/charCount logic.
    expect(isSpeakableText('1234567890')).toBe(false);
  });

  it('returns false for a short digit-only string', () => {
    // No Unicode letter → letter gate → false.
    expect(isSpeakableText('12')).toBe(false);
  });

  it('returns false for spaced numeric values', () => {
    // Digits and spaces only: no Unicode letter, so the letter gate filters it.
    expect(isSpeakableText('42 56 78')).toBe(false);
  });

  it('returns false for a comma-separated number', () => {
    // Digits and commas only: no Unicode letter, so the letter gate filters it.
    expect(isSpeakableText('1,234,567')).toBe(false);
  });

  it('handles whitespace-heavy strings correctly', () => {
    const text = '   hello world this is a test of the speakability check function   ';
    expect(isSpeakableText(text)).toBe(true);
  });

  it('returns false for punctuation-only string longer than minimum length', () => {
    // No alphanumeric tokens survive the wordCount filter; char fallback stripped = '' → false.
    expect(isSpeakableText('!!! ???? ....')).toBe(false);
  });

  it('treats non-Latin (CJK) text as speakable via character-count fallback', () => {
    // CJK chars are not matched by /[a-zA-Z0-9]/ so wordCount=0 (<3),
    // triggering char fallback. Stripped length of "你好世界" = 4 ≥ 4 → true.
    expect(isSpeakableText('你好世界')).toBe(true);
  });

  it('returns false for non-Latin text shorter than character threshold', () => {
    // wordCount=0 (<3), char fallback: stripped "你好" length=2 < 4 → false.
    expect(isSpeakableText('你好')).toBe(false);
  });

  it('treats Cyrillic text as speakable via character-count fallback', () => {
    // Cyrillic chars bypass /[a-zA-Z0-9]/ so wordCount=0 (<3), char fallback:
    // "Привет" stripped length = 6 ≥ 4 → true.
    expect(isSpeakableText('Привет мир')).toBe(true);
  });

  it('handles tab-separated content correctly', () => {
    // Tabs are whitespace in the split regex; tokens separated by tabs count normally.
    const text = 'hello\tworld\tthis\tis\ta\ttest';
    expect(isSpeakableText(text)).toBe(true);
  });

  it('treats mixed ASCII and non-Latin tokens as speakable', () => {
    // Mixed content: "abc" passes wordCount directly (3 tokens with alnum).
    const text = 'hello 你好 world';
    expect(isSpeakableText(text)).toBe(true);
  });

  it('treats pure non-Latin token as speakable via char fallback', () => {
    // Single CJK word: "世界" → wordCount=0 (<3), char fallback length=2 < 4? No, length=2...
    // Actually let's use longer: "世界和平" → wordCount=0, stripped len=4 ≥ 4 → true.
    expect(isSpeakableText('世界和平')).toBe(true);
  });

  it('returns false for non-Latin text that fails both thresholds', () => {
    // Single CJK character: wordCount=0 (<3), char fallback length=1 < 4 → false.
    expect(isSpeakableText('世')).toBe(false);
  });

  it('treats string with only ASCII punctuation and non-latin chars as speakable', () => {
    // "你好!" → wordCount=0 (<3), stripped removes '!' → "你好" length=2 < 4...
    // Use longer: "你好世界！" → stripped "你好世界" len=4 ≥ 4 → true.
    expect(isSpeakableText('你好世界！')).toBe(true);
  });

  it('handles string with embedded quotes and brackets in char fallback', () => {
    // The char fallback strips ' " < > [ ] { } as punctuation; these chars are not alnum so
    // wordCount counts only real tokens. Test: tokens + stripped punctuation boundary.
    const text = 'hello "world"';
    expect(isSpeakableText(text)).toBe(true);
  });

  it('returns false for whitespace-only string', () => {
    // Trimmed length < 2 → false (early return).
    expect(isSpeakableText('   ')).toBe(false);
    expect(isSpeakableText('\t\t')).toBe(false);
  });

  it('returns false for an empty string', () => {
    // trimmed.length === 0 triggers the early < 2 check.
    expect(isSpeakableText('')).toBe(false);
  });

  it('treats mixed ASCII digits and non-Latin text as speakable via char fallback', () => {
    // wordCount=1 (digits only count as one token "123" ≥ 2 chars with alnum), < 3 → char fallback;
    // stripped "123你好世界" length = 7 ≥ 4 → true.
    expect(isSpeakableText('123 你好世界')).toBe(true);
  });

  it('returns false for mixed digit-non-Latin text below character threshold', () => {
    // wordCount=1 ("5"), < 3 → char fallback; stripped "5你" length = 2 < 4 → false.
    expect(isSpeakableText('5 你')).toBe(false);
  });

  it('returns true for non-Latin text with embedded ASCII digits via char fallback', () => {
    // wordCount=1 ("9"), < 3 → char fallback; stripped "Привет9мир" length = 8 ≥ 4 → true.
    expect(isSpeakableText('Привет 9 мир')).toBe(true);
  });

  it('returns false for text with only digits and non-Latin chars below both thresholds', () => {
    // wordCount=1 ("12"), < 3 → char fallback; stripped "12世" length = 3 < 4 → false.
    expect(isSpeakableText('12 世')).toBe(false);
  });

  it('returns true for text where punctuation removal reveals sufficient non-Latin chars', () => {
    // wordCount=0, char fallback strips `.,!?;:()[]{}'"<>"` → stripped "Приветмир" length = 7 ≥ 4 → true.
    expect(isSpeakableText('Привет!  мир.')).toBe(true);
  });

  it('returns false for a two-character trimmed string', () => {
    // trimmed.length === 2, < 2 check fails (2 is not less than 2), but wordCount=0 (< 3) → char fallback;
    // stripped length = 2 < 4 → false.
    expect(isSpeakableText('ab')).toBe(false);
  });

});
