/**
 * HTML article extraction via Readability.js + Turndown.
 *
 * This module handles parsing HTML into Article objects.
 * URL fetch orchestration lives in extract-url.ts.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  WORDS_PER_MINUTE,
  MAX_ARTICLE_SIZE,
} from './types.js';
import {
  splitPlainTextParagraphs,
  markdownToParagraphs,
  extractTitleFromMarkdown,
  countWords,
} from './utils.js';

export function parseArticleFromHtml(
  html: string,
  sourceUrl: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
): Article {
  if (html.length > MAX_ARTICLE_SIZE) {
    throw new Error(`HTML exceeds maximum size of ${MAX_ARTICLE_SIZE} characters.`);
  }
  const doc = new DOMParserConstructor().parseFromString(html, 'text/html');

  let normalizedSourceUrl: URL;
  try {
    normalizedSourceUrl = new URL(sourceUrl);
  } catch (err) {
    throw new Error(`Invalid source URL "${sourceUrl}": ${(err as Error).message}`);
  }
  if (normalizedSourceUrl.protocol !== 'http:' && normalizedSourceUrl.protocol !== 'https:') {
    throw new Error('Only http(s) source URLs are supported.');
  }

  const htmlLang = doc.documentElement.getAttribute('lang')
    || doc.documentElement.getAttribute('xml:lang')
    || '';

  const base = doc.createElement('base');
  base.href = normalizedSourceUrl.toString();
  doc.head.appendChild(base);

  // Strip noise before Readability — this is a text reader.
  doc.querySelectorAll('img, script, iframe, style, noscript').forEach((el) => el.remove());

  const parsed = new Readability(doc).parse();

  let title: string;
  let textContent: string;
  let content: string;
  let siteName: string;
  let excerpt: string;

  if (parsed) {
    title = parsed.title || 'Untitled';
    textContent = parsed.textContent || '';
    content = parsed.content || '';
    siteName = parsed.siteName || normalizedSourceUrl.hostname;
    excerpt = parsed.excerpt || '';
  } else {
    const pElements = doc.querySelectorAll('p');
    const paragraphs = Array.from(pElements).map((p) => p.textContent?.trim() ?? '');
    textContent = paragraphs.filter((p) => p.length > 0).join('\n\n');
    content = '';
    title = doc.title || 'Untitled';
    siteName = normalizedSourceUrl.hostname;
    excerpt = textContent.slice(0, 200);
  }

  if (!textContent || textContent.trim().length === 0) {
    throw new Error('Could not extract readable content from this page.');
  }

  let markdown = htmlToMarkdown(content, title, textContent);
  let paragraphs = markdownToParagraphs(markdown);

  if (paragraphs.length === 0) {
    paragraphs = splitPlainTextParagraphs(textContent);
    markdown = paragraphs.join('\n\n');
  }

  if (paragraphs.length === 0) {
    throw new Error('Article appears empty after parsing.');
  }

  const normalizedText = paragraphs.join('\n\n');
  const wordCount = countWords(normalizedText);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(normalizedText);

  return {
    title,
    content,
    textContent: normalizedText,
    markdown,
    paragraphs,
    lang,
    htmlLang,
    siteName,
    excerpt: excerpt || normalizedText.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: normalizedSourceUrl.toString(),
  };
}

export function parseArticleFromMarkdown(markdown: string, sourceUrl: string): Article {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) {
    throw new Error('Jina returned empty markdown content.');
  }

  const paragraphs = markdownToParagraphs(normalizedMarkdown);
  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable paragraphs from markdown response.');
  }

  const textContent = paragraphs.join('\n\n');
  const title = extractTitleFromMarkdown(normalizedMarkdown) || new URL(sourceUrl).hostname;
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: normalizedMarkdown,
    paragraphs,
    lang,
    htmlLang: '',
    siteName: new URL(sourceUrl).hostname,
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: sourceUrl,
  };
}

function htmlToMarkdown(contentHtml: string, title: string, textContent: string): string {
  const fallback = splitPlainTextParagraphs(textContent).join('\n\n');
  if (!contentHtml || typeof TurndownService === 'undefined') {
    return prependTitleHeading(fallback, title);
  }

  try {
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const markdown = turndown.turndown(contentHtml).trim();
    if (!markdown) return prependTitleHeading(fallback, title);
    return prependTitleHeading(markdown, title);
  } catch {
    return prependTitleHeading(fallback, title);
  }
}

function prependTitleHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return title ? `# ${title}` : '';
  if (!title) return trimmed;
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

/**
 * Sanitize rendered HTML for safe display in the article view.
 * Removes scripts, images, dangerous attributes, etc.
 */
export function sanitizeRenderedHtml(
  html: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
): string {
  const doc = new DOMParserConstructor().parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement | null;
  if (!container) return '';

  // Remove dangerous elements, form elements, and image-related elements (this is a text reader).
  container.querySelectorAll('script, style, iframe, object, embed, img, picture, source, svg, form, meta, link, video, audio').forEach((el) => el.remove());

  // Figure wrappers become empty decorative noise once images are stripped.
  container.querySelectorAll('figure').forEach((el) => {
    if (el.textContent?.trim().length === 0) el.remove();
  });

  // Remove links that became empty after image removal (linked images)
  // and links whose text is just an image reference (Jina Reader format).
  container.querySelectorAll('a').forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    if (!text || /^Image\s*[:\d]/i.test(text)) {
      el.remove();
    }
  });

  container.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const attrs = Array.from(el.attributes);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }

      if ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });

    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  return container.innerHTML;
}
