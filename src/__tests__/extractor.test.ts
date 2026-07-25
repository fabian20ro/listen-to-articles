import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import {
  extractArticle,
  extractArticleFromEpubUrl,
  extractArticleFromYoutube,
  extractYoutubeVideoId,
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromPdf,
  splitTextBySentences,
  extractParagraphsFromTextItems,
  MIN_PARAGRAPH_LENGTH,
} from '../lib/extractor.js';
import { sanitizeRenderedHtml, parseArticleFromHtml } from '../lib/extractors/extract-html.js';
import { extractTitleFromMarkdown } from '../lib/extractors/utils.js';

// ── Mock modules ──────────────────────────────────────────────────

vi.mock('@mozilla/readability', () => ({
  Readability: vi.fn(),
}));

vi.mock('turndown', () => ({
  default: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  version: 'mock',
  getDocument: vi.fn(),
}));

vi.mock('jszip', () => ({
  default: vi.fn(),
}));

const mockParse = vi.fn();

beforeEach(() => {
  // Use a simple text-to-markdown mock that preserves paragraph breaks
  vi.mocked(TurndownService).mockImplementation(function(this: any) {
    this.turndown = (html: string): string => {
      const div = document.createElement('div');
      div.innerHTML = html;
      // Simple heuristic: join P tags with double newlines
      const ps = Array.from(div.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li'));
      if (ps.length > 0) {
        return ps.map(p => p.textContent?.trim()).filter(Boolean).join('\n\n');
      }
      return div.textContent?.trim() || '';
    };
  } as any);

  vi.mocked(Readability).mockImplementation(function(this: any) {
    this.parse = mockParse;
  } as any);
  
  vi.mocked(JSZip).mockImplementation(function(this: any) {
    this.loadAsync = vi.fn().mockResolvedValue({
      file: vi.fn().mockReturnValue(null),
      files: {},
    });
  } as any);

  vi.mocked(pdfjsLib.getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getOutline: vi.fn().mockResolvedValue(null),
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      }),
    }),
  } as any);

  // Global fetch mock
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    return new Response('<html><body><p>Default mock content with enough words to pass the filter.</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────

function mockFetch(html: string, status = 200, headers: Record<string, string> = {}) {
  const mockResp = new Response(html, {
    status,
    headers: {
      'content-type': 'text/html',
      ...headers,
    },
  });
  if (status >= 400) {
    (mockResp as any).json = async () => ({ error: html });
  }
  vi.mocked(globalThis.fetch).mockResolvedValue(mockResp);
  return globalThis.fetch;
}

const ARTICLE_URL = 'https://example.com/article';
const PROXY = 'https://proxy.com/';
const SAMPLE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article Title</h1>
    <p>This is the first paragraph of the article. It contains enough text to pass the minimum length filter.</p>
    <p>This is the second paragraph with additional content. It also has enough text to be considered a real paragraph.</p>
  </article>
</body>
</html>
`;

// ── MIN_PARAGRAPH_LENGTH export ───────────────────────────────────────

describe('MIN_PARAGRAPH_LENGTH', () => {
  it('is exported as a public constant with value 20', () => {
    expect(MIN_PARAGRAPH_LENGTH).toBe(20);
  });
});


// ── extractTitleFromMarkdown ───────────────────────────────────────

describe('extractTitleFromMarkdown', () => {
  it('extracts title from H1 heading with content', () => {
    const markdown = '# My Great Title\n\nSome body text here.';
    expect(extractTitleFromMarkdown(markdown)).toBe('My Great Title');
  });

  it('returns empty string for bare # without content', () => {
    const markdown = '#\n\nSome text';
    expect(extractTitleFromMarkdown(markdown)).toBe('');
  });

  it('strips H1 prefix and trims whitespace from title', () => {
    const markdown = '#   My Title With Spaces   \n\nBody content here.';
    expect(extractTitleFromMarkdown(markdown)).toBe('My Title With Spaces');
  });

  it('returns first line when no H1 is present', () => {
    const markdown = 'First Line Without Heading\n\nSecond paragraph text.';
    expect(extractTitleFromMarkdown(markdown)).toBe('First Line Without Heading');
  });

  it('truncates title to 150 characters', () => {
    const longTitle = 'A'.repeat(200);
    const markdown = `${longTitle}\n\nBody content here.`;
    expect(extractTitleFromMarkdown(markdown)).toHaveLength(150);
  });

  it('strips markdown syntax from first line without H1', () => {
    const markdown = '**Bold Title**\n\nBody with **bold text**.';
    expect(extractTitleFromMarkdown(markdown)).toBe('Bold Title');
  });
});


// ── extractArticle ──────────────────────────────────────────────────

describe('extractArticle', () => {
  it('fetches through the proxy with the encoded URL', async () => {
    const fetchSpy = mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Test Article',
      content: '<p>Content with enough words to pass.</p>',
      textContent: 'Content with enough words to pass.',
      siteName: 'Example News',
      excerpt: 'Excerpt',
    });

    await extractArticle(ARTICLE_URL, PROXY);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(ARTICLE_URL)),
      expect.any(Object),
    );
  });

  it('uses X-Final-URL header as resolvedUrl when proxy returns it', async () => {
    const REDIRECTED_URL = 'https://web.de/magazine/politik/article-title-123';
    mockFetch(SAMPLE_HTML, 200, { 'X-Final-URL': REDIRECTED_URL });
    mockParse.mockReturnValue({
      title: 'Redirected Article',
      content: '<p>Content with enough words to pass.</p>',
      textContent: 'Content with enough words to pass.',
      siteName: 'WEB.DE',
      excerpt: 'Excerpt',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.resolvedUrl).toBe(REDIRECTED_URL);
    expect(article.siteName).toBe('WEB.DE');
  });

  it('falls back to original URL when X-Final-URL header is absent', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Original Article',
      content: '<p>Content with enough words to pass.</p>',
      textContent: 'Content with enough words to pass.',
      siteName: 'Example',
      excerpt: 'Excerpt',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.resolvedUrl).toBe(ARTICLE_URL);
  });

  it('returns a well-formed Article object on success', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Test Article Title',
      content: '<p>Paragraph one with enough words to be valid.</p><p>Paragraph two with enough words to be valid.</p>',
      textContent: 'Paragraph one with enough words to be valid. Paragraph two with enough words to be valid.',
      siteName: 'Example News',
      excerpt: 'Excerpt text...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.title).toBe('Test Article Title');
    expect(article.siteName).toBe('Example News');
    expect(article.paragraphs.length).toBe(2);
    expect(article.lang).toBe('en');
    expect(article.wordCount).toBeGreaterThan(0);
  });

  it('produces markdown content from extracted HTML', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Markdown Title',
      content: '<h1>Markdown Title</h1><p>Paragraph content with enough words to pass the filter.</p>',
      textContent: 'Markdown Title Paragraph content with enough words to pass the filter.',
      siteName: 'Markdown Site',
      excerpt: 'Excerpt...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.markdown.length).toBeGreaterThan(0);
    expect(article.markdown).toContain('Markdown Title');
  });

  it('falls back to <p> extraction when Readability returns null', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue(null);

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.title).toBe('Test Article'); // from doc.title
    expect(article.paragraphs.length).toBe(2);
  });

  it('throws when article content is empty', async () => {
    mockFetch('<html><body></body></html>');
    mockParse.mockReturnValue({ textContent: '' });

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow('Could not extract readable content from this page.');
  });

  it('filters out short paragraphs (< 20 chars)', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Short</p><p>This is a paragraph that is long enough to pass.</p><p>Ok</p><p>Another long enough paragraph here.</p>',
      textContent: 'Short. This is a paragraph that is long enough to pass. Ok. Another long enough paragraph here.',
      siteName: 'Site',
      excerpt: '...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    // "Short" and "Ok" should be filtered out
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('long enough');
  });

  it('uses hostname as siteName when Readability provides none', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content with enough words to pass the filter.</p>',
      textContent: 'Content with enough words to pass the filter.',
      siteName: '',
      excerpt: '...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.siteName).toBe('example.com');
  });

  it('falls back to single-newline splitting if double-newline yields nothing', async () => {
    mockFetch(SAMPLE_HTML);
    // Return HTML with single newlines only
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>This is the first paragraph with enough words to pass.</p><p>This is the second paragraph with enough words to pass.</p>',
      textContent: 'This is the first paragraph with enough words to pass.\nThis is the second paragraph with enough words to pass.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    // Single-newline split yields 2 paragraphs
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('first paragraph');
    expect(article.paragraphs[1]).toContain('second paragraph');
  });

  it('calculates estimated listening time', async () => {
    // 360 words / 180 wpm = 2 minutes
    const longText = 'word '.repeat(360);
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: `<p>${longText}</p>`,
      textContent: longText,
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.estimatedMinutes).toBe(2);
  });

  it('extracts htmlLang from <html lang="de"> attribute', async () => {
    mockFetch('<html lang="de"><body><p>Some German content that is long enough to pass the filter.</p></body></html>');
    mockParse.mockReturnValue({
      title: 'German Title',
      content: '<p>Some German content that is long enough to pass the filter.</p>',
      textContent: 'Some German content that is long enough to pass the filter.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.htmlLang).toBe('de');
  });

  it('returns empty htmlLang when <html> has no lang attribute', async () => {
    mockFetch('<html><body><p>English content here that is long enough to pass the filter.</p></body></html>');
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>English content with enough words...</p>',
      textContent: 'English content with enough words...',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.htmlLang).toBe('');
  });

  it('strips raw HTML tags from paragraphs', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Paragraph with <b>bold</b> and <i>italics</i> and enough words.</p>',
      textContent: 'Paragraph with bold and italics and enough words.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.paragraphs[0]).toBe('Paragraph with bold and italics and enough words.');
  });

  it('filters out paragraphs that are only data URIs', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==</p><p>Valid paragraph content with enough words to pass the filter.</p>',
      textContent: 'Valid paragraph content with enough words to pass the filter.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.paragraphs.length).toBe(1);
    expect(article.paragraphs[0]).toContain('Valid paragraph content');
  });

  it('filters out paragraphs with only image markdown and no real words', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>![Alt Text](https://example.com/image.jpg)</p><p>First paragraph with enough words to pass the filter.</p><p>Second paragraph with enough words to pass the filter.</p>',
      textContent: 'First paragraph with enough words to pass the filter. Second paragraph with enough words to pass the filter.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
  });

  it('strips image markdown with alt text instead of keeping alt', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>![This is alt text](https://example.com/img.png) First paragraph with enough words to pass the filter.</p><p>Second paragraph with enough words to pass the filter.</p>',
      textContent: 'First paragraph with enough words to pass the filter. Second paragraph with enough words to pass the filter.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
    for (const p of article.paragraphs) {
      expect(p).not.toContain('alt text');
    }
  });

  it('preserves links whose text starts with "Image" but is not a Jina reference', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Image processing techniques are fascinating and complex.</p><p>Another valid paragraph here with enough words to pass.</p>',
      textContent: 'Image processing techniques are fascinating and complex. Another valid paragraph here with enough words to pass.',
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    const joined = article.paragraphs.join(' ');
    expect(joined).toContain('Image processing techniques');
  });

  it('keeps paragraphs with Romanian diacritics', async () => {
    const romanianText = 'Acesta este un text în limba română care conține diacritice și multe cuvinte.';
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Romanian',
      content: `<p>${romanianText}</p>`,
      textContent: romanianText,
      siteName: 'Site',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.paragraphs.length).toBe(1);
    expect(article.paragraphs[0]).toContain('română');
  });

  it('strips <img> elements from DOM before Readability processes it', async () => {
    const htmlWithImages = `
      <html>
        <body>
          <p>Text before image with enough words to be valid.</p>
          <img src="test.jpg" alt="test">
          <figure>
            <img src="test2.jpg">
            <figcaption>Captioned image</figcaption>
          </figure>
          <p>Text after image with enough words to be valid.</p>
        </body>
      </html>
    `;
    mockFetch(htmlWithImages);

    let capturedDoc: Document | null = null;
    vi.mocked(Readability).mockImplementation(function(this: any, doc: Document) {
      capturedDoc = doc;
      this.parse = () => ({
        title: 'Title',
        content: doc.body.innerHTML,
        textContent: doc.body.textContent ?? '',
        siteName: 'Site',
        excerpt: '',
      });
    } as any);

    await extractArticle(ARTICLE_URL, PROXY);

    expect(capturedDoc).not.toBeNull();
    expect(capturedDoc!.querySelectorAll('img').length).toBe(0);
    expect(capturedDoc!.querySelectorAll('figcaption').length).toBe(1);
  });

  it('fetches directly (no proxy) when proxyBase is empty string', async () => {
    const DIRECT_URL = 'https://example.com/article';
    mockFetch(SAMPLE_HTML, 200, { 'X-Final-URL': DIRECT_URL });
    mockParse.mockReturnValue({
      title: 'Direct Title',
      content: '<p>Content with enough words to pass the filter.</p>',
      textContent: 'Content with enough words to pass the filter.',
      siteName: 'Example',
      excerpt: '',
    });

    const article = await extractArticle(DIRECT_URL, '');

    expect(article.title).toBe('Direct Title');
    // Direct path should use the URL itself (no proxy URL wrapping)
    const lastCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(lastCall[0]).toBe(DIRECT_URL);
  });

  it('passes TypeError through unchanged when direct fetch fails', async () => {
    mockFetch(''); // keep the default Response shape but...
    (globalThis.fetch as any).mockImplementationOnce(async () => {
      throw new TypeError('NetworkError');
    });

    await expect(extractArticle(ARTICLE_URL, '')).rejects.toThrow(TypeError);
  });
});

describe('extractYoutubeVideoId', () => {
  it('extracts ID from youtu.be URLs', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc12345678')).toBe('abc12345678');
    expect(extractYoutubeVideoId('https://youtu.be/short')).toBe(null);
  });
  it('extracts ID from youtube.com/watch?v= URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc12345678')).toBe('abc12345678');
    expect(extractYoutubeVideoId('https://youtube.com/watch?v=abc12345678')).toBe('abc12345678');
  });
  it('extracts ID from youtube.com/embed/ URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/abc12345678')).toBe('abc12345678');
  });
  it('extracts ID from youtube.com/shorts/ URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/abc12345678')).toBe('abc12345678');
  });
  it('extracts ID from youtube.com/live/ URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/live/abc12345678')).toBe('abc12345678');
  });
  it('extracts ID from youtube.com/v/ URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/v/abc12345678')).toBe('abc12345678');
  });
  it('returns null for invalid URLs', () => {
    expect(extractYoutubeVideoId('not-a-url')).toBe(null);
    expect(extractYoutubeVideoId('https://example.com/not-youtube')).toBe(null);
  });
});


describe('createArticleFromText', () => {
  it('uses first line as title if short enough', () => {
    const text = 'My Article Title\n\nFirst paragraph with enough text to pass the filter.\n\nSecond paragraph also has enough text.';
    const article = createArticleFromText(text);
    expect(article.title).toBe('My Article Title');
    expect(article.paragraphs.length).toBe(2);
  });

  it('uses default title if first line is too long', () => {
    const longFirstLine = 'Word '.repeat(100);
    const body = 'This is the body content with enough words to pass the filter and be a valid article.';
    const article = createArticleFromText(longFirstLine + '\n\n' + body);
    expect(article.title).toBe('Pasted Article');
  });

  it('handles very short text gracefully', () => {
    expect(() => createArticleFromText('A')).toThrow('Pasted text is too short to read as an article.');
  });
});

// ── sanitizeRenderedHtml (extract-html.ts) ────────────────────────

describe('sanitizeRenderedHtml', () => {
  it('strips script elements from rendered HTML', () => {
    const input = '<p>Hello</p><script>alert(1)</script>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<script>');
    expect(result).toContain('Hello');
  });

  it('strips iframe elements from rendered HTML', () => {
    const input = '<p>Article text with enough words to pass the filter.</p><iframe src="https://evil.com"></iframe>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<iframe');
    expect(result).toContain('Article text');
  });

  it('strips img and picture elements', () => {
    const input = '<p>Text with enough words to pass the filter.</p><img src="x.png"/><picture></picture>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<img');
    expect(result).not.toContain('<picture');
  });

  it('preserves allowed formatting tags (strong, em, code)', () => {
    const input = '<p><strong>bold</strong> and <em>italic</em> with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
  });

  it('removes event handler attributes', () => {
    const input = '<div onclick="alert(1)" onmouseover="steal()">safe content with enough words to pass the filter.</div>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onmouseover');
  });

  it('removes javascript: href values', () => {
    const input = '<a href="javascript:void(0)">malicious link</a><p>valid paragraph with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('href="javascript:');
  });

  it('removes data: src values', () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">trapped link</a><p>valid paragraph with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('href="data:');
  });

  it('adds target and rel to external http(s) links', () => {
    const input = '<p><a href="https://example.com">external link</a> with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('does not add target/rel for internal links', () => {
    const input = '<p><a href="/local/page">internal link</a> with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('target="_blank"');
  });

  it('returns empty string when no parseable container exists', () => {
    // An empty string should produce a Document with no meaningful content
    const result = sanitizeRenderedHtml('', DOMParser);
    expect(typeof result).toBe('string');
  });

  it('strips style and meta elements', () => {
    const input = '<style>body{display:none}</style><meta charset="utf-8"><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<style');
    expect(result).not.toContain('<meta');
  });

  it('strips video and audio elements', () => {
    const input = '<video src="evil.mp4"></video><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<video');
  });

  it('strips SVG elements', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"></svg><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<svg');
  });

  it('strips empty anchor tags', () => {
    const input = '<a href="https://example.com"></a><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<a');
  });

  it('preserves anchors with non-empty link text', () => {
    const input = '<p><a href="https://example.com">read more</a> content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).toContain('<a');
    expect(result).not.toContain('href=""');
  });

  it('strips form elements', () => {
    const input = '<form action="/submit"><input type="text"></form><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<form');
  });

  it('strips object and embed elements', () => {
    const input = '<object data="evil.swf"></object><embed src="evil.mp3"><p>content with enough words to pass the filter.</p>';
    const result = sanitizeRenderedHtml(input, DOMParser);
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
  });
});

// ── parseArticleFromHtml (extract-html.ts) ────────────────────────────────

describe('parseArticleFromHtml', () => {
  it('throws when HTML exceeds MAX_ARTICLE_SIZE', () => {
    const oversized = '<p>word </p>'.repeat(400_001); // >2M chars
    expect(() => parseArticleFromHtml(oversized, 'https://example.com', DOMParser)).toThrow();
  });

  it('throws with a helpful message mentioning the size limit', () => {
    const oversized = '<p>word </p>'.repeat(400_001);
    expect(() => parseArticleFromHtml(oversized, 'https://example.com', DOMParser)).toThrow(/HTML exceeds maximum size/);
  });

  it('does not throw for HTML at exactly the limit', () => {
    // Mock parseFromString to return a minimal Document so the "empty" guard below is never hit.
    const fakeDoc = new DOMParser().parseFromString('<p>text</p>', 'text/html');
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue(fakeDoc);
    vi.mocked(Readability).mockImplementation(function(this: any) {
      this.parse = () => ({
        title: 'OK',
        content: '<p>enough words to pass the filter and be considered valid article content.</p>',
        textContent: 'enough words to pass the filter and be considered valid article content.',
        siteName: 'Site',
        excerpt: '',
      });
    } as any);

    const atLimit = 'x'.repeat(2_000_000); // exactly MAX_ARTICLE_SIZE (guard is >, not >=)
    expect(() => parseArticleFromHtml(atLimit, 'https://example.com', DOMParser)).not.toThrow();
  });
});

// ── createArticleFromPdf ────────────────────────────────────────────────

describe('createArticleFromPdf', () => {
  it('extracts paragraphs from PDF text items', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getOutline: vi.fn().mockResolvedValue(null),
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [
              { str: 'First paragraph has enough text content to pass the minimum length filter.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
              { str: 'More text in the same paragraph section for the reader.', transform: [1, 0, 0, 1, 72, 686], height: 12 },
              { str: 'Second paragraph after a large vertical gap in the document.', transform: [1, 0, 0, 1, 72, 640], height: 12 },
              { str: 'Additional text in the second paragraph section right here.', transform: [1, 0, 0, 1, 72, 626], height: 12 },
            ],
          }),
        }),
      }),
    } as any);

    const file = new File([new ArrayBuffer(10)], 'test.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.title).toBe('test');
    expect(article.siteName).toBe('PDF');
    expect(article.paragraphs.length).toBe(2);
    expect(article.resolvedUrl).toBe('');
  });

  it('throws when getDocument fails', async () => {
    vi.mocked(pdfjsLib.getDocument).mockImplementation(() => {
      throw new Error('Load failed');
    });
    const file = new File([new ArrayBuffer(10)], 'test.pdf', { type: 'application/pdf' });
    await expect(createArticleFromPdf(file)).rejects.toThrow();
  });

  it('falls back to sentence splitting when PDF yields single paragraph', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getOutline: vi.fn().mockResolvedValue(null),
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [
              { str: 'First sentence of the PDF document. Second sentence follows along. Third sentence ends here. Fourth sentence begins now. Fifth sentence is quite short. Sixth sentence wraps up.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
            ],
          }),
        }),
      }),
    } as any);

    const file = new File([new ArrayBuffer(10)], 'single-block.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.paragraphs.length).toBeGreaterThan(1);
  });

  it('handles multi-page PDFs', async () => {
    const getPage = vi.fn()
      .mockResolvedValueOnce({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Page one content has enough text to be a valid paragraph for reading.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Page two content also has enough text to be its own paragraph for reading.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
          ],
        }),
      });

    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getOutline: vi.fn().mockResolvedValue(null),
        getPage,
      }),
    } as any);

    const file = new File([new ArrayBuffer(10)], 'multi.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.paragraphs.length).toBe(2);
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('throws when PDF has no readable text', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getOutline: vi.fn().mockResolvedValue(null),
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [{ str: '   ', transform: [1, 0, 0, 1, 0, 0], height: 12 }],
          }),
        }),
      }),
    } as any);

    const file = new File([new ArrayBuffer(10)], 'empty.pdf', { type: 'application/pdf' });
    await expect(createArticleFromPdf(file)).rejects.toThrow('Could not extract text from PDF');
  });
});


describe('extractArticle YouTube /v URL path', () => {
  it('handles youtube urls with /v path without trailing slash', async () => {
    const YOUTUBE_URL = 'https://youtube.com/v?v=abc';
    const videoJson = {
      title: 'Youtube Video',
      content: '<p>Content</p>',
      textContent: 'Content',
      siteName: 'Youtube',
      excerpt: '',
    };
    const fetchSpy = vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(videoJson), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(extractArticle(YOUTUBE_URL, PROXY)).resolves.toBeTruthy();
    
    const lastCall = fetchSpy.mock.calls[0];
    expect(lastCall[1].body).toContain(JSON.stringify({ url: YOUTUBE_URL, format: 'article' }));
  });
});

// ── extractArticle: PDF URL detection ───────────────────────────────

describe('extractArticle PDF URL detection', () => {
  beforeEach(() => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getOutline: vi.fn().mockResolvedValue(null),
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [
              { str: 'Valid PDF content here for the reader to process and extract.', transform: [1, 0, 0, 1, 0, 0], height: 12 },
            ],
          }),
        }),
      }),
    } as any);
  });

  it('detects PDF URLs by extension and uses PDF fetch path', async () => {
    const pdfUrl = 'https://example.com/document.pdf';
    mockFetch('%PDF-1.4');

    const article = await extractArticle(pdfUrl, PROXY);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(pdfUrl)),
      expect.any(Object),
    );
    expect(article.siteName).toBe('PDF');
  });

  it('passes onProgress callback through to extraction', async () => {
    const pdfUrl = 'https://example.com/doc.pdf';
    mockFetch('%PDF-1.4');

    const progressMessages: string[] = [];
    await extractArticle(pdfUrl, PROXY, undefined, { onProgress: (msg) => progressMessages.push(msg) });

    expect(progressMessages).toContain('Downloading PDF...');
    expect(progressMessages.some((m) => m.includes('Extracting text'))).toBe(true);
  });
});

// ── extractArticle: EPUB URL detection ──────────────────────────────

describe('extractArticle EPUB URL detection', () => {
  it('detects .epub URL extension and fetches as binary', async () => {
    mockFetch('ZIP', 200, { 'X-Final-URL': 'https://gutenberg.org/ebooks/test.epub' });

    // JSZip mock returns null for container.xml → "Invalid EPUB: missing container.xml"
    await expect(extractArticle('https://gutenberg.org/ebooks/test.epub', PROXY))
      .rejects.toThrow(/EPUB/i);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://gutenberg.org/ebooks/test.epub')),
      expect.any(Object),
    );
  });

  it('detects .epub.noimages URL pattern (Gutenberg variant)', async () => {
    mockFetch('ZIP');

    await expect(extractArticle('https://gutenberg.org/ebooks/49038.epub.noimages', PROXY))
      .rejects.toThrow(/EPUB/i);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://gutenberg.org/ebooks/49038.epub.noimages')),
      expect.any(Object),
    );
  });

  it('detects EPUB by content-type when URL has no .epub extension', async () => {
    mockFetch('ZIP', 200, { 'content-type': 'application/epub+zip' });

    // extractArticle fetches, sees application/epub+zip content-type, reads as ArrayBuffer
    await expect(extractArticle('https://example.com/book/12345', PROXY))
      .rejects.toThrow(/EPUB/i);
  });
});

// ── extractArticleFromEpubUrl ───────────────────────────────────────

describe('extractArticleFromEpubUrl', () => {
  it('throws on rate limit error from proxy', async () => {
    mockFetch('Too many requests', 429, { 'Retry-After': '60' });

    await expect(extractArticleFromEpubUrl('https://gutenberg.org/ebooks/49038.epub', PROXY))
      .rejects.toThrow(/requests/i);
  });

  it('throws when EPUB file is too large (> 10 MB)', async () => {
    mockFetch('Huge', 200, { 'content-length': '20000000' });

    await expect(extractArticleFromEpubUrl('https://gutenberg.org/ebooks/49038.epub', PROXY))
      .rejects.toThrow(/too large/i);
  });
});

describe('extractArticleFromYoutube', () => {
  it('throws when video ID is invalid', async () => {
    await expect(extractArticleFromYoutube('https://youtube.com/invalid', vi.fn())).rejects.toThrow('Invalid YouTube URL.');
  });

  it('extracts article from a valid YouTube URL', async () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const mockPlayerJson = {
      videoDetails: {
        title: 'Test YouTube Video',
        description: 'This is a test description.'
      },
      microformat: {
        playerMicroformatRenderer: {
          description: 'This is a test description.'
        }
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://mock-url.com/transcript',
              languageCode: 'en'
            }
          ]
        }
      }
    };

    const mockTranscriptResponse = {
      events: [
        {
          segs: [{ utf8: 'Hello' }],
          dDurationMs: 1000,
          tStartMs: 0
        },
        {
          segs: [{ utf8: 'world!' }],
          dDurationMs: 1000,
          tStartMs: 1000
        }
      ]
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mockPlayerJson), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTranscriptResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const article = await extractArticleFromYoutube(url, mockFetch as any);
    expect(article.title).toBe('Transcript for: Test YouTube Video');
    expect(mockFetch).toHaveBeenCalledTimes(2); // player JSON + transcript segments
  });
});

describe('extractYoutubeVideoId', () => {
  it('extracts id from standard watch URL', () => {
    const id = extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(id).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtu.be URL', () => {
    const id = extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ');
    expect(id).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from embed URL', () => {
    const id = extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(id).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from shorts URL', () => {
    const id = extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(id).toBe('dQw4w9WgXcQ');
  });

  it('returns null for invalid YouTube URLs', () => {
    expect(extractYoutubeVideoId('not-a-url')).toBeNull();
    expect(extractYoutubeVideoId('https://example.com/watch?v=not-valid')).toBeNull();
  });



  it('extracts id from live URL', () => {
    const id = extractYoutubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ');
    expect(id).toBe('dQw4w9WgXcQ');
  });

});



