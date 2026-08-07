/**
 * Sentence splitting — splits text into TTS-greedy sentence chunks.
 */

export const MIN_SENTENCE_LENGTH = 40;
export const MAX_UTTERANCE_LENGTH = 200;

export function mergeShortSentences(sentences: string[]): string[] {
  if (sentences.length <= 1) return sentences;

  const merged: string[] = [];
  let current = sentences[0];

  for (let i = 1; i < sentences.length; i++) {
    const next = sentences[i];
    if (
      current.length < MIN_SENTENCE_LENGTH &&
      current.length + 1 + next.length <= MAX_UTTERANCE_LENGTH
    ) {
      current += ' ' + next;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return merged;
}

const LONG_SPLIT_DELIMITERS: RegExp[] = [
  /;\s*/,           // semicolons
  /\s[—–]\s/,      // em/en dashes with surrounding spaces
  /:\s*/,           // colons
  /,\s*/,           // commas
];

export function splitKeepingDelimiter(text: string, delim: RegExp): string[] {
  const global = new RegExp(delim.source, 'g');
  const segments: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = global.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const seg = text.slice(lastIndex, end).trim();
    if (seg.length > 0) segments.push(seg);
    lastIndex = end;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail.length > 0) segments.push(tail);

  return segments;
}

export function splitLongSentence(sentence: string, maxLen: number): string[] {
  if (sentence.length <= maxLen) return [sentence];

  for (const delim of LONG_SPLIT_DELIMITERS) {
    const segments = splitKeepingDelimiter(sentence, delim);
    if (segments.length <= 1) continue;

    // We don't need greedyMerge here if we just want to find a split.
    // Let's just return the segments found by the delimiter.
    return segments;
  }

  const words = sentence.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLen) {
      current += ' ' + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function splitSentences(text: string): string[] {
  if (typeof text !== 'string') {
    throw new TypeError('splitSentences expects a string');
  }
  const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  const pieces = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  const merged = mergeShortSentences(pieces);
  return merged.flatMap((s) =>
    s.length > MAX_UTTERANCE_LENGTH ? splitLongSentence(s, MAX_UTTERANCE_LENGTH) : [s],
  ).map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}
