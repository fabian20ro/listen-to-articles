import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildChaptersList, highlightActiveChapter } from '../lib/chapter-renderer.js';

// Vitest disables CSS imports by default; exercise the shipped asset, not its stub.
const stylesheet = readFileSync('style.css', 'utf8');

describe('chapter playback appearance', () => {
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = stylesheet;
    document.head.append(style);
  });

  afterEach(() => {
    style.remove();
    document.body.innerHTML = '';
    delete document.documentElement.dataset.theme;
  });

  it.each(['dark', 'light', 'khaki'])('visibly tracks playback and clears on end in the %s theme', (theme) => {
    document.documentElement.dataset.theme = theme;
    document.body.innerHTML = `
      <article><h2>First chapter</h2><p class="paragraph" data-index="0">One.</p>
      <h3>Second chapter</h3><p class="paragraph" data-index="1">Two.</p></article>
      <button>Chapters</button><ul class="chapters-list"></ul>`;
    const list = document.querySelector('ul')!;
    const ranges = buildChaptersList({
      articleText: document.querySelector('article')!,
      chaptersList: list,
      chaptersBtn: document.querySelector('button')!,
      chaptersFilter: { clear() {} } as never,
      tts: { jumpToParagraph() {} } as never,
    });
    const appearance = (item: HTMLElement) => {
      const computed = getComputedStyle(item);
      return { weight: computed.fontWeight, marker: computed.boxShadow };
    };
    const firstIdle = appearance(ranges[0].li);
    const secondIdle = appearance(ranges[1].li);

    highlightActiveChapter(list, 0, ranges);
    expect(appearance(ranges[0].li)).not.toEqual(firstIdle);
    expect(Number(appearance(ranges[0].li).weight)).toBeGreaterThanOrEqual(600);
    expect(appearance(ranges[0].li).marker).not.toBe(firstIdle.marker);
    expect(appearance(ranges[1].li)).toEqual(secondIdle);

    highlightActiveChapter(list, 1, ranges);
    expect(appearance(ranges[0].li)).toEqual(firstIdle);
    expect(appearance(ranges[1].li)).not.toEqual(secondIdle);

    highlightActiveChapter(list, -1, ranges);
    expect(appearance(ranges[0].li)).toEqual(firstIdle);
    expect(appearance(ranges[1].li)).toEqual(secondIdle);
  });
});
