/**
 * Queue controller — orchestrates the article queue, auto-advance,
 * and media-session integration for playlist-style playback.
 */

import type { ArticleController } from './article-controller.js';
import type { TTSEngine } from './tts-engine.js';
import type { Article } from './extractor.js';
import { isValidArticleUrl } from './url-utils.js';
import {
  loadQueue,
  addToQueue,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  createQueueItem,
  type QueueItem,
} from './queue-store.js';
import {
  saveArticleContent,
  loadArticleContent,
  deleteArticleContent,
  clearArticleContent,
  toStorable,
  fromStorable,
} from './article-content-store.js';
import { EventEmitter } from './event-emitter.js';

export interface QueueCallbacks {
  onQueueChange(items: QueueItem[], currentIndex: number): void;
  onAutoAdvanceCountdown(nextTitle: string): void;
  onAutoAdvanceCancelled(): void;
  onError(msg: string): void;
}

/** Typed events emitted by QueueController for decoupled consumers. */
export type QueueEvents = {
  queueChanged: { items: QueueItem[]; currentIndex: number };
  autoAdvanceStarted: { nextTitle: string };
  autoAdvanceCancelled: void;
  error: { message: string };
};

export interface QueueControllerOptions {
  articleController: ArticleController;
  tts: TTSEngine;
  callbacks: QueueCallbacks;
}

const AUTO_ADVANCE_DELAY_MS = 2000;

export class QueueController {
  private items: QueueItem[];
  private currentIndex = -1;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private _isLoadingItem = false;
  private readonly ac: ArticleController;
  private readonly tts: TTSEngine;
  private readonly cb: QueueCallbacks;

  /** Typed event bus for decoupled consumers. Subscribe via `events.on(...)`. */
  readonly events = new EventEmitter<QueueEvents>();

  constructor(opts: QueueControllerOptions) {
    this.ac = opts.articleController;
    this.tts = opts.tts;
    this.cb = opts.callbacks;
    this.items = loadQueue();
  }

  // ── Accessors ───────────────────────────────────────────────────

  getItems(): QueueItem[] {
    return this.items;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /** True while a queue-driven article load is in progress. */
  isLoadingItem(): boolean {
    return this._isLoadingItem;
  }

  getCurrentItem(): QueueItem | null {
    return this.items[this.currentIndex] ?? null;
  }

  hasNext(): boolean {
    return this.currentIndex < this.items.length - 1;
  }

  getNextItem(): QueueItem | null {
    return this.items[this.currentIndex + 1] ?? null;
  }

  // ── Queue mutations ─────────────────────────────────────────────

  /** Add a freshly-extracted article to the queue. Returns the new item. */
  addArticle(article: Article): QueueItem {
    const item = createQueueItem(article);
    this.items = addToQueue(this.items, item);
    this.notify();

    // For local files (no URL), persist article content in IndexedDB
    if (!item.url || !isValidArticleUrl(item.url)) {
      void saveArticleContent(toStorable(article, item.id));
    }

    return item;
  }

  /** Remove an item by id. Adjusts currentIndex if needed. */
  removeItem(id: string): void {
    const removedIdx = this.items.findIndex((i) => i.id === id);
    if (removedIdx === -1) return;

    // Clean up stored content for local files
    const item = this.items[removedIdx];
    if (!item.url || !isValidArticleUrl(item.url)) {
      void deleteArticleContent(id);
    }

    this.items = removeFromQueue(this.items, id);

    if (removedIdx < this.currentIndex) {
      this.currentIndex--;
    } else if (removedIdx === this.currentIndex) {
      // Removed the currently playing item — stop playback
      this.tts.stop();
      this.currentIndex = -1;
    }
    this.notify();
  }

  /** Replace entire queue order. */
  reorder(newOrder: QueueItem[]): void {
    // Find where the current item ended up
    const currentId = this.getCurrentItem()?.id;
    this.items = reorderQueue(newOrder);
    if (currentId) {
      this.currentIndex = this.items.findIndex((i) => i.id === currentId);
    }
    this.notify();
  }

  /** Clear the entire queue. Stops playback. */
  clearAll(): void {
    this.tts.stop();
    this.items = [];
    this.currentIndex = -1;
    clearQueue();
    void clearArticleContent();
    this.notify();
  }

  // ── Playback ────────────────────────────────────────────────────

  /**
   * Set an item as current (by id) and load it for playback.
   * Does NOT start playing — caller should call tts.play() after.
   */
  async playItem(id: string): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;

    this.cancelAutoAdvance();
    this.currentIndex = idx;
    const item = this.items[idx];
    this.notify();

    this._isLoadingItem = true;
    try {
      if (item.url && isValidArticleUrl(item.url)) {
        await this.ac.loadArticleFromUrl(item.url);
      } else {
        // Local file — load from IndexedDB stored content
        await this.loadFromStoredContent(item);
      }
    } finally {
      this._isLoadingItem = false;
    }
  }

