/**
 * Shared types and constants for article extraction.
 */

import type { Language } from '../language-config.js';

export class UpstreamResponseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'UpstreamResponseError';
    if (!(status >= 100 && status < 600)) {
      throw new RangeError(
        `Invalid HTTP status in UpstreamResponseError: ${status}. Expected [100, 599].`
      );
    }
  }
}

export interface Article {
  title: string;
  content: string;         // HTML from Readability
  textContent: string;     // plain text
  markdown: string;        // markdown for rendering/export
  paragraphs: string[];    // split for TTS chunking
  lang: Language;
  htmlLang: string;        // raw lang from <html lang="...">, e.g. "de" or "de-DE"
  siteName: string;
  excerpt: string;
  wordCount: number;
  estimatedMinutes: number;
  resolvedUrl: string;     // final URL after redirects (from proxy)
}

export const MIN_PARAGRAPH_LENGTH = 20;
export const YOUTUBE_TRANSCRIPT_PARAGRAPH_THRESHOLD = 400;
export const MAX_ARTICLE_SIZE = 2_000_000;     // 2 MB (HTML articles)
export const MAX_PDF_SIZE = 10_000_000;        // 10 MB (PDF documents)
export const FETCH_TIMEOUT = 10_000;           // 10 s
export const PDF_FETCH_TIMEOUT = 30_000;       // 30 s (PDFs are larger)
export const WORDS_PER_MINUTE = 180;           // spoken pace

// Runtime invariant assertions — catch accidental constant drift at module load time.
if (MIN_PARAGRAPH_LENGTH < 10 || MIN_PARAGRAPH_LENGTH > 50) {
  throw new Error(`Invalid MIN_PARAGRAPH_LENGTH: ${MIN_PARAGRAPH_LENGTH}. Expected [10, 50].`);
}
if (YOUTUBE_TRANSCRIPT_PARAGRAPH_THRESHOLD <= MIN_PARAGRAPH_LENGTH) {
  throw new Error('YOUTUBE_TRANSCRIPT_PARAGRAPH_THRESHOLD must exceed MIN_PARAGRAPH_LENGTH.');
}
if (!(MAX_ARTICLE_SIZE > 0 && MAX_ARTICLE_SIZE <= 2 * 1024 * 1024)) {
  throw new Error(`Invalid MAX_ARTICLE_SIZE: ${MAX_ARTICLE_SIZE}. Expected (0, 2MB].`);
}
if (!(MAX_PDF_SIZE > 0 && MAX_PDF_SIZE <= 10 * 1024 * 1024)) {
  throw new Error(`Invalid MAX_PDF_SIZE: ${MAX_PDF_SIZE}. Expected (0, 10MB].`);
}
if (FETCH_TIMEOUT < 5_000 || FETCH_TIMEOUT > 60_000) {
  throw new Error(`Invalid FETCH_TIMEOUT: ${FETCH_TIMEOUT}ms. Expected [5s, 60s].`);
}
if (PDF_FETCH_TIMEOUT <= FETCH_TIMEOUT) {
  throw new Error('PDF_FETCH_TIMEOUT must exceed FETCH_TIMEOUT.');
}
if (WORDS_PER_MINUTE < 100 || WORDS_PER_MINUTE > 300) {
  throw new Error(`Invalid WORDS_PER_MINUTE: ${WORDS_PER_MINUTE}. Expected [100, 300].`);
}

/** Shared image-stripping regex patterns for markdown content. */
export const IMAGE_MD_RE = /!\[[^\]]*\]\([^()]*(?:\([^)]*\)[^()]*)*\)/g;
export const IMAGE_HTML_RE = /<img[^>]*\/?>/gi;
