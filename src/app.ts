/**
 * Listen to Articles — thin app bootstrap/orchestrator.
 *
 * All business logic lives in dedicated modules. This file wires
 * instances together, binds UI events, and manages settings sync.
 */

import { TTSEngine } from './lib/tts-engine.js';
import { getAppDomRefs } from './lib/dom-refs.js';
import { loadSettings, saveSettings, type Theme } from './lib/settings-store.js';
import { PwaUpdateManager } from './lib/pwa-update-manager.js';
import { ArticleController } from './lib/article-controller.js';
import { APP_RELEASE, shortRelease } from './lib/release.js';
import { QueueController } from './lib/queue-controller.js';
import { QueueRenderer } from './lib/queue-renderer.js';
import type { QueueItem } from './lib/queue-store.js';
import type { Language } from './lib/language-config.js';
import { ListFilter } from './lib/list-filter.js';
import { detectVoiceGender, getAllowedVoices } from './lib/voice-helpers.js';
import { openDrawer, closeDrawer, showSnackbar, hideSnackbar, updateSegmentButtons } from './lib/ui-helpers.js';
import { buildChaptersList } from './lib/chapter-renderer.js';

const CONFIG = {
  PROXY_BASE: import.meta.env.VITE_PROXY_BASE || 'https://pixel-article-reader.fabian20ro.workers.dev',
  DEFAULT_RATE: 1.0,
  DEFAULT_LANG: 'auto' as 'auto' | Language,
};

