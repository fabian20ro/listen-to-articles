import { getUrlFromParams, extractUrl, clearQueryParams } from './url-utils.js';
import {
  extractArticle,
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromPdf,
  createArticleFromMarkdownFile,
  createArticleFromEpub,
  type Article,
} from './extractor.js';
import { needsTranslation, getSourceLang } from './lang-detect.js';
import { DEFAULT_TRANSLATION_TARGET, type Language } from './language-config.js';
import { translateParagraphs } from './translator.js';
import { renderArticleBody } from './article-renderer.js';
import type { TTSEngine } from './tts-engine.js';
import type { AppDomRefs } from './dom-refs.js';
import { loadLastArticle, saveLastArticle } from './session-store.js';
import { clearQueue } from './queue-store.js';
import { clearArticleContent } from './article-content-store.js';

export interface ArticleControllerOptions {
  refs: AppDomRefs;
  tts: TTSEngine;
  proxyBase: string;
  initialLangOverride: 'auto' | Language;
  onArticleRendered?: (totalParagraphs: number) => void;
}

export class ArticleController {
  private currentArticle: Article | null = null;
  private currentArticleUrl = '';
  private currentTtsParagraphs: string[] = [];
  private langOverride: 'auto' | Language;
  private loadToken = 0;

  constructor(private readonly options: ArticleControllerOptions) {
    this.langOverride = options.initialLangOverride;
  }

