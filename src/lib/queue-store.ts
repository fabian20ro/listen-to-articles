/**
 * Queue persistence — localStorage-backed article queue with schema validation.
 * Follows the same patterns as settings-store.ts (validate on load, drop corrupt entries).
 */

import { isValidArticleUrl } from './url-utils.js';
import { isLanguage } from './language-config.js';
import type { Article } from './extractor.js';
import { createLogger } from './logger.js';

const log = createLogger('QueueStore');

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  siteName: string;
  wordCount: number;
  estimatedMinutes: number;
  lang: string;
  dateAdded: number;
}

const STORAGE_KEY = 'article-reader-queue';
const MAX_QUEUE_SIZE = 50;

/** Strip angle brackets, cap string length, and fall back when the result is blank. */
function sanitizeMetadata(value: string, maxLength: number, fallback = ''): string {
  const cleaned = value.replace(/[<>]/g, '').trim().slice(0, maxLength);
  return cleaned || fallback;
}

function sanitizeSiteName(value: string, url: string): string {
  const cleaned = sanitizeMetadata(value, 100);
  if (cleaned) return cleaned;
  return url && isValidArticleUrl(url) ? new URL(url).hostname : 'Unknown source';
}

function normalizeLang(value: string): string {
  return isLanguage(value) ? value : 'en';
}

function normalizeQueueItem(item: QueueItem): QueueItem {
  return {
    ...item,
    title: sanitizeMetadata(item.title, 300, 'Untitled'),
    siteName: sanitizeSiteName(item.siteName, item.url),
    lang: normalizeLang(item.lang),
  };
}

function dedupeQueueItems(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>();
  const dedupedReversed: QueueItem[] = [];

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.url && seen.has(item.url)) continue;
    if (item.url) seen.add(item.url);
    dedupedReversed.push(item);
  }

  return dedupedReversed.reverse();
}

/** Type guard: validates every field of a QueueItem read from storage. */
function isValidQueueItem(item: unknown): item is QueueItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.id === 'string' && i.id.length > 0 &&
    typeof i.url === 'string' && (i.url === '' || isValidArticleUrl(i.url)) &&
    typeof i.title === 'string' &&
    typeof i.siteName === 'string' &&
    typeof i.wordCount === 'number' && Number.isFinite(i.wordCount) &&
    typeof i.estimatedMinutes === 'number' && Number.isFinite(i.estimatedMinutes) &&
    typeof i.lang === 'string' &&
    typeof i.dateAdded === 'number' && Number.isFinite(i.dateAdded)
  );
}

/** Load queue from localStorage, dropping any corrupt entries. */
export function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cleaned = parsed.filter(isValidQueueItem).slice(-MAX_QUEUE_SIZE);
    const normalized = cleaned.map(normalizeQueueItem);
    const deduped = dedupeQueueItems(normalized);
    const needsWriteback =
      deduped.length !== parsed.length ||
      deduped.some((item, index) =>
        item.title !== cleaned[index].title ||
        item.siteName !== cleaned[index].siteName ||
        item.lang !== cleaned[index].lang,
      );

    if (needsWriteback) {
      saveQueue(deduped);
    }
    return deduped;
  } catch (err) {
    log.warn('Failed to load queue from localStorage', err);
    return [];
  }
}

/** Persist queue to localStorage. Calls onFail synchronously if storage throws. Returns false on failure. */
export function saveQueue(items: QueueItem[], onFail?: (err: unknown) => void): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (err) {
    log.warn('Failed to save queue (quota exceeded?)', err);
    onFail?.(err);
    return false;
  }
}

/** Create a QueueItem from an extracted Article, sanitizing metadata. */
export function createQueueItem(article: Article): QueueItem {
  return {
    id: crypto.randomUUID(),
    url: article.resolvedUrl || '',
    title: sanitizeMetadata(article.title, 300, 'Untitled'),
    siteName: sanitizeSiteName(article.siteName, article.resolvedUrl || ''),
    wordCount: article.wordCount,
    estimatedMinutes: article.estimatedMinutes,
    lang: article.lang,
    dateAdded: Date.now(),
  };
}

/** Add an item to the queue. Enforces max size. Returns the new queue. */
export function addToQueue(items: QueueItem[], item: QueueItem, onFail?: (err: unknown) => void): QueueItem[] {
  // Prevent duplicates by URL
  const filtered = items.filter((i) => !item.url || i.url !== item.url);
  const updated = [...filtered, item].slice(-MAX_QUEUE_SIZE);
  saveQueue(updated, onFail);
  return updated;
}

/** Remove an item by id. Returns the new queue. */
export function removeFromQueue(items: QueueItem[], id: string, onFail?: (err: unknown) => void): QueueItem[] {
  const updated = items.filter((i) => i.id !== id);
  saveQueue(updated, onFail);
  return updated;
}

/** Replace the entire queue (for reordering). Returns the saved queue. */
export function reorderQueue(items: QueueItem[], onFail?: (err: unknown) => void): QueueItem[] {
  const deduped = dedupeQueueItems(items);
  saveQueue(deduped, onFail);
  return deduped;
}

/** Clear the entire queue. */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
