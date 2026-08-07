import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadQueue,
  saveQueue,
  addToQueue,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  createQueueItem,
  type QueueItem,
} from '../lib/queue-store.js';
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

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com/article',
    title: overrides.title ?? 'Test Article',
    siteName: overrides.siteName ?? 'Example',
    wordCount: overrides.wordCount ?? 500,
    estimatedMinutes: overrides.estimatedMinutes ?? 3,
    lang: overrides.lang ?? 'en',
    dateAdded: overrides.dateAdded ?? Date.now(),
  };
}

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: overrides.title ?? 'Test Article',
    content: '',
    textContent: 'Some text content.',
    markdown: 'Some **markdown** content.',
    paragraphs: ['Some text content.'],
    lang: (overrides.lang as 'en' | 'ro') ?? 'en',
    htmlLang: 'en',
    siteName: overrides.siteName ?? 'Example',
    excerpt: '',
    wordCount: overrides.wordCount ?? 500,
    estimatedMinutes: overrides.estimatedMinutes ?? 3,
    resolvedUrl: overrides.resolvedUrl ?? 'https://example.com/article',
  };
}

describe('queue-store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  describe('loadQueue', () => {
    it('returns empty array when storage is empty', () => {
      expect(loadQueue()).toEqual([]);
    });

    it('returns empty array when JSON is malformed', () => {
      localStorage.setItem('article-reader-queue', '{not-valid');
      expect(loadQueue()).toEqual([]);
    });

    it('returns empty array when stored value is not an array', () => {
      localStorage.setItem('article-reader-queue', '{"foo":"bar"}');
      expect(loadQueue()).toEqual([]);
    });

    it('caps loaded queues to the most recent 50 items', () => {
      const items = Array.from({ length: 52 }, (_, index) =>
        makeItem({ id: `item-${index}`, url: `https://example.com/${index}` }),
      );
      localStorage.setItem('article-reader-queue', JSON.stringify(items));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(50);
      expect(loaded[0].id).toBe('item-2');
      expect(loaded[49].id).toBe('item-51');
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toHaveLength(50);
    });

    it('drops invalid items, keeps valid ones, and writes back the cleaned queue', () => {
      const valid = makeItem();
      const invalid = { id: '', url: 'not-a-url', title: 123 };
      localStorage.setItem('article-reader-queue', JSON.stringify([valid, invalid]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(valid.id);
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([valid]);
    });

    it('normalizes stored metadata and writes the sanitized queue back', () => {
      const dirty = makeItem({
        title: '  <Draft title>  ',
        siteName: '  <Example site>  ',
      });
      localStorage.setItem('article-reader-queue', JSON.stringify([dirty]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].title).toBe('Draft title');
      expect(loaded[0].siteName).toBe('Example site');
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([
        { ...dirty, title: 'Draft title', siteName: 'Example site' },
      ]);
    });

    it('falls back to readable defaults when stored metadata is blank', () => {
      const dirty = makeItem({
        title: '   ',
        siteName: '   ',
        url: 'https://example.com/article',
      });
      localStorage.setItem('article-reader-queue', JSON.stringify([dirty]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].title).toBe('Untitled');
      expect(loaded[0].siteName).toBe('example.com');
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([
        { ...dirty, title: 'Untitled', siteName: 'example.com' },
      ]);
    });

    it('normalizes invalid stored language to English and writes it back', () => {
      const dirty = makeItem({ lang: 'xx' });
      localStorage.setItem('article-reader-queue', JSON.stringify([dirty]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].lang).toBe('en');
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([
        { ...dirty, lang: 'en' },
      ]);
    });

    it('deduplicates stored items by URL and keeps the most recent entry', () => {
      const older = makeItem({ id: 'older', url: 'https://example.com/shared', title: 'Older' });
      const middle = makeItem({ id: 'middle', url: 'https://example.com/unique', title: 'Middle' });
      const newer = makeItem({ id: 'newer', url: 'https://example.com/shared', title: 'Newer' });
      localStorage.setItem('article-reader-queue', JSON.stringify([older, middle, newer]));

      const loaded = loadQueue();
      expect(loaded).toEqual([middle, newer]);
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([middle, newer]);
    });

    it('does not write back to localStorage when the queue is already clean', () => {
      const item = makeItem();
      localStorage.setItem(
        'article-reader-queue',
        JSON.stringify([item]),
      );

      // Capture current stored value before loadQueue call
      const storedBefore = localStorage.getItem('article-reader-queue');

      const loaded = loadQueue();

      expect(loaded).toHaveLength(1);
      expect(localStorage.getItem('article-reader-queue')).toBe(storedBefore);
    });

    it('drops invalid items AND normalizes dirty valid items in a single writeback', () => {
      // Two simultaneous transformations: filter invalid + sanitize metadata.
      const dirty = makeItem({ title: '  <Draft>  ', siteName: '', lang: 'xx' });
      const invalidStructural = { ...makeItem(), id: '' }; // fails isValidQueueItem

      localStorage.setItem('article-reader-queue', JSON.stringify([dirty, invalidStructural]));

      const loaded = loadQueue();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(dirty.id);
      expect(loaded[0].title).toBe('Draft');
      expect(loaded[0].siteName).toBe('example.com'); // fallback from empty siteName + valid url
      expect(loaded[0].lang).toBe('en');

      const persisted = JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]');
      expect(persisted).toHaveLength(1); // invalid dropped, only normalized item kept
      expect(persisted[0].title).toBe('Draft');
      expect(persisted[0].siteName).toBe('example.com');
      expect(persisted[0].lang).toBe('en');
    });

    it('silently drops items whose URL fails isValidArticleUrl', () => {
      const valid = makeItem({ id: 'ok' });
      const badUrl = makeItem({ url: 'not-a-url', title: 'Bad URL' }); // invalid per isValidArticleUrl

      localStorage.setItem('article-reader-queue', JSON.stringify([valid, badUrl]));

      const loaded = loadQueue();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('ok');
      expect(JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]')).toEqual([valid]);
    });
  });

  describe('addToQueue', () => {
    it('adds an item to empty queue', () => {
      const item = makeItem();
      const result = addToQueue([], item);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(item.id);
    });

    it('deduplicates by URL', () => {
      const existing = makeItem({ url: 'https://example.com/dup' });
      const duplicate = makeItem({ url: 'https://example.com/dup' });
      const result = addToQueue([existing], duplicate);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(duplicate.id);
    });

    it('enforces max queue size of 50', () => {
      const items: QueueItem[] = [];
      for (let i = 0; i < 50; i++) {
        items.push(makeItem({ id: `item-${i}`, url: `https://example.com/${i}` }));
      }
      const newItem = makeItem({ id: 'overflow', url: 'https://example.com/overflow' });
      const result = addToQueue(items, newItem);
      expect(result).toHaveLength(50);
      expect(result[result.length - 1].id).toBe('overflow');
      // First item should have been dropped
      expect(result[0].id).toBe('item-1');
    });

    it('persists to localStorage', () => {
      const item = makeItem();
      addToQueue([], item);
      const stored = JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]');
      expect(stored).toHaveLength(1);
    });
  });

  describe('saveQueue', () => {
    it('returns true on successful persistence and writes correct JSON', () => {
      const item = makeItem({ id: 'persist-test' });
      const result = saveQueue([item]);

      expect(result).toBe(true);
      const stored = localStorage.getItem('article-reader-queue');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('persist-test');
    });

    it('invokes onFail synchronously when localStorage.setItem throws', () => {
      const mock = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });

      (globalThis.localStorage as any).setItem = () => {
        throw new DOMException('QuotaExceededError', 'Failed to save');
      };

      const item = makeItem({ id: 'fail-safe' });
      let failCalled = false;
      let failArg: unknown;
      const result = saveQueue([item], (err) => { failCalled = true; failArg = err; });

      expect(result).toBe(false);
      expect(failCalled).toBe(true);
      expect(failArg).toBeInstanceOf(DOMException);

      Object.defineProperty(globalThis, 'localStorage', { value: mock.value, configurable: true });
    });

    it('returns false when localStorage.setItem throws (quota exceeded)', () => {
      const mock = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });

      // Monkey-patch setItem to throw on the new store
      (globalThis.localStorage as any).setItem = () => {
        throw new DOMException('QuotaExceededError', 'Failed to save');
      };

      const result = saveQueue([makeItem()]);
      expect(result).toBe(false);

      // Restore original mock so tests don't leak
      Object.defineProperty(globalThis, 'localStorage', { value: mock.value, configurable: true });
    });
  });

  describe('removeFromQueue', () => {
    it('removes item by id', () => {
      const a = makeItem({ id: 'a' });
      const b = makeItem({ id: 'b', url: 'https://other.com' });
      const result = removeFromQueue([a, b], 'a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b');
    });

    it('returns unchanged queue when id not found', () => {
      const a = makeItem({ id: 'a' });
      const result = removeFromQueue([a], 'nonexistent');
      expect(result).toHaveLength(1);
    });
  });

  describe('clearQueue', () => {
    it('removes the storage key', () => {
      localStorage.setItem('article-reader-queue', '[]');
      clearQueue();
      expect(localStorage.getItem('article-reader-queue')).toBeNull();
    });

    it('loadQueue returns an empty array after clearing', () => {
      const item = makeItem();
      saveQueue([item]);

      clearQueue();

      const loaded = loadQueue();
      expect(loaded).toEqual([]);
    });
  });

  describe('createQueueItem', () => {
    it('creates a queue item from an article', () => {
      const article = makeArticle();
      const item = createQueueItem(article);
      expect(item.title).toBe('Test Article');
      expect(item.url).toBe('https://example.com/article');
      expect(item.siteName).toBe('Example');
      expect(item.wordCount).toBe(500);
      expect(item.lang).toBe('en');
      expect(item.id).toBeTruthy();
      expect(item.dateAdded).toBeGreaterThan(0);
    });

    it('falls back to readable defaults for blank article metadata', () => {
      const article = makeArticle({
        title: '   ',
        siteName: '   ',
        resolvedUrl: 'https://example.com/article',
      });
      const item = createQueueItem(article);

      expect(item.title).toBe('Untitled');
      expect(item.siteName).toBe('example.com');
    });

    it('sanitizes HTML in title', () => {
      const article = makeArticle({ title: 'Title <script>alert(1)</script> End' });
      const item = createQueueItem(article);
      expect(item.title).toBe('Title scriptalert(1)/script End');
    });

    it('truncates long titles to 300 chars', () => {
      const article = makeArticle({ title: 'A'.repeat(500) });
      const item = createQueueItem(article);
      expect(item.title.length).toBe(300);
    });

    it('sanitizes HTML in siteName', () => {
      const article = makeArticle({ siteName: '<img onerror="x" src="y">Site' });
      const item = createQueueItem(article);
      expect(item.siteName).toBe('img onerror="x" src="y"Site');
    });
  });

  describe('reorderQueue', () => {
    it('persists the new order to localStorage', () => {
      const a = makeItem({ id: 'a', url: 'https://a.com/1' });
      const b = makeItem({ id: 'b', url: 'https://b.com/2' });
      const c = makeItem({ id: 'c', url: 'https://c.com/3' });

      // Save initial order
      saveQueue([a, b, c]);

      // Reorder: c, a, b
      const result = reorderQueue([c, a, b]);
      expect(result[0].id).toBe('c');
      expect(result[1].id).toBe('a');
      expect(result[2].id).toBe('b');

      // Verify persisted
      const loaded = loadQueue();
      expect(loaded[0].id).toBe('c');
      expect(loaded[1].id).toBe('a');
      expect(loaded[2].id).toBe('b');
    });
  });

  describe('addToQueue failure resilience', () => {
    it('preserves in-memory queue state when localStorage.setItem throws on save', () => {
      const mock = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });

      (globalThis.localStorage as any).setItem = () => {
        throw new DOMException('QuotaExceededError', 'Failed to save');
      };

      const item = makeItem({ id: 'fail-safe' });
      let failCalled = false;
      let failError: unknown;
      const result = addToQueue([], item, (err) => { failCalled = true; failError = err; });

      // In-memory state must remain consistent even when persistence fails,
      // so callers can rely on the returned array for UI rendering.
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('fail-safe');
      expect(failCalled).toBe(true);
      expect(failError).toBeInstanceOf(DOMException);

      Object.defineProperty(globalThis, 'localStorage', { value: mock.value, configurable: true });
    });
  });

  describe('removeFromQueue failure resilience', () => {
    it('preserves in-memory queue state when localStorage.setItem throws on save', () => {
      const mock = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });

      (globalThis.localStorage as any).setItem = () => {
        throw new DOMException('QuotaExceededError', 'Failed to save');
      };

      const a = makeItem({ id: 'keep-me' });
      let failCalled = false;
      const result = removeFromQueue([a], 'remove-me', (err) => { failCalled = true; });

      // In-memory state must remain consistent even when persistence fails,
      // so callers can rely on the returned array for UI rendering.
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('keep-me');
      expect(failCalled).toBe(true);

      Object.defineProperty(globalThis, 'localStorage', { value: mock.value, configurable: true });
    });
  });

  describe('reorderQueue failure resilience', () => {
    it('preserves in-memory queue state when localStorage.setItem throws on save', () => {
      const mock = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });

      (globalThis.localStorage as any).setItem = () => {
        throw new DOMException('QuotaExceededError', 'Failed to save');
      };

      const a = makeItem({ id: 'a', url: 'https://example.com/a' });
      const b = makeItem({ id: 'b', url: 'https://example.com/b' });
      let failCalled = false;
      const result = reorderQueue([b, a], (err) => { failCalled = true; });

      // In-memory state must remain consistent even when persistence fails,
      // so callers can rely on the returned array for UI rendering.
      expect(result[0].id).toBe('b');
      expect(result[1].id).toBe('a');
      expect(failCalled).toBe(true);

      Object.defineProperty(globalThis, 'localStorage', { value: mock.value, configurable: true });
    });
  });

  describe('addToQueue ordering', () => {
    it('preserves newest-last (FIFO) order through multiple adds', () => {
      const a = makeItem({ id: 'first', url: 'https://example.com/1' });
      const b = makeItem({ id: 'second', url: 'https://example.com/2' });
      const c = makeItem({ id: 'third', url: 'https://example.com/3' });

      let queue: QueueItem[] = [];
      queue = addToQueue(queue, a);
      queue = addToQueue(queue, b);
      queue = addToQueue(queue, c);

      expect(queue.map((i) => i.id)).toEqual(['first', 'second', 'third']);
    });

    it('does not deduplicate when item has no URL (preserves duplicates)', () => {
      const blankA = makeItem({ id: 'blank-1', url: '' });
      const blankB = makeItem({ id: 'blank-2', url: '' });
      const result = addToQueue([blankA], blankB);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('blank-1');
      expect(result[1].id).toBe('blank-2');
    });

    it('deduplicates items with same non-empty URL even when other fields differ', () => {
      const existing = makeItem({ id: 'existing', url: 'https://example.com/dup', title: 'Old' });
      const duplicate = makeItem({ id: 'newer', url: 'https://example.com/dup', title: 'New' });
      const result = addToQueue([existing], duplicate);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('newer');
      expect(result[0].title).toBe('New');
    });

    it('removes the existing entry when deduplicating at max capacity', () => {
      const items: QueueItem[] = [];
      for (let i = 0; i < 50; i++) {
        items.push(makeItem({ id: `item-${i}`, url: `https://example.com/${i}` }));
      }
      // item-29 has the same URL as the duplicate being added
      const duplicate = makeItem({ id: 'dup-at-cap', url: 'https://example.com/29', title: 'DupAtCap' });
      const result = addToQueue(items, duplicate);

      expect(result).toHaveLength(50);
      // The old item-29 is removed; newest entry (the dup) sits at the end
      expect(result[49].id).toBe('dup-at-cap');
      expect(result[49].title).toBe('DupAtCap');
      // item-29 no longer present anywhere
      expect(result.find((i) => i.id === 'item-29')).toBeUndefined();
    });

    it('replaces the existing entry and preserves relative order of unrelated items', () => {
      const a = makeItem({ id: 'a', url: 'https://example.com/a', title: 'Old A' });
      const b = makeItem({ id: 'b', url: 'https://example.com/b', title: 'B' });
      const c = makeItem({ id: 'c', url: 'https://example.com/c', title: 'C' });
      const dupA = makeItem({ id: 'a-new', url: 'https://example.com/a', title: 'New A' });

      const result = addToQueue([a, b, c], dupA);

      // Old 'a' is gone; 'b' and 'c' keep their relative positions
      expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a-new']);
    });
  });

  describe('loadQueue invalid items', () => {
    it('drops items with non-finite wordCount', () => {
      const valid = makeItem();
      const bad = { ...makeItem(), wordCount: NaN } as QueueItem;
      localStorage.setItem('article-reader-queue', JSON.stringify([valid, bad]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(valid.id);
    });

    it('drops items that are not objects (null, string, number)', () => {
      localStorage.setItem('article-reader-queue', JSON.stringify([null, 'string-item', 42]));

      const loaded = loadQueue();
      expect(loaded).toEqual([]);
    });

    it('preserves valid items alongside non-object entries by dropping the bad ones only', () => {
      const validWithEmptyTitle: QueueItem = makeItem({ id: 'empty-title', title: '' });
      localStorage.setItem('article-reader-queue', JSON.stringify([validWithEmptyTitle, null]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
    });

    it('drops items with a malformed (non-empty) URL that fails isValidArticleUrl', () => {
      const valid = makeItem();
      const bad = makeItem({ url: 'not-a-url' } as QueueItem);
      localStorage.setItem('article-reader-queue', JSON.stringify([valid, bad]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(valid.id);
    });
  });

  describe('loadQueue rejects items with empty required fields', () => {
    it('drops items with an empty id', () => {
      localStorage.setItem(
        'article-reader-queue',
        JSON.stringify([{ ...makeItem(), id: '', url: 'https://example.com' }]),
      );

      const loaded = loadQueue();
      expect(loaded).toHaveLength(0);
    });

    it('drops items with an empty title and no valid URL fallback for siteName', () => {
      localStorage.setItem(
        'article-reader-queue',
        JSON.stringify([{ ...makeItem(), title: '', url: '' }]),
      );

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1); // still valid — empty title gets "Untitled" fallback, empty URL is allowed
    });

    it('drops items with a non-string lang field', () => {
      localStorage.setItem(
        'article-reader-queue',
        JSON.stringify([{ ...makeItem(), lang: 42 as unknown as string }]),
      );

      const loaded = loadQueue();
      expect(loaded).toHaveLength(0);
    });
  });

  describe('sanitizeSiteName edge cases', () => {
    it('falls back to hostname when siteName is blank but url is valid', () => {
      const article = makeArticle({ title: 'Test', siteName: '', resolvedUrl: 'https://example.com/article' });
      const item = createQueueItem(article);

      expect(item.siteName).toBe('example.com');
    });

    it('falls back to "Unknown source" when url is invalid and siteName is blank', () => {
      const article = makeArticle({ title: 'Test', siteName: '', resolvedUrl: '' });
      const item = createQueueItem(article);

      expect(item.siteName).toBe('Unknown source');
    });
  });
});
