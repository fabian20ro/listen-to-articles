/**
 * Shared extraction utilities: paragraph splitting, text filtering,
 * markdown processing, and article building helpers.
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  MIN_PARAGRAPH_LENGTH,
  WORDS_PER_MINUTE,
  IMAGE_MD_RE,
} from './types.js';

/** Build an Article from pre-extracted paragraphs. */
export function buildArticleFromParagraphs(
  paragraphs: string[],
  title: string,
  siteName: string,
  markdown: string,
): Article {
  const textContent = paragraphs.join('\n\n');
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown,
    paragraphs,
    lang,
    htmlLang: '',
    siteName,
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/** Check if text contains enough real words to be worth speaking aloud. */
export function isSpeakableText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  
  // Split by whitespace to get tokens.
  const tokens = trimmed.split(/\s+/);
  // A "word" for this purpose is at least 2 characters long and contains at least one alphanumeric character.
  const wordCount = tokens.filter(t => t.length >= 2 && /[a-zA-Z0-9]/.test(t)).length;
  
  // If wordCount is low, fallback to character count for non-latin.
  if (wordCount < 3) {
    const charCount = trimmed.replace(/[.,!?;:()\[\]{}'\"<>]/g, '').replace(/\s/g, '').length;
    return charCount >= 4;
  }
  
  return true;
}

/** Strip content that shouldn't be read aloud: HTML tags, data URIs, image refs, image URLs. */
export function stripNonTextContent(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+[;,]\S*/g, '')
    .replace(IMAGE_MD_RE, '')
    .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(?:[?#]\S*)?(?:\s|$|\)|\"|'|\.)/gi, '')
    .replace(/https?:\/\/\S{80,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripMarkdownSyntax(block: string): string {
  const stripped = block
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '');
  return stripNonTextContent(stripped);
}

/** Filter paragraphs based on length and speakability. */
export function filterReadableParagraphs(texts: string[]): string[] {
  return texts
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));
}

export function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/)
    .map((block) => stripMarkdownSyntax(block))
    .map((text) => text.trim())
    .filter((text) => text.length >= MIN_PARAGRAPH_LENGTH)
    .filter((text) => isSpeakableText(text));
}

export function extractTitleFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);
  // Bare H1 with no body content — nothing to read aloud.
  if (lines.length === 1 && /^#/.test(lines[0]!)) return '';
  const h1 = lines.find((line) => /^#[^#]\s*/.test(line) || line === '#');
  if (h1) return h1.replace(/^#\s*/, '').trim();
  return stripMarkdownSyntax(lines[0] ?? '').slice(0, 150);
}

/**
 * Split text into individual sentences.
 */
export function splitSentences(text: string): string[] {
  // Split text into sentences while preserving known abbreviations (Mr., Dr., etc.)
  // so they don't trigger incorrect boundaries or get dropped from output.
  const ABBREV_RE = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|e\.g|i\.e|vs|etc)\.?$/i;

  const segments: string[] = [];
  let current = '';
  let prevAbbr = false;

  for (const token of text.split(/\s+/)) {
    if (!token) continue;

    // If previous segment ended with an abbreviation and this is a new word, close that segment.
    if (prevAbbr && /[^.!?]$/.test(current.trim())) {
      segments.push(current.trim());
      current = '';
      prevAbbr = false;
    }

    const endsWithSentencePunct = /[.!?]$/.test(token);
    const isAbbrevToken = ABBREV_RE.test(' ' + token);

    if (current) {
      // Continue accumulating the current segment.
      current += ' ' + token;
    } else {
      current = token;
    }

    // Track whether this segment ends with an abbreviation for next iteration.
    prevAbbr = isAbbrevToken && !endsWithSentencePunct;

    // Close segment when we hit sentence-ending punctuation (not part of an abbreviation).
    if (endsWithSentencePunct && !isAbbrevToken) {
      segments.push(current.trim());
      current = '';
      prevAbbr = false;
    }
  }

  if (current.trim()) segments.push(current.trim());

  return segments.filter(s => s.length > 0);
}

/**
 * Split text into paragraphs of N sentences each.
 */
export function splitTextBySentences(
  text: string, 
  sentencesPerParagraph = 3, 
  minChars = MIN_PARAGRAPH_LENGTH
): string[] {
  const sentences = splitSentences(text);
  if (sentences.length <= sentencesPerParagraph) {
    const trimmed = text.trim();
    if (trimmed.length >= minChars && isSpeakableText(trimmed)) {
      return [trimmed];
    }
    return [];
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    const chunk = sentences.slice(i, i + sentencesPerParagraph);
    const para = chunk.join(' ').trim();
    if (para.length >= minChars && isSpeakableText(para)) {
      paragraphs.push(para);
    }
  }
  return paragraphs;
}

/** Count words in a text. */
export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

/**
 * Split plain text into paragraphs.
 */
export function splitPlainTextParagraphs(
  text: string, 
  sentencesPerParagraph = 3,
  minChars = MIN_PARAGRAPH_LENGTH
): string[] {
  const byBlank = filterReadableParagraphs(text.split(/\n\s*\n/));
  if (byBlank.length > 1) return byBlank;

  const byLine = filterReadableParagraphs(text.split(/\n/));
  if (byLine.length > 1) return byLine;

  const cleaned = stripNonTextContent(text);
  const bySentence = splitTextBySentences(cleaned, sentencesPerParagraph, minChars);
  
  if (bySentence.length > 0) return bySentence;

  if (cleaned.length >= minChars && isSpeakableText(cleaned)) {
    return [cleaned];
  }

  return [];
}
