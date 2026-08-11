import { createLogger } from './logger.js';

const log = createLogger('PWA');

export interface PwaUpdateManagerOptions {
  onUpdateReady?: () => void;
  onStatus?: (status: string) => void;
  onUpdateApplied?: () => void;
  isPlaybackActive?: () => boolean;
  reload?: () => void;
}

type PwaUpdateActionResult = 'reloaded' | 'deferred' | 'no-change' | 'failed';

export class PwaUpdateManager {
  private registration: ServiceWorkerRegistration | undefined;
  private refreshing = false;
  private pendingReload = false;

  // Debounce visibility-change events — rapid tab/app switching can fire this
  // many times in quick succession. Coalesce into a single check ~500ms after the
  // last event to avoid spamming the network with service-worker update requests.
  private _visibilityCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PwaUpdateManagerOptions = {}) {}

  async init(scriptUrl = 'sw.js'): Promise<void> {
    const sw = (navigator as any).serviceWorker;
    if (!sw) {
      return;
    }

    sw.addEventListener('controllerchange', this.handleControllerChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.registration = await navigator.serviceWorker
      .register(scriptUrl, { updateViaCache: 'none' })
      .catch((err) => {
        log.warn('Service worker registration failed', err);
        this.options.onStatus?.('Offline support unavailable.');
        return undefined;
      });

    await this.checkForUpdates({ silent: true });
  }

  async checkForUpdates({ silent = false }: { silent?: boolean } = {}): Promise<PwaUpdateActionResult> {
    if (!this.registration) {
      return 'no-change';
    }

    if (!silent) {
      this.options.onStatus?.('Checking...');
    }

    try {
      await this.registration.update();
      if (!silent) {
        this.options.onStatus?.('Up to date.');
      }
      return 'no-change';
    } catch {
      if (!silent) {
        this.options.onStatus?.('Update check failed. Try again.');
      }
      return 'failed';
    }
  }

  async forceRefresh(): Promise<PwaUpdateActionResult> {
    this.options.onStatus?.('Checking...');

    try {
      if (this.registration) {
        await this.registration.update();
      }

      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      this.options.onStatus?.('Reloading...');
      this.reloadPage();
      return 'reloaded';
    } catch {
      this.options.onStatus?.('Update check failed. Try again.');
      return 'failed';
    }
  }

  applyDeferredReloadIfIdle(): PwaUpdateActionResult {
    if (!this.pendingReload) {
      return 'no-change';
    }

    if (this.options.isPlaybackActive?.()) {
      return 'deferred';
    }

    this.pendingReload = false;
    this.options.onStatus?.('Applying update...');
    this.options.onUpdateApplied?.();
    this.reloadPage();
    return 'reloaded';
  }

  hasPendingReload(): boolean {
    return this.pendingReload;
  }

  dispose(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.removeEventListener('controllerchange', this.handleControllerChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private readonly handleControllerChange = (): void => {
    this.applyReloadPolicy();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    void this.checkForUpdates({ silent: true });
  };

  private applyReloadPolicy(): PwaUpdateActionResult {
    if (this.options.isPlaybackActive?.()) {
      this.pendingReload = true;
      this.options.onStatus?.('Update ready. Pause playback to apply.');
      this.options.onUpdateReady?.();
      return 'deferred';
    }

    this.pendingReload = false;
    this.options.onStatus?.('Applying update...');
    this.options.onUpdateApplied?.();
    this.reloadPage();
    return 'reloaded';
  }

  private reloadPage(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    if (this.options.reload) {
      this.options.reload();
      return;
    }
    window.location.reload();
  }
}
