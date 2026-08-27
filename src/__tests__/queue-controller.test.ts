import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueController } from '../lib/queue-controller.js';
import type { QueueItem } from '../lib/queue-store.js';

function storageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

function item(id: string): QueueItem {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    siteName: 'Example',
    wordCount: 10,
    estimatedMinutes: 1,
    lang: 'en',
    dateAdded: 1,
  };
}

describe('QueueController', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock(), configurable: true,
    });
  });

  it('advances past a failed item before auto-skipping to the next one', async () => {
    localStorage.setItem('article-reader-queue', JSON.stringify([
      item('broken'), item('working'),
    ]));
    const loadArticleFromUrl = vi.fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(undefined);
    const play = vi.fn();
    const onError = vi.fn();
    const controller = new QueueController({
      articleController: { loadArticleFromUrl } as never,
      tts: { play, stop: vi.fn() } as never,
      callbacks: {
        onQueueChange: vi.fn(),
        onAutoAdvanceCountdown: vi.fn(),
        onAutoAdvanceCancelled: vi.fn(),
        onError,
      },
    });

    await controller.playNext();
    await vi.waitFor(() => expect(loadArticleFromUrl).toHaveBeenCalledTimes(2));

    expect(controller.getCurrentIndex()).toBe(1);
    expect(onError).toHaveBeenCalledWith('Failed to load: broken');
    expect(play).toHaveBeenCalledOnce();
  });
});
