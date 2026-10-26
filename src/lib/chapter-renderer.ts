/**
 * Chapter list renderer — builds a navigable list of headings from
 * the rendered article body and syncs TTS position on click.
 *
 * Extracted from app.ts for separation of concerns.
 */

import type { TTSEngine } from './tts-engine.js';
import type { ListFilter } from './list-filter.js';

export interface ChapterRendererOptions {
  articleText: HTMLElement;
  chaptersList: HTMLElement;
  chaptersBtn: HTMLElement;
  chaptersFilter: ListFilter;
  tts: TTSEngine;
  onChapterClick?: () => void;
}

/**
 * TTS paragraph range covered by one chapter list item: the
 * `.paragraph[data-index]` blocks from the chapter's heading to the
 * next heading, in document order. Headings with no paragraphs
 * keep start = end = -1 so they never match.
 */
export interface ChapterRange {
  start: number;
  end: number;
  li: HTMLLIElement;
}

/** Build the chapters list from headings in the article body. */
export function buildChaptersList(options: ChapterRendererOptions): ChapterRange[] {
  const { articleText, chaptersList, chaptersBtn, chaptersFilter, tts, onChapterClick } = options;

  const missing = [];
  if (!articleText) missing.push('articleText');
  if (!chaptersList) missing.push('chaptersList');
  if (!chaptersBtn) missing.push('chaptersBtn');
  if (!chaptersFilter || typeof chaptersFilter.clear !== 'function') missing.push('chaptersFilter');
  if (!tts || typeof tts.jumpToParagraph !== 'function') missing.push('tts');
  if (missing.length > 0) {
    throw new TypeError(`ChapterRenderer: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
  }

  chaptersFilter.clear();

  if (articleText.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').length === 0) {
    (chaptersBtn as HTMLButtonElement).disabled = true;
    return [];
  }

  (chaptersBtn as HTMLButtonElement).disabled = false;
  chaptersList.innerHTML = '';

  const ranges: ChapterRange[] = [];
  let current: ChapterRange | null = null;

  // Walk the body in document order. Each valid heading starts a new
  // chapter range; each .paragraph[data-index] block extends the range
  // of the most recent heading (a heading that is itself a paragraph
  // block belongs to its own chapter).
  const nodes = articleText.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, .paragraph[data-index]',
  );
  nodes.forEach((node) => {
    if (/^H[1-6]$/.test(node.tagName)) {
      const level = parseInt(node.tagName.charAt(1), 10);
      const text = node.textContent?.trim() ?? '';
      if (!Number.isNaN(level) && level >= 1 && level <= 6 && text) {
        const li = document.createElement('li');
        li.className = 'chapter-item';
        li.dataset.level = String(level);
        li.textContent = text;
        li.addEventListener('click', () => {
          // Sync TTS to this heading's paragraph so audio matches scroll.
          // The heading itself may be a .paragraph, or we walk forward to
          // find the first .paragraph sibling.
          let target: HTMLElement | null = node.classList.contains('paragraph')
            ? node : null;
          if (!target) {
            let sibling: Element | null = node;
            while (sibling) {
              if (sibling.classList.contains('paragraph') && (sibling as HTMLElement).dataset.index != null) {
                target = sibling as HTMLElement;
                break;
              }
              sibling = sibling.nextElementSibling;
            }
          }
          if (target?.dataset.index != null) {
            tts.jumpToParagraph(parseInt(target.dataset.index, 10));
          } else {
            // Heading at end of article — jump to the last paragraph
            const allParas = articleText.querySelectorAll<HTMLElement>('.paragraph[data-index]');
            if (allParas.length > 0) {
              tts.jumpToParagraph(parseInt(allParas[allParas.length - 1].dataset.index!, 10));
            }
          }

          node.scrollIntoView({ behavior: 'smooth', block: 'start' });
          onChapterClick?.();
        });
        chaptersList.appendChild(li);
        const range: ChapterRange = { start: -1, end: -1, li };
        ranges.push(range);
        current = range;
      } else {
        // Malformed or empty heading delimits a chapter but has no list
        // item — subsequent paragraphs belong to no existing range.
        current = null;
      }
    }
    if (current && node.dataset.index != null) {
      const index = parseInt(node.dataset.index, 10);
      if (!Number.isNaN(index)) {
        current.start = current.start < 0 ? index : Math.min(current.start, index);
        current.end = Math.max(current.end, index);
      }
    }
  });

  return ranges;
}

/**
 * Highlight the chapter list item whose range contains the given TTS
 * paragraph index, clearing every other highlight. An index of -1
 * (or one matching no range) clears all highlights.
 */
export function highlightActiveChapter(
  chaptersList: HTMLElement,
  paragraphIndex: number,
  ranges: ChapterRange[],
): void {
  chaptersList.querySelectorAll<HTMLElement>('.chapter-item--active').forEach((el) => {
    el.classList.remove('chapter-item--active');
  });
  if (paragraphIndex < 0) return;
  for (const range of ranges) {
    if (paragraphIndex >= range.start && paragraphIndex <= range.end) {
      range.li.classList.add('chapter-item--active');
      return;
    }
  }
}
