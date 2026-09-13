/**
 * Queue list UI rendering and drag-and-drop reorder logic.
 *
 * Extracted from app.ts to reduce the main orchestrator's size.
 * Handles: badge, count, empty state, "next" row, list rendering,
 * and touch/mouse drag-and-drop reordering.
 */

import type { QueueItem } from './queue-store.js';

export interface QueueRendererRefs {
  queueBadge: HTMLElement;
  queueCount: HTMLElement;
  queueEmpty: HTMLElement;
  queueList: HTMLElement;
  nextArticleRow: HTMLElement;
  nextArticleTitle: HTMLElement;
}

export interface QueueRendererCallbacks {
  onItemClick(itemId: string): void;
  onItemShare(item: QueueItem): void;
  onItemRemove(itemId: string): void;
  onReorder(reorderedIds: string[]): void;
}

export class QueueRenderer {
  private readonly refs: QueueRendererRefs;
  private readonly cb: QueueRendererCallbacks;
  private dragState: DragState | null = null;
  private countdownElement: HTMLElement | null = null;

  constructor(
    refs: QueueRendererRefs,
    callbacks: QueueRendererCallbacks,
    private readonly getCountdownSeconds: () => number = () => 0,
  ) {
    this.refs = refs;
    this.cb = callbacks;
    this.initDragListeners();
  }

  /**
   * Update the auto-advance countdown shown in the queue list area.
   * Visible with the remaining seconds while a countdown is running;
   * hidden when it is not.
   */
  updateCountdown(): void {
    if (!this.countdownElement) return;
    const seconds = this.getCountdownSeconds();
    if (seconds > 0) {
      this.countdownElement.textContent = `Next in ${seconds}s`;
      this.countdownElement.classList.remove('hidden');
    } else {
      this.countdownElement.classList.add('hidden');
    }
  }

  render(items: QueueItem[], currentIndex: number): void {
    const { refs } = this;

    // Badge on hamburger icon
    if (items.length > 0) {
      refs.queueBadge.textContent = String(Math.min(items.length, 99));
      refs.queueBadge.classList.remove('hidden');
    } else {
      refs.queueBadge.classList.add('hidden');
    }

    // Count in drawer header
    refs.queueCount.textContent = String(items.length);

    // Empty state
    refs.queueEmpty.classList.toggle('hidden', items.length > 0);
    refs.queueList.classList.toggle('hidden', items.length === 0);

    // "Next:" row in player
    const nextItem = items[currentIndex + 1];
    if (nextItem) {
      refs.nextArticleTitle.textContent = nextItem.title;
      refs.nextArticleRow.classList.remove('hidden');
    } else {
      refs.nextArticleRow.classList.add('hidden');
    }

    // Render list
    refs.queueList.innerHTML = '';
    items.forEach((item, idx) => {
      refs.queueList.appendChild(this.buildListItem(item, idx, currentIndex));
    });
    refs.queueList.appendChild(this.buildCountdownRow());
    this.updateCountdown();
  }

  /** Countdown row rendered at the bottom of the queue list area. */
  private buildCountdownRow(): HTMLElement {
    if (!this.countdownElement) {
      this.countdownElement = document.createElement('li');
      this.countdownElement.className = 'queue-countdown';
      this.countdownElement.setAttribute('role', 'status');
      this.countdownElement.classList.add('hidden');
    }
    return this.countdownElement;
  }

  // ── List item construction ──────────────────────────────────────