  init(): void {
    const { refs } = this.options;

    refs.goBtn.addEventListener('click', () => this.handleUrlSubmit());
    refs.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        refs.urlInput.value = '';
        return;
      }
      if (e.key !== 'Enter') return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.handleUrlSubmit();
        return;
      }
      if (!refs.urlInput.value.includes('\n')) {
        e.preventDefault();
        this.handleUrlSubmit();
      }
    });

    refs.urlInput.addEventListener('input', () => {
      refs.urlInput.style.height = 'auto';
      refs.urlInput.style.height = refs.urlInput.scrollHeight + 'px';
    });

    refs.translateBtn.addEventListener('click', () => {
      void this.translateCurrentArticle();
    });

    refs.copyMdBtn.addEventListener('click', () => {
      void this.copyMarkdown();
    });

    refs.errorRetry.addEventListener('click', () => {
      this.showView('input');
      refs.urlInput.focus();
    });

    refs.fileBtn.addEventListener('click', () => {
      refs.fileInput.click();
    });

    refs.fileInput.addEventListener('change', () => {
      const file = refs.fileInput.files?.[0];
      if (file) {
        void this.handleFileUpload(file);
        refs.fileInput.value = '';
      }
    });

    this.syncLanguageControls();
  }

  async handleInitialSharedUrl(): Promise<void> {
    const sharedUrl = getUrlFromParams();
    if (!sharedUrl) {
      if (navigator.onLine === false) {
        this.restoreLastArticle();
      }
      return;
    }

    clearQueryParams();
    this.options.refs.urlInput.value = sharedUrl;
    await this.loadArticle(sharedUrl);
  }

  setLangOverride(lang: 'auto' | Language): void {
    this.langOverride = lang;
    this.syncLanguageControls();

    if (!this.currentArticle) return;

    const resolved = this.langOverride === 'auto' ? this.currentArticle.lang : this.langOverride;
    this.options.tts.setLang(resolved);
    this.updateArticleInfo(this.currentArticle, resolved);
  }

  getCurrentArticle(): Article | null {
    return this.currentArticle;
  }

  /** Public entry point for queue-driven article loading. */
  async loadArticleFromUrl(url: string): Promise<void> {
    await this.loadArticle(url);
  }

  /** Load and display an article from stored content (IndexedDB). Used by queue for local files. */
  async loadArticleFromStored(article: Article): Promise<void> {
    if (navigator.onLine === false) {
      this.options.refs.errorMessage.textContent = 'You appear to be offline. Showing saved article.';
      this.showView('error');
      return;
    }
    this.options.tts.stop();
    this.currentArticle = article;
    this.currentArticleUrl = '';
    this.displayArticle(article);
  }

  private handleUrlSubmit(): void {
    const raw = this.options.refs.urlInput.value.trim();
    if (!raw) return;

    const url = extractUrl(raw);
    if (url) {
      void this.loadArticle(url);
      return;
    }

    this.options.tts.stop();
    try {
      const article = createArticleFromText(raw);
      this.currentArticle = article;
      this.currentArticleUrl = '';
      this.displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not parse the pasted text.';
      this.showError(msg);
    }
  }

  private static readonly MAX_FILE_SIZE = 50_000_000; // 50 MB
  private static readonly SUPPORTED_EXTENSIONS = new Set(['pdf', 'txt', 'text', 'md', 'markdown', 'epub']);

  private async handleFileUpload(file: File): Promise<void> {
    const token = ++this.loadToken;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    if (file.size > ArticleController.MAX_FILE_SIZE) {
      const sizeMB = Math.round((file.size / 1_048_576) * 10) / 10;
      this.showError(`File too large (${sizeMB} MiB). Maximum is 47.7 MiB (50 MB).`);
      return;
    }

    if (!ArticleController.SUPPORTED_EXTENSIONS.has(ext)) {
      this.showError(`Unsupported file type: .${ext}. Supported: PDF, TXT, Markdown, EPUB.`);
      return;
    }

    this.showView('loading');
    this.options.refs.loadingMessage.textContent = 'Processing file...';
    this.options.tts.stop();

    try {
      let article: Article;

      if (ext === 'pdf') {
        this.options.refs.loadingMessage.textContent = 'Processing PDF...';
        article = await createArticleFromPdf(
          file,
          (msg: string) => { this.options.refs.loadingMessage.textContent = msg; },
        );
      } else if (ext === 'txt' || ext === 'text') {
        this.options.refs.loadingMessage.textContent = 'Processing text file...';
        article = await createArticleFromTextFile(file);
      } else if (ext === 'md' || ext === 'markdown') {
        this.options.refs.loadingMessage.textContent = 'Processing markdown...';
        article = await createArticleFromMarkdownFile(file);
      } else if (ext === 'epub') {
        this.options.refs.loadingMessage.textContent = 'Processing EPUB...';
        article = await createArticleFromEpub(
          file,
          globalThis.DOMParser,
          (msg) => { this.options.refs.loadingMessage.textContent = msg; },
        );
      } else {
        throw new Error(`Unsupported file type: .${ext}. Supported: PDF, TXT, Markdown, EPUB.`);
      }
      if (token !== this.loadToken) return;

      this.currentArticle = article;
      this.currentArticleUrl = '';
      this.displayArticle(article);
    } catch (err: unknown) {
      if (token !== this.loadToken) return;
      const msg = err instanceof Error ? err.message : 'Could not process the file.';
      this.showError(msg);
    }
  }

  private async loadArticle(url: string): Promise<void> {
    const token = ++this.loadToken;
    if (navigator.onLine === false) {
      this.showError('You appear to be offline. Open a saved local item from Queue or retry when connected.');
      this.restoreLastArticle();
      return;
    }
    this.showView('loading');
    this.options.refs.loadingMessage.textContent = 'Extracting article...';
    this.options.tts.stop();

    try {
      const article = await extractArticle(
        url,
        this.options.proxyBase,
        {
          onProgress: (msg: string) => { this.options.refs.loadingMessage.textContent = msg; },
        },
      );
      if (token !== this.loadToken) return;

      if (!article.title.trim() || article.paragraphs.length === 0) {
        this.showError('Could not extract readable content from the article.');
        return;
      }

      this.currentArticle = article;
      this.currentArticleUrl = article.resolvedUrl;
      this.displayArticle(article);
    } catch (err: unknown) {
      if (token !== this.loadToken) return;
      const msg = err instanceof Error ? err.message : 'Unknown error occurred.';
      this.showError(msg);
    }
  }

  private displayArticle(article: Article): void {
    const { refs } = this.options;
    refs.articleTitle.textContent = article.title;

    const resolvedLang = this.langOverride === 'auto' ? article.lang : this.langOverride;
    this.updateArticleInfo(article, resolvedLang);

    const showTranslate = needsTranslation(article.htmlLang, this.currentArticleUrl, article.lang);
    refs.translateBtn.classList.toggle('hidden', !showTranslate);
    refs.translateBtn.disabled = false;
    const targetLangName = DEFAULT_TRANSLATION_TARGET === 'en' ? 'English' : 'Romanian';
    refs.translateBtn.textContent = `Translate to ${targetLangName}`;

    refs.copyMdBtn.classList.toggle('hidden', !article.markdown);
    refs.copyMdBtn.disabled = false;
    refs.copyMdBtn.textContent = 'Copy as Markdown';

    this.currentTtsParagraphs = renderArticleBody(article, refs.articleText, this.options.tts);

    this.options.tts.loadArticle(this.currentTtsParagraphs, resolvedLang, article.title);
    saveLastArticle(article);
    this.syncLanguageControls();

    this.showView('article');
    refs.playerControls.classList.remove('hidden');
    this.options.onArticleRendered?.(this.currentTtsParagraphs.length);
  }

  private async copyMarkdown(): Promise<void> {
    const { refs } = this.options;
    if (!this.currentArticle?.markdown) return;

    try {
      await navigator.clipboard.writeText(this.currentArticle.markdown);
      refs.copyMdBtn.textContent = 'Copied!';
      setTimeout(() => {
        refs.copyMdBtn.textContent = 'Copy as Markdown';
      }, 2000);
    } catch {
      this.showError('Could not copy markdown to clipboard.');
    }
  }

  private async translateCurrentArticle(): Promise<void> {
    if (!this.currentArticle) return;

    if (navigator.onLine === false) {
      this.showError('You appear to be offline. Please reconnect and try again.');
      return;
    }

    const token = ++this.loadToken;

    const { refs } = this.options;
    const savedLabel = refs.translateBtn.textContent;

    refs.translateBtn.disabled = true;
    refs.translateBtn.textContent = 'Translating...';

    try {
      const sourceLang = getSourceLang(this.currentArticle.htmlLang, this.currentArticleUrl);
      const translated = await translateParagraphs(
        this.currentTtsParagraphs,
        sourceLang,
        DEFAULT_TRANSLATION_TARGET,
        this.options.proxyBase,
      );
      if (token !== this.loadToken) return;

      this.currentArticle = {
        ...this.currentArticle,
        paragraphs: translated,
        textContent: translated.join('\n\n'),
        markdown: translated.join('\n\n'),
        lang: DEFAULT_TRANSLATION_TARGET,
        htmlLang: DEFAULT_TRANSLATION_TARGET,
      };

      this.displayArticle(this.currentArticle);
      refs.translateBtn.classList.add('hidden');
    } catch (err: unknown) {
      if (token !== this.loadToken) return;
      const msg = err instanceof Error ? err.message : 'Translation failed.';
      refs.translateBtn.textContent = savedLabel;
      refs.translateBtn.disabled = false;
      this.showError(msg);
    }
  }

  private showView(view: 'input' | 'loading' | 'error' | 'article'): void {
    const { refs } = this.options;
    refs.inputSection.classList.toggle('hidden', view !== 'input' && view !== 'article');
    refs.loadingSection.classList.toggle('hidden', view !== 'loading');
    refs.errorSection.classList.toggle('hidden', view !== 'error');
    refs.articleSection.classList.toggle('hidden', view !== 'article');

    if (view !== 'article') {
      refs.playerControls.classList.add('hidden');
    }
  }

  private showError(msg: string): void {
    this.options.refs.errorMessage.textContent = msg;
    this.showView('error');
  }

  private updateArticleInfo(article: Article, lang: Language): void {
    this.options.refs.articleInfo.textContent = [
      article.siteName,
      `${article.estimatedMinutes} min`,
      lang.toUpperCase(),
      `${article.wordCount} words`,
    ].join(' \u00B7 ');
  }

  private syncLanguageControls(): void {
    const { refs } = this.options;
    refs.settingsLangBtns.forEach((btn: HTMLButtonElement) => {
      btn.classList.toggle('active', btn.dataset.value === this.langOverride);
    });
  }

  private restoreLastArticle(): void {
    const last = loadLastArticle();
    if (!last) return;
    this.currentArticle = last.article;
    this.currentArticleUrl = last.article.resolvedUrl || '';
    this.displayArticle(last.article);
  }
}