  /** Advance to the next queue item and start playing. */
  async playNext(): Promise<void> {
    if (!this.hasNext()) return;
    const nextIndex = this.currentIndex + 1;
    const item = this.items[nextIndex];

    this.currentIndex = nextIndex;
    this.notify();
    this._isLoadingItem = true;
    try {
      if (item.url && isValidArticleUrl(item.url)) {
        await this.ac.loadArticleFromUrl(item.url);
      } else {
        await this.loadFromStoredContent(item);
      }
      this.tts.play();
    } catch {
      const msg = `Failed to load: ${item.title}`;
      this.cb.onError(msg);
      this.events.emit('error', { message: msg });
      // Auto-skip on failure — preserve queue flow like a media player
      if (this.hasNext()) void this.playNext();
    } finally {
      this._isLoadingItem = false;
    }
  }

  /**
   * Mark an item as current by matching the article URL.
   * Used when ArticleController loads an article and we need to sync queue state.
   */
  syncCurrentByUrl(url: string): void {
    const idx = this.items.findIndex((i) => i.url === url);
    if (idx !== -1) {
      this.currentIndex = idx;
      this.notify();
    }
  }

  /** Mark an item as current by matching the item id. */
  syncCurrentById(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.currentIndex = idx;
      this.notify();
    }
  }

  // ── Auto-advance ───────────────────────────────────────────────

  /**
   * Called when TTSEngine.onEnd fires.
   * If there's a next item, starts the auto-advance countdown.
   */
  handleArticleEnd(): void {
    if (!this.hasNext() || this.currentIndex < 0) return;

    const next = this.getNextItem();
    if (!next) return;

    this.cb.onAutoAdvanceCountdown(next.title);
    this.events.emit('autoAdvanceStarted', { nextTitle: next.title });

    this.autoAdvanceTimer = setTimeout(() => {
      this.autoAdvanceTimer = null;
      void this.playNext();
    }, AUTO_ADVANCE_DELAY_MS);
  }

  /** Cancel an in-progress auto-advance countdown. */
  cancelAutoAdvance(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
      this.cb.onAutoAdvanceCancelled();
      this.events.emit('autoAdvanceCancelled');
    }
  }

  /** Skip the countdown and advance immediately. */
  skipToNext(): void {
    this.cancelAutoAdvance();
    void this.playNext();
  }

  // ── Share ──────────────────────────────────────────────────────

  async shareItem(item: QueueItem): Promise<void> {
    if (!item.url || !isValidArticleUrl(item.url)) return;

    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url: item.url });
      } else {
        await navigator.clipboard.writeText(item.url);
      }
    } catch {
      // Share cancelled or clipboard failed — ignore
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private async loadFromStoredContent(item: QueueItem): Promise<void> {
    const stored = await loadArticleContent(item.id);
    if (!stored) {
      throw new Error('Content no longer available. Re-open the file to listen again.');
    }

    await this.ac.loadArticleFromStored(fromStorable(stored));
  }

  private notify(): void {
    this.cb.onQueueChange(this.items, this.currentIndex);
    this.events.emit('queueChanged', { items: this.items, currentIndex: this.currentIndex });
  }
}
