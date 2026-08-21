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

/** Build the chapters list from headings in the article body. */
export function buildChaptersList(options: ChapterRendererOptions): void {
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
  const headings = articleText.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');

  if (headings.length === 0) {
    (chaptersBtn as HTMLButtonElement).disabled = true;
    return;
  }

  (chaptersBtn as HTMLButtonElement).disabled = false;
  chaptersList.innerHTML = '';

  headings.forEach((heading) => {
    const level = parseInt(heading.tagName.charAt(1), 10);
    if (Number.isNaN(level) || level < 1 || level > 6) return; // malformed heading tag — skip to avoid "NaN" dataset leakage into filtered list
    const text = heading.textContent?.trim() ?? '';
    if (!text) return;

    const li = document.createElement('li');
    li.className = 'chapter-item';
    li.dataset.level = String(level);
    li.textContent = text;
    li.addEventListener('click', () => {
      // Sync TTS to this heading's paragraph so audio matches scroll.
      // The heading itself may be a .paragraph, or we walk forward to
      // find the first .paragraph sibling.
      let target: HTMLElement | null = heading.classList.contains('paragraph')
        ? heading : null;
      if (!target) {
        let sibling: Element | null = heading;
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

      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onChapterClick?.();
    });
    chaptersList.appendChild(li);
  });
}
