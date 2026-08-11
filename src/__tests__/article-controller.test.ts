import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArticleController } from '../lib/article-controller.js';
import { extractArticle, createArticleFromMarkdownFile, createArticleFromPdf, createArticleFromTextFile, createArticleFromEpub } from '../lib/extractor.js';
import { translateParagraphs } from '../lib/translator.js';

vi.mock('../lib/extractor.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/extractor.js')>('../lib/extractor.js');
  return {
    ...actual,
    extractArticle: vi.fn(),
    createArticleFromMarkdownFile: vi.fn(),
    createArticleFromPdf: vi.fn(),
    createArticleFromTextFile: vi.fn(),
    createArticleFromEpub: vi.fn(),
  };
});

vi.mock('../lib/translator.js', () => ({
  translateParagraphs: vi.fn().mockResolvedValue([]),
}));

function makeRefs() {
  const section = () => {
    const el = document.createElement('section');
    el.className = 'hidden';
    return el;
  };
  const div = () => document.createElement('div');

  return {
    urlInput: document.createElement('textarea'),
    goBtn: document.createElement('button'),
    inputSection: section(),
    loadingSection: section(),
    loadingMessage: div(),
    errorSection: section(),
    errorMessage: div(),
    errorRetry: document.createElement('button'),
    articleSection: section(),
    articleTitle: div(),
    articleInfo: div(),
    translateBtn: document.createElement('button'),
    copyMdBtn: document.createElement('button'),
    articleText: div(),
    playerControls: section(),
    playPauseBtn: document.createElement('button'),
    playIcon: div(),
    pauseIcon: div(),
    skipForwardBtn: document.createElement('button'),
    skipBackBtn: document.createElement('button'),
    skipSentenceForwardBtn: document.createElement('button'),
    skipSentenceBackBtn: document.createElement('button'),
    progressFill: div(),
    progressText: div(),
    progressBar: div(),
    settingsToggle: document.createElement('button'),
    settingsPanel: div(),
    settingsOverlay: div(),
    settingsSpeed: document.createElement('input'),
    speedValue: div(),
    settingsVoice: document.createElement('select'),
    settingsWakelock: document.createElement('input'),
    settingsDeviceVoice: document.createElement('input'),
    checkUpdateBtn: document.createElement('button'),
    updateStatus: div(),
    voiceGenderGroup: div(),
    voiceGenderBtns: document.querySelectorAll<HTMLButtonElement>('.missing-voice-gender'),
    fileInput: document.createElement('input'),
    fileBtn: document.createElement('button'),
    installBanner: div(),
    installBtn: document.createElement('button'),
    installDismiss: document.createElement('button'),
    speedBtns: document.querySelectorAll<HTMLButtonElement>('.missing-speed'),
    themeBtns: document.querySelectorAll<HTMLButtonElement>('.missing-theme'),
    settingsLangBtns: document.querySelectorAll<HTMLButtonElement>('.missing-lang'),
    menuToggle: document.createElement('button'),
    queueDrawer: div(),
    queueOverlay: div(),
    queueDrawerHeader: div(),
    queueBadge: div(),
    queueList: div(),
    queueEmpty: div(),
    queueCount: div(),
    queueClearBtn: document.createElement('button'),
    nextArticleRow: div(),
    nextArticleTitle: div(),
    autoAdvanceToast: div(),
    advanceText: div(),
    advanceSkipBtn: document.createElement('button'),
    advanceCancelBtn: document.createElement('button'),
    chaptersBtn: document.createElement('button'),
    chaptersSheet: div(),
    chaptersOverlay: div(),
    chaptersSheetHandle: div(),
    chaptersList: div(),
    appVersion: div(),
  } as any;
}

