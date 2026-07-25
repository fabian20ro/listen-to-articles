/**
 * IndexedDB-backed store for article content.
 * Used to persist local file article content (paragraphs, markdown, title)
 * so that queue items for local files can be replayed.
 * URL-based articles are re-fetched, so they don't need this.
 */

import type { Article } from './extractor.js';
import { createLogger } from './logger.js';

const log = createLogger('ContentStore');

/** Storable subset of Article: everything except content and resolvedUrl, plus an id. */
export type StoredArticleContent = Pick<Article,
  'title' | 'markdown' | 'paragraphs' | 'textContent' | 'lang' |
  'htmlLang' | 'siteName' | 'excerpt' | 'wordCount' | 'estimatedMinutes'
> & { id: string };

/** Convert an Article + queue item id into StoredArticleContent. */
export function toStorable(article: Article, id: string): StoredArticleContent {
  return {
    id,
    title: article.title,
    markdown: article.markdown,
    paragraphs: article.paragraphs,
    textContent: article.textContent,
    lang: article.lang,
    htmlLang: article.htmlLang,
    siteName: article.siteName,
    excerpt: article.excerpt,
    wordCount: article.wordCount,
    estimatedMinutes: article.estimatedMinutes,
  };
}

/** Validate that a stored record has the required identity and shape. */
export function validateStoredArticle(stored: StoredArticleContent): boolean {
  if (!stored || typeof stored !== 'object') return false;
  if (typeof stored.id !== 'string' || stored.id.length === 0) return false;
  // Required storable fields — partial writes produce garbage we must reject.
  const requiredFields: Array<keyof StoredArticleContent> = [
    'title', 'markdown', 'textContent', 'lang', 'htmlLang', 'siteName', 'excerpt', 'wordCount', 'estimatedMinutes',
  ];
  for (const field of requiredFields) {
    if (!(field in stored)) return false;
  }
  return true;
}

/** Reconstruct an Article from StoredArticleContent. */
export function fromStorable(stored: StoredArticleContent): Article {
  return {
    title: stored.title,
    content: '',
    textContent: stored.textContent,
    markdown: stored.markdown,
    paragraphs: stored.paragraphs,
    lang: stored.lang,
    htmlLang: stored.htmlLang,
    siteName: stored.siteName,
    excerpt: stored.excerpt,
    wordCount: stored.wordCount,
    estimatedMinutes: stored.estimatedMinutes,
    resolvedUrl: '',
  };
}

const DB_NAME = 'article-reader-content';
const DB_VERSION = 1;
const STORE_NAME = 'articles';

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      _db = request.result;
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db);
    };
    request.onerror = () => reject(request.error);
  });
}

/** Save article content for a queue item (local files only). */
export async function saveArticleContent(content: StoredArticleContent): Promise<void> {
  try {
    // Reject malformed records at write time — partial writes must not corrupt the store.
    if (!validateStoredArticle(content)) {
      log.warn('Refused to save malformed article content (validation failed)');
      return;
    }

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(content);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    log.warn('Failed to save article content (quota exceeded?)', err);
  }
}

/** Load stored article content by queue item id. Returns null if not found. */
export async function loadArticleContent(id: string): Promise<StoredArticleContent | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    return await new Promise<StoredArticleContent | null>((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result ?? null;
        if (result && validateStoredArticle(result)) {
          resolve(result);
        } else {
          log.warn('Loaded article content has invalid shape, discarding', request.result);
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    log.warn('Failed to load article content', err);
    return null;
  }
}

/** Delete stored article content for a queue item. */
export async function deleteArticleContent(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    log.warn('Failed to delete article content', err);
  }
}

/** Delete all stored article content. */
export async function clearArticleContent(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    log.warn('Failed to clear article content store', err);
  }
}

/** Check whether any article content is stored. */
export async function isEmptyArticleContent(): Promise<boolean> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const countRequest = tx.objectStore(STORE_NAME).count();
    return await new Promise<boolean>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result === 0);
      countRequest.onerror = () => reject(countRequest.error);
    });
  } catch (err) {
    log.warn('Failed to check article content emptiness', err);
    return true; // assume empty on error — safer than blocking the UI
  }
}
