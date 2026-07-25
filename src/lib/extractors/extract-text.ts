/**
 * Plain text and Markdown file extraction.
 */

import { detectLanguage } from '../lang-detect.js';
import { type Article, IMAGE_MD_RE, MAX_ARTICLE_SIZE, WORDS_PER_MINUTE } from './types.js';
import {
  buildArticleFromParagraphs,
  splitPlainTextParagraphs,
  markdownToParagraphs,
  extractTitleFromMarkdown,
  countWords,
} from './utils.js';

/**
 * Create an Article directly from pasted plain text (no fetch needed).
 */
export function createArticleFromText(text: string): Article {
  // Strip markdown image references before paragraph processing — TTS would otherwise read them aloud.
  const LINK_MD_RE = /\[([^\]]*)\]\([^()]*\)/g;
  const cleaned = text.replace(IMAGE_MD_RE, '').replace(LINK_MD_RE, '$1');
  const lines = cleaned.split('\n');
  const firstLine = lines[0].trim();
  const hasTitle = firstLine.length > 0 && firstLine.length <= 150;
  const title = hasTitle ? firstLine : 'Pasted Article';
  const bodyText = hasTitle ? lines.slice(1).join('\n').trim() : text.trim();
  const textContent = bodyText || '';

  let paragraphs = splitPlainTextParagraphs(textContent);
  if (paragraphs.length === 0 && textContent.trim().length > 0) {
    paragraphs = [textContent.trim()];
  }
  if (paragraphs.length === 0) {
    throw new Error('Pasted text is too short to read as an article.');
  }

  const wordCount = countWords(textContent);
  if (wordCount < 3) {
    throw new Error('Pasted text is too short to read as an article.');
  }
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: text.trim(),
    paragraphs,
    lang,
    htmlLang: '',
    siteName: 'Pasted',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Create an Article from a local text file (.txt, .text).
 */
export async function createArticleFromTextFile(file: File): Promise<Article> {
  if (file.size > MAX_ARTICLE_SIZE) {
    throw new Error('File is too large (>2 MB). Please use a smaller file.');
  }

  const text = await file.text();
  const textContent = text.trim();

  if (!textContent) {
    throw new Error('The text file is empty.');
  }

  const paragraphs = splitPlainTextParagraphs(textContent);
  if (paragraphs.length === 0) {
    throw new Error('The text file has no readable content.');
  }

  const title = String(file.name).replace(/\.(txt|text)$/i, '') || 'Text Document';
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: text.trim(),
    paragraphs,
    lang,
    htmlLang: '',
    siteName: 'Text File',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Create an Article from a local Markdown file (.md, .markdown).
 */
export async function createArticleFromMarkdownFile(file: File): Promise<Article> {
  if (file.size > MAX_ARTICLE_SIZE) {
    throw new Error('File is too large (>2 MB). Please use a smaller file.');
  }

  const text = await file.text();
  const markdown = text.trim();

  if (!markdown) {
    throw new Error('The markdown file is empty.');
  }

  const paragraphs = markdownToParagraphs(markdown);
  if (paragraphs.length === 0) {
    // Fallback to plain text splitting
    const plainParagraphs = splitPlainTextParagraphs(markdown);
    if (plainParagraphs.length === 0) {
      throw new Error('The markdown file has no readable content.');
    }
    return buildArticleFromParagraphs(
      plainParagraphs,
      file.name.replace(/\.(md|markdown)$/i, '') || 'Markdown Document',
      'Markdown',
      markdown,
    );
  }

  const title = extractTitleFromMarkdown(markdown) ||
    file.name.replace(/\.(md|markdown)$/i, '') || 'Markdown Document';

  return buildArticleFromParagraphs(paragraphs, title, 'Markdown', markdown);
}