describe('ArticleController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a shared-url article via handleInitialSharedUrl', async () => {
    const sharedArticle = {
      title: 'Shared Article',
      content: '<p>shared</p>',
      textContent: 'shared',
      markdown: 'shared',
      paragraphs: ['shared paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/shared',
    } as any;

    vi.mocked(extractArticle).mockResolvedValueOnce(sharedArticle);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    // Simulate a shared URL in the query string.
    const historyReplace = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '?url=https://example.com/shared' },
      history: { replaceState: historyReplace },
    });

    await controller.handleInitialSharedUrl();

    expect(historyReplace).toHaveBeenCalled();

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/shared',
      'https://proxy.example.workers.dev',
      expect.anything(),
    );
    expect(controller.getCurrentArticle()).toEqual(sharedArticle);
  });

  it('passes extractArticle an options object from the browser load path and handles errors', async () => {
    const errorMsg = 'boom';
    vi.mocked(extractArticle).mockRejectedValueOnce(new Error(errorMsg));

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: {
        stop: vi.fn(),
      } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await (controller as any).loadArticle('https://example.com/article');

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/article',
      'https://proxy.example.workers.dev',
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
    expect(refs.errorMessage.textContent).toBe(errorMsg);
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('ignores stale URL load results when a newer load starts', async () => {
    let resolveFirst: ((v: any) => void) | null = null;
    vi.mocked(extractArticle)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }) as any)
      .mockResolvedValueOnce({
        title: 'Second',
        content: '<p>second</p>',
        textContent: 'second',
        markdown: 'second',
        paragraphs: ['second paragraph is long enough for rendering'],
        lang: 'en',
        htmlLang: 'en',
        siteName: 'Site',
        excerpt: '',
        wordCount: 10,
        estimatedMinutes: 1,
        resolvedUrl: 'https://example.com/second',
      } as any);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const first = (controller as any).loadArticle('https://example.com/first');
    const second = (controller as any).loadArticle('https://example.com/second');
    await second;
    resolveFirst?.({
      title: 'First',
      content: '<p>first</p>',
      textContent: 'first',
      markdown: 'first',
      paragraphs: ['first paragraph is long enough for rendering'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/first',
    });
    await first;

    expect(refs.articleTitle.textContent).toBe('Second');
  });

  it('loads an article from storage via loadArticleFromStored', async () => {
    const article = {
      title: 'Stored Article',
      content: '<p>Content</p>',
      textContent: 'Content',
      markdown: 'Content',
      paragraphs: ['Paragraph 1'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/stored',
    } as any;

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: {
        stop: vi.fn(),
        loadArticle: vi.fn(),
        setLang: vi.fn(),
      } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromStored(article);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Stored Article');
  });

  it('shows error view when offline while loading from stored article', async () => {
    const article = {
      title: 'Offline Stored',
      content: '<p>Content</p>',
      textContent: 'Content',
      markdown: 'Content',
      paragraphs: ['Paragraph 1'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/offline',
    } as any;

    const refs = makeRefs();
    vi.stubGlobal('navigator', { onLine: false });
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromStored(article);

    expect(refs.errorMessage.textContent).toBe('You appear to be offline. Showing saved article.');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
    expect(controller.getCurrentArticle()).not.toEqual(article);
  });

  it('triggers loadArticle when goBtn is clicked', async () => {
    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    refs.urlInput.value = 'https://example.com/article';
    refs.goBtn.click();

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/article',
      'https://proxy.example.workers.dev',
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
    expect(ttsMock.stop).toHaveBeenCalled();
  });

  it('handles invalid pasted text in handleUrlSubmit', async () => {
    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    refs.urlInput.value = 'a'; // too short
    refs.goBtn.click();

    expect(refs.errorMessage.textContent).toBe('Pasted text is too short to read as an article.');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('silently returns from handleUrlSubmit when urlInput is empty or whitespace-only', () => {
    const refs = makeRefs();
    const ttsMock = { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    refs.urlInput.value = '   ';
    refs.goBtn.click();

    // The controller early-returns on !raw — no error shown, TTS not touched.
    expect(refs.errorMessage.textContent).toBe('');
    expect(ttsMock.stop).not.toHaveBeenCalled();
    expect(extractArticle).not.toHaveBeenCalled();
    expect(refs.errorSection.classList.contains('hidden')).toBe(true);
    expect(refs.articleSection.classList.contains('hidden')).toBe(true);
  });

  it('treats non-URL pasted text as a plain-text article via createArticleFromText', async () => {
    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    // Two-line input — first line is the title (≤150 chars), second is body.
    const urlInputValue = 'Plain Pasted Title\nThis is plain pasted text, not a URL at all.';
    refs.urlInput.value = urlInputValue;
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    refs.goBtn.click();

    // Wait for createArticleFromText to run (synchronous; a microtask tick is enough).
    await Promise.resolve();

    expect(extractArticle).not.toHaveBeenCalled();
    expect(refs.articleTitle.textContent).toBe('Plain Pasted Title');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('updates language and TTS when setLangOverride is called', async () => {
    const article = {
      title: 'Test',
      content: '<p>test</p>',
      textContent: 'test',
      markdown: 'test',
      paragraphs: ['test paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/test',
    } as any;

    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    // Set article first
    await controller.loadArticleFromStored(article);

    // Test override to 'ro'
    controller.setLangOverride('ro');
    expect(ttsMock.setLang).toHaveBeenCalledWith('ro');
    expect(refs.articleInfo.textContent).toContain('RO');
  });

  it('handles successful markdown file upload', async () => {
    const article = {
      title: 'Markdown Article',
      content: '<p>Markdown content</p>',
      textContent: 'Markdown content',
      markdown: 'Markdown content',
      paragraphs: ['Markdown content'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/markdown',
    } as any;

    vi.mocked(createArticleFromMarkdownFile).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['# Title\nContent'], 'test.md', { type: 'text/markdown' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Markdown Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('handles successful pdf file upload', async () => {
    const article = {
      title: 'PDF Article',
      content: '<p>PDF content</p>',
      textContent: 'PDF content',
      markdown: 'PDF content',
      paragraphs: ['PDF paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/pdf',
    } as any;

    vi.mocked(createArticleFromPdf).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['PDF content'], 'test.pdf', { type: 'application/pdf' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('PDF Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('handles successful epub file upload', async () => {
    const article = {
      title: 'EPUB Article',
      content: '<p>EPUB content</p>',
      textContent: 'EPUB content',
      markdown: 'EPUB content',
      paragraphs: ['EPUB paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/epub',
    } as any;

    vi.mocked(createArticleFromEpub).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['EPUB content'], 'test.epub', { type: 'application/epub+zip' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('EPUB Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('passes DOMParser and progress callback to createArticleFromEpub', async () => {
    const article = {
      title: 'EPUB Article',
      content: '<p>EPUB content</p>',
      textContent: 'EPUB content',
      markdown: 'EPUB content',
      paragraphs: ['EPUB paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/epub',
    } as any;

    vi.mocked(createArticleFromEpub).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['EPUB content'], 'test.epub', { type: 'application/epub+zip' });
    await (controller as any).handleFileUpload(file);

    expect(createArticleFromEpub).toHaveBeenCalledWith(
      file,
      globalThis.DOMParser,
      expect.any(Function), // progress callback
    );

    const progressCallback = vi.mocked(createArticleFromEpub).mock.calls[0][2];
    refs.loadingMessage.textContent = '';
    progressCallback('Parsing EPUB...');
    expect(refs.loadingMessage.textContent).toBe('Parsing EPUB...');
  });

  it('ignores stale file upload results when a newer upload starts', async () => {
    const article1 = {
      title: 'First File',
      content: '<p>Content 1</p>',
      textContent: 'Content 1',
      markdown: 'Content 1',
      paragraphs: ['Content 1 paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site 1',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/1',
    } as any;

    const article2 = {
      title: 'Second File',
      content: '<p>Content 2</p>',
      textContent: 'Content 2',
      markdown: 'Content 2',
      paragraphs: ['Content 2 paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site 2',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/2',
    } as any;

    vi.mocked(createArticleFromPdf).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(article1), 50);
    }) as any);
    vi.mocked(createArticleFromPdf).mockResolvedValueOnce(article2);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file1 = new File(['PDF 1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['PDF 2'], 'test2.pdf', { type: 'application/pdf' });

    // Start first upload
    const p1 = (controller as any).handleFileUpload(file1);
    // Immediately start second upload
    const p2 = (controller as any).handleFileUpload(file2);

    await Promise.all([p1, p2]);

    expect(controller.getCurrentArticle()).toEqual(article2);
    expect(refs.articleTitle.textContent).toBe('Second File');
  });

  it('handles successful txt file upload via createArticleFromTextFile', async () => {
    const article = {
      title: 'Text Article',
      content: '<p>Plain text content</p>',
      textContent: 'Plain text content',
      markdown: 'Plain text content',
      paragraphs: ['Plain text paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/text',
    } as any;

    vi.mocked(createArticleFromTextFile).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['Plain text content'], 'readme.txt', { type: 'text/plain' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Text Article');
    expect(createArticleFromTextFile).toHaveBeenCalledWith(file);
  });

  it('handles file errors (too large or unsupported)', async () => {
    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    const largeFile = new File([], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 60 * 1024 * 1024 });
    await (controller as any).handleFileUpload(largeFile);
    expect(refs.errorMessage.textContent).toContain('File too large');
    expect(refs.errorMessage.textContent).toContain('MiB');
    expect(refs.errorMessage.textContent).toContain('50 MB');

    const badFile = new File(['content'], 'test.exe', { type: 'application/x-msdownload' });
    await (controller as any).handleFileUpload(badFile);
    expect(refs.errorMessage.textContent).toContain('Unsupported file type');
  });

  it('shows offline error and skips extractArticle when navigator.onLine is false', async () => {
    const savedArticle = {
      title: 'Saved Offline',
      content: '<p>Saved</p>',
      textContent: 'Saved',
      markdown: 'Saved',
      paragraphs: ['Saved paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/saved',
    } as any;

    // Pre-store an article so restoreLastArticle has something to load.
    const { saveLastArticle } = await import('../lib/session-store.js');
    (saveLastArticle as any)(savedArticle);

    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: false });

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await (controller as any).loadArticle('https://example.com/article');

    expect(extractArticle).not.toHaveBeenCalled();
    expect(refs.errorMessage.textContent).toContain('offline');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('handles PDF processing failure during file upload', async () => {
    vi.mocked(createArticleFromPdf).mockRejectedValueOnce(new Error('PDF parse failed'));

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['PDF content'], 'test.pdf', { type: 'application/pdf' });
    await (controller as any).handleFileUpload(file);

    expect(refs.errorMessage.textContent).toBe('PDF parse failed');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('shows offline error instead of calling translateParagraphs when offline', async () => {
    const article = {
      title: 'Test',
      content: '<p>test</p>',
      textContent: 'test',
      markdown: 'test',
      paragraphs: ['test paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/test',
    } as any;

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() },
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    // Load an article first to have something to translate.
    await controller.loadArticleFromStored(article);

    // Force offline mode.
    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: false });

    await (controller as any).translateCurrentArticle();

    expect(refs.errorMessage.textContent).toContain('offline');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('replaces article content with translated paragraphs on successful translation', async () => {
    const originalArticle = {
      title: 'Translatable',
      content: '<p>original</p>',
      textContent: 'original',
      markdown: 'original',
      paragraphs: ['original paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/translatable',
    } as any;

    const translatedParagraphs = ['translated paragraph'];
    vi.mocked(translateParagraphs).mockResolvedValueOnce(translatedParagraphs);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() },
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromStored(originalArticle);
    // Trigger translation.
    (controller as any).currentTtsParagraphs = ['original paragraph'];
    await (controller as any).translateCurrentArticle();

    expect(controller.getCurrentArticle()?.lang).toBe('en');
    expect(controller.getCurrentArticle()?.paragraphs).toEqual(translatedParagraphs);
    expect(controller.getCurrentArticle()?.textContent).toBe('translated paragraph');
  });

  it('does not silently erase article when translateParagraphs returns empty', async () => {
    const originalArticle = {
      title: 'Empty Translation',
      content: '<p>original</p>',
      textContent: 'original',
      markdown: 'original',
      paragraphs: ['original paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/empty-trans',
    } as any;

    vi.mocked(translateParagraphs).mockResolvedValueOnce([]);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() },
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromStored(originalArticle);
    (controller as any).currentTtsParagraphs = ['original paragraph'];
    await (controller as any).translateCurrentArticle();

    // The article title should still be visible — not silently blanked.
    expect(refs.articleTitle.textContent).toBe('Empty Translation');
  });

  it('rejects files with unsupported extensions and shows an error', async () => {
    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['some content'], 'test.xyz', { type: 'application/octet-stream' });
    await (controller as any).handleFileUpload(file);

    expect(refs.errorMessage.textContent).toContain('Unsupported file type');
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
    // Article section must remain hidden — no article was displayed.
    expect(refs.articleSection.classList.contains('hidden')).toBe(true);
  });

  it('suppresses stale error when an older file upload fails after a newer one succeeds', async () => {
    // First (older) upload rejects with delay. Second (newer) resolves immediately,
    // so loadToken changes and the first's stale result is ignored.
    let resolveFirst: ((v: any) => void) | null = null;
    vi.mocked(createArticleFromPdf).mockImplementationOnce(
      () => new Promise((resolve) => { (resolveFirst as any) = resolve; }) as any,
    );
    vi.mocked(createArticleFromPdf).mockResolvedValueOnce({
      title: 'Newer',
      content: '<p>newer</p>',
      textContent: 'newer',
      markdown: 'newer',
      paragraphs: ['newer paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/newer',
    } as any);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file1 = new File(['old'], 'a.pdf', { type: 'application/pdf' });
    const file2 = new File(['new'], 'b.pdf', { type: 'application/pdf' });

    // Start first upload (won't resolve until we do).
    const p1 = (controller as any).handleFileUpload(file1);
    // Immediately start second — it resolves synchronously.
    const p2 = (controller as any).handleFileUpload(file2);
    await p2;
    // Now let the stale result from file1 tick through; it must be ignored.
    ((resolveFirst as unknown) as (() => void))();
    await Promise.resolve();

    expect(controller.getCurrentArticle()?.title).toBe('Newer');
    // The stale error/result from file1 must NOT have been applied to the view.
    expect(refs.errorMessage.textContent).not.toContain('Old');
    expect(refs.articleTitle.textContent).toBe('Newer');
  });

  it('skips extractArticle when offline despite a shared URL in the query string', async () => {
    const refs = makeRefs();

    // Simulate a shared URL in the query string.
    vi.stubGlobal('window', {
      location: { search: '?url=https://example.com/shared' },
      history: { replaceState: vi.fn() },
    });

    // Force offline mode — controller checks navigator.onLine.
    vi.stubGlobal('navigator', { onLine: false });

    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.handleInitialSharedUrl();

    expect(extractArticle).not.toHaveBeenCalled();
  });

  it('suppresses stale error when an older file upload fails after a newer one succeeds on the failure path', async () => {
    // First (older) upload rejects with delay. Second (newer) resolves immediately,
    // so loadToken changes and the first's stale error is suppressed.
    let rejectFirst: ((err: Error) => void) | null = null;
    vi.mocked(createArticleFromPdf).mockImplementationOnce(
      () => new Promise((_, reject) => { (rejectFirst as any) = reject; }) as any,
    );
    vi.mocked(createArticleFromPdf).mockResolvedValueOnce({
      title: 'Newer',
      content: '<p>newer</p>',
      textContent: 'newer',
      markdown: 'newer',
      paragraphs: ['newer paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/newer',
    } as any);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file1 = new File(['old'], 'a.pdf', { type: 'application/pdf' });
    const file2 = new File(['new'], 'b.pdf', { type: 'application/pdf' });

    // Start first upload (won't reject until we do).
    void (controller as any).handleFileUpload(file1);
    // Immediately start second — it resolves synchronously.
    await (controller as any).handleFileUpload(file2);
    // Now trigger the stale rejection from file1; it must be ignored.
    ((rejectFirst as unknown) as (() => void))(new Error('stale failure'));
    await Promise.resolve();

    expect(controller.getCurrentArticle()?.title).toBe('Newer');
    // The stale error must NOT have been displayed on the error message element.
    expect(refs.errorMessage.textContent).not.toContain('stale failure');
  });

  it('exposes loadArticleFromUrl as a public queue entry point', async () => {
    const article = {
      title: 'Queue Article',
      content: '<p>queued</p>',
      textContent: 'queued',
      markdown: 'queued',
      paragraphs: ['queued paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/queue',
    } as any;

    vi.mocked(extractArticle).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromUrl('https://example.com/queue');

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/queue',
      'https://proxy.example.workers.dev',
      expect.anything(),
    );
    expect(controller.getCurrentArticle()).toEqual(article);
  });
});
