/**
 * Article body renderer — converts Article markdown/paragraphs into
 * DOM elements with click-to-seek TTS integration.
 *
 * Extracted from ArticleController for separation of concerns:
 * ArticleController handles extraction and orchestration,
 * ArticleRenderer handles DOM rendering and TTS paragraph building.
 */

import { marked } from 'marked';
import {
  sanitizeRenderedHtml,
  IMAGE_MD_RE,
  IMAGE_HTML_RE,
  type Article,
} from './extractor.js';
import type { TTSEngine } from './tts-engine.js';

/**
 * TTS paragraph minimum length.  Blocks whose normalised text is shorter
 * than this are merged with the following block so that very short items
 * like author bylines or short headings don't produce their own
 * pause-bounded TTS utterance.
 */
const MIN_TTS_PARAGRAPH = 40;

/** Tags that should never become TTS blocks (non-content elements). */
// Note: COL is intentionally excluded. <col> is a row-level element, not block-level,
// and would only appear inside <colgroup>/<table>. If present in the rendered DOM it's
// structural markup — filtering it out risks losing associated text. The original set
// included 'COL' but no production path places standalone COL elements before getMarkdownBlocks;
// removing it is safer for future-proofing.
const SKIP_BLOCK_TAGS = new Set(['SCRIPT', 'STYLE', 'BR', 'COLGROUP']);

/**
 * Render the article body into the container and return TTS paragraph texts.
 * Prefers markdown rendering when available; falls back to plain text paragraphs.
 */
export function renderArticleBody(
  article: Article,
  container: HTMLElement,
  tts: TTSEngine,
): string[] {
  if (!article || !container || !tts) return [];

  container.innerHTML = '';

  if (article.markdown) {
    const rendered = renderMarkdownHtml(article.markdown);
    if (rendered) {
      container.innerHTML = rendered;
      const blocks = getMarkdownBlocks(container);
      const ttsParagraphs = buildTtsParagraphs(blocks, tts);
      if (ttsParagraphs.length > 0) {
        return ttsParagraphs;
      }
    }
  }

  // Fallback: plain text paragraphs
  article.paragraphs.forEach((paragraph, index) => {
    const div = document.createElement('div');
    div.className = 'paragraph';
    div.textContent = paragraph;
    div.dataset.index = String(index);
    div.addEventListener('click', () => {
      tts.jumpToParagraph(index);
      if (!tts.state.isPlaying) tts.play();
      div.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    container.appendChild(div);
  });

  return article.paragraphs;
}

function renderMarkdownHtml(markdown: string): string {
  if (!markdown) return '';
  if (typeof marked === 'undefined' || typeof marked.parse !== 'function') return '';

  try {
    const cleaned = markdown
      .replace(IMAGE_HTML_RE, '')
      .replace(IMAGE_MD_RE, '');
    const html = marked.parse(cleaned);
    return sanitizeRenderedHtml(String(html), globalThis.DOMParser);
  } catch {
    return '';
  }
}

function normalizeTtsText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build TTS paragraphs from markdown blocks, merging short blocks
 * and assigning data-index + click handlers.
 */
function buildTtsParagraphs(blocks: HTMLElement[], tts: TTSEngine): string[] {
  const ttsParagraphs: string[] = [];
  let pendingText = '';
  let pendingBlocks: HTMLElement[] = [];

  // IMPORTANT: data-index is the canonical TTS paragraph index.
  // Multiple DOM blocks may share the same data-index when short
  // blocks are merged.  Consumers (highlightParagraph, click-to-seek)
  // MUST use data-index, never ordinal DOM position, to map between
  // TTS and DOM.
  const flush = () => {
    if (!pendingText) return;
    const index = ttsParagraphs.length;
    ttsParagraphs.push(pendingText);
    for (const b of pendingBlocks) {
      b.classList.add('paragraph');
      b.dataset.index = String(index);
      b.addEventListener('click', () => {
        tts.jumpToParagraph(index);
        if (!tts.state.isPlaying) tts.play();
        b.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    pendingText = '';
    pendingBlocks = [];
  };

  blocks.forEach((block) => {
    // Code blocks: announce with truncated content, always flush immediately
    if (block.tagName === 'PRE') {
      const codeText = normalizeTtsText(block.textContent ?? '');
      if (codeText) {
        const truncated = codeText.length > 200
          ? codeText.slice(0, 200) + '...'
          : codeText;
        pendingText = pendingText
          ? pendingText + ' ' + 'Code block: ' + truncated
          : 'Code block: ' + truncated;
        pendingBlocks.push(block);
        flush();
      }
      return;
    }

    // Decompose compound blocks (lists, blockquotes) into individual sub-items
    const subItems = extractSubItems(block);
    for (const { element, text } of subItems) {
      if (!text) continue;
      pendingText = pendingText ? pendingText + ' ' + text : text;
      pendingBlocks.push(element);
      if (pendingText.length >= MIN_TTS_PARAGRAPH) {
        flush();
      }
    }
  });
  flush();

  return ttsParagraphs;
}

/**
 * Break a compound block (list, blockquote) into individual sub-items
 * so each can become its own TTS paragraph.  For simple blocks (p, h1-h6,
 * table, etc.) returns the block itself.
 */
function extractSubItems(
  block: HTMLElement,
): Array<{ element: HTMLElement; text: string }> {
  const tag = block.tagName;

  // Lists: every descendant <li> becomes its own TTS sub-item,
  // so nested bullets are announced as distinct utterances.
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(
      block.querySelectorAll<HTMLElement>('li'),
    );
    if (items.length > 0) {
      return items.map((li) => ({
        element: li,
        text: normalizeTtsText(li.textContent ?? ''),
      }));
    }
  }

  // Blockquotes with multiple paragraphs: each <p> is separate
  if (tag === 'BLOCKQUOTE') {
    const paras = Array.from(
      block.querySelectorAll<HTMLElement>(':scope > p'),
    );
    if (paras.length > 1) {
      return paras.map((p) => ({
        element: p,
        text: normalizeTtsText(p.textContent ?? ''),
      }));
    }
  }

  // Figures: use figcaption only
  if (tag === 'FIGURE') {
    const figcaption = block.querySelector<HTMLElement>('figcaption');
    return [{
      element: block,
      text: normalizeTtsText(figcaption?.textContent ?? ''),
    }];
  }

  // Default: whole block
  return [{
    element: block,
    text: normalizeTtsText(block.textContent ?? ''),
  }];
}

function getMarkdownBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (el) => !SKIP_BLOCK_TAGS.has(el.tagName),
  ) as HTMLElement[];
}