  private buildListItem(item: QueueItem, idx: number, currentIndex: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'queue-item' + (idx === currentIndex ? ' playing' : '');
    li.setAttribute('role', 'listitem');
    li.tabIndex = 0;
    li.dataset.itemId = item.id;

    li.appendChild(this.buildDragHandle());
    li.appendChild(this.buildIndicator(idx === currentIndex));
    li.appendChild(this.buildInfo(item));
    li.appendChild(this.buildActions(item));

    li.addEventListener('click', () => this.cb.onItemClick(item.id));
    li.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === li) {
        e.preventDefault();
        this.cb.onItemClick(item.id);
      }
    });
    return li;
  }

  private buildDragHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'queue-drag-handle';
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
    return handle;
  }

  private buildIndicator(isCurrent: boolean): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'queue-item-indicator';
    if (isCurrent) {
      indicator.innerHTML = '<div class="eq-bars"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>';
    }
    return indicator;
  }

  private buildInfo(item: QueueItem): HTMLElement {
    const info = document.createElement('div');
    info.className = 'queue-item-info';

    const title = document.createElement('div');
    title.className = 'queue-item-title';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'queue-item-meta';
    meta.textContent = [item.siteName, `${item.estimatedMinutes} min`].filter(Boolean).join(' \u00B7 ');

    info.appendChild(title);
    info.appendChild(meta);
    return info;
  }

  private buildActions(item: QueueItem): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'queue-item-actions';

    const shareBtn = document.createElement('button');
    shareBtn.className = 'icon-btn';
    shareBtn.setAttribute('aria-label', 'Share');
    shareBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onItemShare(item);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn';
    deleteBtn.setAttribute('aria-label', 'Remove');
    deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onItemRemove(item.id);
    });

    actions.appendChild(shareBtn);
    actions.appendChild(deleteBtn);
    return actions;
  }

  // ── Drag-and-drop ──────────────────────────────────────────────

  private initDragListeners(): void {
    const { queueList } = this.refs;

    queueList.addEventListener('mousedown', (e) => {
      const handle = (e.target as HTMLElement).closest('.queue-drag-handle');
      if (!handle) return;
      e.preventDefault();
      const li = handle.closest('.queue-item') as HTMLElement | null;
      if (!li?.dataset.itemId) return;
      this.startDrag(li.dataset.itemId, e.clientY, li);

      const onMove = (ev: MouseEvent) => this.moveDrag(ev.clientY);
      const onUp = () => {
        this.endDrag();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    queueList.addEventListener('touchstart', (e) => {
      const handle = (e.target as HTMLElement).closest('.queue-drag-handle');
      if (!handle) return;
      const li = handle.closest('.queue-item') as HTMLElement | null;
      if (!li?.dataset.itemId) return;
      this.startDrag(li.dataset.itemId, getY(e), li);

      const onMove = (ev: TouchEvent) => {
        ev.preventDefault();
        this.moveDrag(getY(ev));
      };
      const onEnd = () => {
        this.endDrag();
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
    }, { passive: false });
  }

  private startDrag(itemId: string, startY: number, originalLi: HTMLElement): void {
    const rect = originalLi.getBoundingClientRect();
    const clone = originalLi.cloneNode(true) as HTMLElement;
    clone.className = 'queue-item queue-item-dragging';
    clone.style.position = 'fixed';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = rect.width + 'px';
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);

    originalLi.classList.add('queue-item-placeholder');

    this.dragState = { itemId, startY, initialTop: rect.top, clone, placeholder: originalLi };
    this.refs.queueList.classList.add('reordering');
  }

  private moveDrag(clientY: number): void {
    if (!this.dragState) return;
    const dy = clientY - this.dragState.startY;
    this.dragState.clone.style.top = (this.dragState.initialTop + dy) + 'px';

    const items = Array.from(this.refs.queueList.children) as HTMLElement[];
    const currentIdx = items.indexOf(this.dragState.placeholder);

    for (let i = 0; i < items.length; i++) {
      if (i === currentIdx) continue;
      const r = items[i].getBoundingClientRect();
      const midY = r.top + r.height / 2;
      if (i < currentIdx && clientY < midY) {
        this.refs.queueList.insertBefore(this.dragState.placeholder, items[i]);
        break;
      }
      if (i > currentIdx && clientY > midY) {
        this.refs.queueList.insertBefore(this.dragState.placeholder, items[i].nextSibling);
        break;
      }
    }
  }

  private endDrag(): void {
    if (!this.dragState) return;
    this.dragState.clone.remove();
    this.dragState.placeholder.classList.remove('queue-item-placeholder');
    this.refs.queueList.classList.remove('reordering');

    const reorderedIds = Array.from(this.refs.queueList.children)
      .map((li) => (li as HTMLElement).dataset.itemId)
      .filter(Boolean) as string[];

    this.cb.onReorder(reorderedIds);
    this.dragState = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

interface DragState {
  itemId: string;
  startY: number;
  initialTop: number;
  clone: HTMLElement;
  placeholder: HTMLElement;
}

function getY(e: TouchEvent): number {
  return e.touches[0].clientY;
}