async function main(): Promise<void> {
  const refs = getAppDomRefs();

  const settings = loadSettings({
    defaultRate: CONFIG.DEFAULT_RATE,
    defaultLang: CONFIG.DEFAULT_LANG,
  });

  let updateManager: PwaUpdateManager | null = null;
  let queueController: QueueController | null = null;

  // ── Player UI helpers ────────────────────────────────────────

  function updatePlayButton(isPlaying: boolean, isPaused: boolean): void {
    if (isPlaying && !isPaused) {
      refs.playIcon.classList.add('hidden');
      refs.pauseIcon.classList.remove('hidden');
      refs.playPauseBtn.setAttribute('aria-label', 'Pause');
    } else {
      refs.playIcon.classList.remove('hidden');
      refs.pauseIcon.classList.add('hidden');
      refs.playPauseBtn.setAttribute('aria-label', 'Play');
    }
  }

  function updateProgress(current: number, total: number): void {
    const pct = total > 0 ? (current / total) * 100 : 0;
    refs.progressFill.style.width = pct + '%';
    refs.progressText.textContent = `${Math.min(current + 1, total)} / ${total}`;
  }

  function highlightParagraph(index: number): void {
    const paragraphs = refs.articleText.querySelectorAll('.paragraph');
    paragraphs.forEach((element) => {
      const elIndex = parseInt((element as HTMLElement).dataset.index ?? '-1', 10);
      element.classList.toggle('active', elIndex === index);
      element.classList.toggle('past', elIndex < index);
    });

    const target = refs.articleText.querySelector(`.paragraph[data-index="${index}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function showError(msg: string): void {
    refs.errorMessage.textContent = msg;
    refs.errorSection.classList.remove('hidden');
  }

  // ── TTS Engine ──────────────────────────────────────────────

  const tts = new TTSEngine({
    proxyBase: CONFIG.PROXY_BASE,
    callbacks: {
      onStateChange(state) {
        updatePlayButton(state.isPlaying, state.isPaused);
        if (updateManager && (!state.isPlaying || state.isPaused)) {
          updateManager.applyDeferredReloadIfIdle();
        }
      },
      onProgress(current, total) {
        updateProgress(current, total);
      },
      onParagraphChange(index) {
        highlightParagraph(index);
      },
      onEnd() {
        updatePlayButton(false, false);
        highlightParagraph(-1);
        if (queueController) {
          queueController.handleArticleEnd();
        }
        updateManager?.applyDeferredReloadIfIdle();
      },
      onError: showError,
    },
  });

  await tts.init();
  tts.setRate(settings.rate);
  if (settings.voiceName) tts.setVoice(settings.voiceName);
  tts.setWakeLock(settings.wakeLock);

  // ── Chapters ────────────────────────────────────────────────

  const chaptersFilter = new ListFilter({
    container: refs.chaptersSheetHandle,
    list: refs.chaptersList,
    ariaLabel: 'Filter chapters',
  });

  const openChaptersSheet = () => openDrawer(refs.chaptersSheet, refs.chaptersOverlay);
  const closeChaptersSheet = () => closeDrawer(refs.chaptersSheet, refs.chaptersOverlay);

  refs.chaptersBtn.addEventListener('click', () => {
    const isOpen = refs.chaptersSheet.classList.contains('open');
    if (isOpen) closeChaptersSheet(); else openChaptersSheet();
  });

  refs.chaptersOverlay.addEventListener('click', closeChaptersSheet);

  function rebuildChapters(): void {
    buildChaptersList({
      articleText: refs.articleText,
      chaptersList: refs.chaptersList,
      chaptersBtn: refs.chaptersBtn,
      chaptersFilter,
      tts,
      onChapterClick: closeChaptersSheet,
    });
  }

  // ── Article Controller ──────────────────────────────────────

  const articleController = new ArticleController({
    refs,
    tts,
    proxyBase: CONFIG.PROXY_BASE,
    initialLangOverride: settings.lang,
    onArticleRendered(totalParagraphs) {
      updateProgress(0, totalParagraphs);
      highlightParagraph(0);

      // Auto-add to queue when article loads (skip if queue-driven load)
      const article = articleController.getCurrentArticle();
      if (article && queueController && !queueController.isLoadingItem()) {
        const items = queueController.getItems();
        const alreadyQueued = article.resolvedUrl &&
          items.some((i) => i.url === article.resolvedUrl);
        if (!alreadyQueued) {
          const item = queueController.addArticle(article);
          if (article.resolvedUrl) {
            queueController.syncCurrentByUrl(article.resolvedUrl);
          } else {
            queueController.syncCurrentById(item.id);
          }
        } else {
          queueController.syncCurrentByUrl(article.resolvedUrl);
        }
      }

      rebuildChapters();
    },
  });
  articleController.init();

  // ── Queue Controller ────────────────────────────────────────

  queueController = new QueueController({
    articleController,
    tts,
    callbacks: {
      onQueueChange(items, currentIndex) {
        queueRenderer.render(items, currentIndex);
        queueFilter.applyFilter();
      },
      onAutoAdvanceCountdown(nextTitle) {
        refs.advanceText.textContent = `Up next: ${nextTitle}`;
        showSnackbar(refs.autoAdvanceToast);
      },
      onAutoAdvanceCancelled() {
        hideSnackbar(refs.autoAdvanceToast);
      },
      onError: showError,
    },
  });

  // ── Queue Drawer ────────────────────────────────────────────

  const openQueueDrawer = () => openDrawer(refs.queueDrawer, refs.queueOverlay);
  const closeQueueDrawer = () => closeDrawer(refs.queueDrawer, refs.queueOverlay);

  refs.menuToggle.addEventListener('click', () => {
    const isOpen = refs.queueDrawer.classList.contains('open');
    if (isOpen) closeQueueDrawer(); else openQueueDrawer();
  });

  refs.queueOverlay.addEventListener('click', closeQueueDrawer);

  refs.queueClearBtn.addEventListener('click', () => {
    queueController!.clearAll();
    closeQueueDrawer();
  });

  refs.advanceSkipBtn.addEventListener('click', () => {
    hideSnackbar(refs.autoAdvanceToast);
    queueController!.skipToNext();
  });

  refs.advanceCancelBtn.addEventListener('click', () => {
    hideSnackbar(refs.autoAdvanceToast);
    queueController!.cancelAutoAdvance();
  });

  refs.nextArticleRow.addEventListener('click', () => {
    queueController!.skipToNext();
  });

  const queueRenderer = new QueueRenderer(
    {
      queueBadge: refs.queueBadge,
      queueCount: refs.queueCount,
      queueEmpty: refs.queueEmpty,
      queueList: refs.queueList,
      nextArticleRow: refs.nextArticleRow,
      nextArticleTitle: refs.nextArticleTitle,
    },
    {
      onItemClick(itemId) {
        void queueController!.playItem(itemId).then(() => tts.play()).catch((err) => {
          showError(err instanceof Error ? err.message : 'Failed to load queue item.');
        });
        closeQueueDrawer();
      },
      onItemShare(item) {
        void queueController!.shareItem(item);
      },
      onItemRemove(itemId) {
        queueController!.removeItem(itemId);
      },
      onReorder(reorderedIds) {
        const currentItems = queueController!.getItems();
        const newOrder = reorderedIds
          .map((id) => currentItems.find((i) => i.id === id))
          .filter(Boolean) as QueueItem[];
        if (newOrder.length === currentItems.length) {
          queueController!.reorder(newOrder);
        }
      },
    },
  );

  const queueFilter = new ListFilter({
    container: refs.queueDrawerHeader,
    list: refs.queueList,
    insertBefore: refs.queueClearBtn,
    ariaLabel: 'Filter queue',
    getText: (el) => {
      const title = el.querySelector('.queue-item-title')?.textContent ?? '';
      const meta = el.querySelector('.queue-item-meta')?.textContent ?? '';
      return title + ' ' + meta;
    },
  });

  queueRenderer.render(queueController.getItems(), queueController.getCurrentIndex());
  queueFilter.applyFilter();

  // ── Settings Drawer ─────────────────────────────────────────

  const openSettingsDrawer = () => openDrawer(refs.settingsPanel, refs.settingsOverlay);
  const closeSettingsDrawer = () => closeDrawer(refs.settingsPanel, refs.settingsOverlay);

  refs.settingsToggle.addEventListener('click', () => {
    const isOpen = refs.settingsPanel.classList.contains('open');
    if (isOpen) closeSettingsDrawer(); else openSettingsDrawer();
  });

  refs.settingsOverlay.addEventListener('click', closeSettingsDrawer);

  document.addEventListener('keydown', (e) => {
    // Player keyboard shortcuts — only when article is loaded and not typing
    if (articleController.getCurrentArticle() && e.target !== refs.urlInput) {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (tts.state.isPaused) tts.resume();
          else if (tts.state.isPlaying) tts.pause();
          else tts.play();
          return;
        case 'ArrowRight':
          e.preventDefault();
          tts.skipForward();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          tts.skipBackward();
          return;
      }
    }
    if (e.key === 'Escape') {
      if (refs.queueDrawer.classList.contains('open')) closeQueueDrawer();
      if (refs.settingsPanel.classList.contains('open')) closeSettingsDrawer();
      if (refs.chaptersSheet.classList.contains('open')) closeChaptersSheet();
    }
  });

  // ── Settings Controls ───────────────────────────────────────

  function applyVoiceGender(gender: 'auto' | 'male' | 'female'): void {
    if (gender === 'auto') {
      settings.voiceName = '';
      refs.settingsVoice.value = '';
      return;
    }
    const match = getAllowedVoices(tts).find((v) => detectVoiceGender(v.name) === gender);
    if (match) {
      tts.setVoice(match.name);
      settings.voiceName = match.name;
      refs.settingsVoice.value = match.name;
    }
  }

  function populateVoices(): void {
    const voices = getAllowedVoices(tts);
    voices.sort((a, b) => {
      const langCmp = a.lang.localeCompare(b.lang);
      if (langCmp !== 0) return langCmp;
      return a.name.localeCompare(b.name);
    });

    refs.settingsVoice.innerHTML = '<option value="">Auto</option>';
    voices.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang})`;
      if (voice.name === settings.voiceName) opt.selected = true;
      refs.settingsVoice.appendChild(opt);
    });

    const hasDetectableGenders = voices.some((v) => detectVoiceGender(v.name) !== null);
    if (hasDetectableGenders) {
      refs.voiceGenderGroup.classList.remove('hidden');
      updateSegmentButtons(refs.voiceGenderBtns, settings.voiceGender || 'auto');
      applyVoiceGender(settings.voiceGender || 'auto');
    } else {
      refs.voiceGenderGroup.classList.add('hidden');
    }
  }

  function updateSpeedButtons(rate: number): void {
    refs.speedBtns.forEach((button) => {
      button.classList.toggle('active', parseFloat(button.dataset.rate ?? '0') === rate);
    });
  }

  // Speed slider
  refs.settingsSpeed.value = String(settings.rate);
  refs.speedValue.textContent = settings.rate + 'x';
  refs.settingsSpeed.addEventListener('input', () => {
    const rate = parseFloat(refs.settingsSpeed.value);
    if (Number.isNaN(rate)) return;
    refs.settingsSpeed.value = String(rate);
    refs.speedValue.textContent = rate + 'x';
    tts.setRate(rate);
    settings.rate = rate;
    saveSettings(settings);
    updateSpeedButtons(rate);
  });

  // Voice selector
  populateVoices();
  refs.settingsVoice.addEventListener('change', () => {
    const name = refs.settingsVoice.value;
    if (name) tts.setVoice(name);
    settings.voiceName = name;
    saveSettings(settings);
  });

  // Voice gender
  refs.voiceGenderBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const gender = btn.dataset.value as 'auto' | 'male' | 'female';
      settings.voiceGender = gender;
      saveSettings(settings);
      updateSegmentButtons(refs.voiceGenderBtns, gender);
      applyVoiceGender(gender);
    });
  });

  // Theme
  document.documentElement.setAttribute('data-theme', settings.theme);
  updateSegmentButtons(refs.themeBtns, settings.theme);

  refs.themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.value as Theme;
      document.documentElement.setAttribute('data-theme', theme);
      settings.theme = theme;
      saveSettings(settings);
      updateSegmentButtons(refs.themeBtns, theme);
    });
  });

  // Language
  updateSegmentButtons(refs.settingsLangBtns, settings.lang);

  refs.settingsLangBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.value as 'auto' | Language;
      settings.lang = lang;
      saveSettings(settings);
      articleController.setLangOverride(lang);
      updateSegmentButtons(refs.settingsLangBtns, lang);
    });
  });

  // Wake lock
  refs.settingsWakelock.checked = settings.wakeLock;
  refs.settingsWakelock.addEventListener('change', () => {
    settings.wakeLock = refs.settingsWakelock.checked;
    tts.setWakeLock(settings.wakeLock);
    saveSettings(settings);
  });

  // Device voice only
  tts.setDeviceVoiceOnly(settings.deviceVoiceOnly);
  refs.settingsDeviceVoice.checked = settings.deviceVoiceOnly;
  refs.settingsDeviceVoice.addEventListener('change', () => {
    settings.deviceVoiceOnly = refs.settingsDeviceVoice.checked;
    tts.setDeviceVoiceOnly(settings.deviceVoiceOnly);
    saveSettings(settings);
  });

  // ── Player Controls ─────────────────────────────────────────

  refs.playPauseBtn.addEventListener('click', () => {
    if (tts.state.isPaused) {
      tts.resume();
    } else if (tts.state.isPlaying) {
      tts.pause();
    } else {
      tts.play();
    }
  });

  refs.skipForwardBtn.addEventListener('click', () => tts.skipForward());
  refs.skipBackBtn.addEventListener('click', () => tts.skipBackward());
  refs.skipSentenceForwardBtn.addEventListener('click', () => tts.skipSentenceForward());
  refs.skipSentenceBackBtn.addEventListener('click', () => tts.skipSentenceBackward());

  refs.speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate ?? '1');
      tts.setRate(rate);
      settings.rate = rate;
      saveSettings(settings);
      refs.settingsSpeed.value = String(rate);
      refs.speedValue.textContent = rate + 'x';
      updateSpeedButtons(rate);
    });
  });

  refs.progressBar.addEventListener('click', (e) => {
    const total = tts.state.totalParagraphs;
    if (total === 0) return;
    queueController!.cancelAutoAdvance();
    const rect = refs.progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(total - 1, Math.floor(ratio * total)));
    tts.jumpToParagraph(idx);
  });

  // ── PWA Update Manager ──────────────────────────────────────

  updateManager = new PwaUpdateManager({
    onStatus(status) { refs.updateStatus.textContent = status; },
    onUpdateReady() { refs.updateStatus.textContent = 'Update ready. Pause playback to apply.'; },
    isPlaybackActive() { return tts.state.isPlaying && !tts.state.isPaused; },
  });

  refs.appVersion.textContent = shortRelease(APP_RELEASE);
  await updateManager.init('sw.js');

  // ── Install Prompt ──────────────────────────────────────────

  let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    const dismissed = localStorage.getItem('articlevoice-install-dismissed');
    if (!dismissed) refs.installBanner.classList.remove('hidden');
  });

  refs.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    refs.installBanner.classList.add('hidden');
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
  });

  refs.installDismiss.addEventListener('click', () => {
    refs.installBanner.classList.add('hidden');
    localStorage.setItem('articlevoice-install-dismissed', '1');
  });

  refs.checkUpdateBtn.addEventListener('click', () => {
    void updateManager?.forceRefresh();
  });

  // ── Lifecycle ───────────────────────────────────────────────

  window.addEventListener('pagehide', () => {
    tts.dispose();
    updateManager?.dispose();
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
  });

  await articleController.handleInitialSharedUrl();
  updateSpeedButtons(settings.rate);
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

main().catch((err) => {
  console.error('Listen to Articles init failed:', err);
});
