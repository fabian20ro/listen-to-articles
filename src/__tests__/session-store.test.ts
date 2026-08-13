import { beforeEach, describe, expect, it } from 'vitest';
import { clearLastArticle, loadLastArticle, saveLastArticle, type LastSessionData } from '../lib/session-store.js';
import type { Article } from '../lib/extractor.js';

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: overrides.title ?? 'Test Article',
    content: overrides.content ?? '',
    textContent: overrides.textContent ?? 'Some text content.',
    markdown: overrides.markdown ?? 'Some **markdown** content.',
    paragraphs: overrides.paragraphs ?? ['Some text content.'],
    lang: (overrides.lang as 'en' | 'ro') ?? 'en',
    htmlLang: overrides.htmlLang ?? 'en',
    siteName: overrides.siteName ?? 'Example',
    excerpt: overrides.excerpt ?? '',
    wordCount: overrides.wordCount ?? 500,
    estimatedMinutes: overrides.estimatedMinutes ?? 3,
    resolvedUrl: overrides.resolvedUrl ?? 'https://example.com/article',
  };
}

describe('session-store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  describe('loadLastArticle', () => {
    it('returns null when storage is empty', () => {
      expect(loadLastArticle()).toBeNull();
    });

    it('returns the saved article when storage is valid', () => {
      const payload: LastSessionData = { article: makeArticle(), savedAt: 123456789 };
      localStorage.setItem('article-reader-last-article', JSON.stringify(payload));

      expect(loadLastArticle()).toEqual(payload);
    });

    it('removes malformed storage before returning null', () => {
      localStorage.setItem('article-reader-last-article', '{not-valid-json');

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes invalid session shapes before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { title: 'Broken' }, savedAt: 'not-a-number' }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes entries missing savedAt before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: makeArticle() }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles with non-string paragraphs before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({
          article: { ...makeArticle(), paragraphs: ['valid', 123] },
          savedAt: 123456789,
        }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes non-finite timestamps before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: makeArticle(), savedAt: Number.NaN }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes +Infinity timestamps before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: makeArticle(), savedAt: Number.POSITIVE_INFINITY }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes -Infinity timestamps before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: makeArticle(), savedAt: Number.NEGATIVE_INFINITY }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles with invalid field types before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { ...makeArticle(), title: 42 }, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles where a numeric field is a string before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { ...makeArticle(), wordCount: '500' }, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles where the article field is a non-object primitive before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: 'a string', savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles where the article field is null before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: null, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles where an untested string field is invalid before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { ...makeArticle(), content: 42 }, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles where an untested numeric field is a string before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { ...makeArticle(), estimatedMinutes: '3' }, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes articles missing required fields before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        JSON.stringify({ article: { title: 'Hello' }, savedAt: 123456789 }),
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('removes storage containing a JSON-null value before returning null', () => {
      localStorage.setItem(
        'article-reader-last-article',
        'null',
      );

      expect(loadLastArticle()).toBeNull();
      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
    });

    it('returns null without crashing when localStorage throws on read', () => {
      const throwingStorage = {
        getItem: (_key: string) => { throw new Error('storage unavailable'); },
        setItem: (_key: string, _value: string) => {},
        removeItem: (_key: string) => {},
        clear: () => {},
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: throwingStorage,
        configurable: true,
      });

      expect(() => loadLastArticle()).not.toThrow();
      expect(loadLastArticle()).toBeNull();
    });
  });

  describe('saveLastArticle', () => {
    it('persists the article with a savedAt timestamp', () => {
      const article = makeArticle();
      saveLastArticle(article);

      const stored = JSON.parse(localStorage.getItem('article-reader-last-article') ?? '{}');
      expect(stored.article).toEqual(article);
      expect(stored.savedAt).toEqual(expect.any(Number));
    });

    it('round-trips an article through save and load', () => {
      const article = makeArticle({ title: 'Round-Trip Article' });
      saveLastArticle(article);

      const loaded = loadLastArticle();
      expect(loaded).not.toBeNull();
      expect(loaded!.article.title).toBe('Round-Trip Article');
      const savedAt = loaded!.savedAt;
      expect(typeof savedAt).toBe('number');
      expect(savedAt === savedAt && savedAt !== Infinity && savedAt !== -Infinity).toBe(true);
    });

    it('propagates storage write errors (no try/catch on setItem)', () => {
      const throwingStorage = {
        getItem: (_key: string) => null,
        setItem: (_key: string, _value: string) => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
        removeItem: (_key: string) => {},
        clear: () => {},
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: throwingStorage,
        configurable: true,
      });

      expect(() => saveLastArticle(makeArticle())).toThrow(DOMException);
    });
  });

  describe('clearLastArticle', () => {
    it('removes the stored article from localStorage', () => {
      const article = makeArticle({ title: 'Clear Me' });
      saveLastArticle(article);
      clearLastArticle();

      expect(localStorage.getItem('article-reader-last-article')).toBeNull();
      expect(loadLastArticle()).toBeNull();
    });

    it('does nothing when no article was saved', () => {
      clearLastArticle();
      expect(loadLastArticle()).toBeNull();
    });

    it('returns without crashing when localStorage throws on removeItem', () => {
      const throwingStorage = {
        getItem: (_key: string) => null,
        setItem: (_key: string, _value: string) => {},
        removeItem: (_key: string) => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
        clear: () => {},
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: throwingStorage,
        configurable: true,
      });

      expect(() => clearLastArticle()).not.toThrow();
    });
  });
});
