import { describe, it, expect, beforeEach } from 'vitest';
import { extractUrl, isValidArticleUrl, getUrlFromParams, clearQueryParams } from '../lib/url-utils.js';

// ── isValidArticleUrl ───────────────────────────────────────────────

describe('isValidArticleUrl', () => {
  it('accepts a standard https URL', () => {
    expect(isValidArticleUrl('https://example.com/article')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isValidArticleUrl('http://news.site.org/post/123')).toBe(true);
  });

  it('rejects URLs without a dot in hostname', () => {
    expect(isValidArticleUrl('http://localhost/article')).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(isValidArticleUrl('ftp://files.example.com/doc')).toBe(false);
    expect(isValidArticleUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects garbage strings', () => {
    expect(isValidArticleUrl('not a url')).toBe(false);
    expect(isValidArticleUrl('')).toBe(false);
  });

  it('accepts URLs with paths, query params, and fragments', () => {
    expect(isValidArticleUrl('https://example.com/path?q=1&b=2#section')).toBe(true);
  });

  it('accepts URLs with subdomains', () => {
    expect(isValidArticleUrl('https://blog.sub.example.co.uk/post')).toBe(true);
  });

  it('accepts naked domain URLs', () => {
    expect(isValidArticleUrl('https://example.com')).toBe(true);
  });
});

// ── extractUrl ──────────────────────────────────────────────────────

describe('extractUrl', () => {
  it('returns a direct URL unchanged', () => {
    expect(extractUrl('https://example.com/article')).toBe('https://example.com/article');
  });

  it('trims whitespace', () => {
    expect(extractUrl('  https://example.com/article  ')).toBe('https://example.com/article');
  });

  it('extracts a URL from a "shared" message format (title + URL at end)', () => {
    const shared = 'Cool Article Title\nhttps://news.site.com/2024/post';
    expect(extractUrl(shared)).toBe('https://news.site.com/2024/post');
  });

  it('returns null for text with no URL', () => {
    expect(extractUrl('Just some random text without links')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('returns null for a URL without a dot in hostname', () => {
    expect(extractUrl('http://localhost:3000/page')).toBeNull();
  });

  it('returns null when URL is embedded mid-text (not at end)', () => {
    expect(extractUrl('Check this out: https://example.com/article — great read')).toBeNull();
  });

  it('strips trailing punctuation from the extracted URL', () => {
    expect(extractUrl('Check this out https://example.com/article.')).toBe('https://example.com/article');
    expect(extractUrl('Check this out (https://example.com/article)')).toBe('https://example.com/article');
    expect(extractUrl('Check this out https://example.com/article!')).toBe('https://example.com/article');
  });

  it('returns null when multiple URLs are embedded in text', () => {
    const text = 'See https://first.com/a and https://second.com/b for details.';
    expect(extractUrl(text)).toBeNull();
  });

  it('extracts a Google share URL from title + URL text', () => {
    const shared =
      'Gravity Still Sucks -- But Researchers Say Quantum Interference Could Make it Push https://share.google/o5SabsH2YlQYu8x7F';
    expect(extractUrl(shared)).toBe('https://share.google/o5SabsH2YlQYu8x7F');
  });

  it('extracts a URL when title contains special characters', () => {
    const shared = 'Breaking: "Major Update" — 50% off! https://news.example.com/deal?id=42';
    expect(extractUrl(shared)).toBe('https://news.example.com/deal?id=42');
  });

  it('extracts URL from social-media share text with long description', () => {
    const shared =
      "Psychology says people who become harder to be around as they get older aren't becoming mean — they're becoming less willing to absorb other people's discomfort at the expense of their own, and that's a skill most people mistake for bitterness https://share.google/yvjomHo2mSvrYaOcf";
    expect(extractUrl(shared)).toBe('https://share.google/yvjomHo2mSvrYaOcf');
  });

  it('returns null when trailing punctuation stripping leaves an invalid URL', () => {
    // After stripping trailing dots, the remaining string is not a valid URL.
    const shared = 'Read this https://.';
    expect(extractUrl(shared)).toBeNull();
  });

  it('extracts URL when prefix is exactly 500 chars', () => {
    const title = 'A'.repeat(500);
    expect(extractUrl(`${title} https://example.com/article`)).toBe('https://example.com/article');
  });

  it('returns null when prefix exceeds 500 chars', () => {
    const longTitle = 'A'.repeat(510);
    expect(extractUrl(`${longTitle} https://example.com/article`)).toBeNull();
  });

  it('returns null for pasted article with embedded URLs', () => {
    const article = 'Article Title\n\nFirst paragraph with https://example.com/ref in the middle.\n\nSecond paragraph continues here.';
    expect(extractUrl(article)).toBeNull();
  });

  it('rejects a protocol-relative URL (regex matches but validation fails)', () => {
    // The regex matches '//' prefixes, but isValidArticleUrl rejects them.
    expect(extractUrl('//example.com/article')).toBeNull();
  });
});

// ── getUrlFromParams ────────────────────────────────────────────────

describe('getUrlFromParams', () => {
  beforeEach(() => {
    // Reset URL to a clean state
    window.history.replaceState(null, '', '/');
  });

  it('extracts URL from ?url= query param', () => {
    window.history.replaceState(null, '', '/?url=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('extracts URL from ?text= query param', () => {
    window.history.replaceState(null, '', '/?text=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('prefers ?url= over ?text=', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=https%3A%2F%2Ffirst.com&text=https%3A%2F%2Fsecond.com',
    );
    expect(getUrlFromParams()).toBe('https://first.com');
  });

  it('extracts URL embedded in text param', () => {
    window.history.replaceState(
      null,
      '',
      '/?text=Check%20this%20https%3A%2F%2Fexample.com%2Fpost',
    );
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('extracts URL from ?link= query param', () => {
    window.history.replaceState(null, '', '/?link=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('extracts URL from ?u= query param', () => {
    window.history.replaceState(null, '', '/?u=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('returns null when no URL params are present', () => {
    window.history.replaceState(null, '', '/');
    expect(getUrlFromParams()).toBeNull();
  });

  it('returns null when params contain no valid URL', () => {
    window.history.replaceState(null, '', '/?text=just+some+text');
    expect(getUrlFromParams()).toBeNull();
  });

  it('extracts URL from ?title= param as fallback', () => {
    window.history.replaceState(
      null,
      '',
      '/?title=Article+Title+https%3A%2F%2Fexample.com%2Fpost',
    );
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('extracts URL from shared text with title prefix in ?text=', () => {
    const shared = encodeURIComponent(
      'Gravity Still Sucks -- But Researchers Say Quantum Interference Could Make it Push https://share.google/o5SabsH2YlQYu8x7F',
    );
    window.history.replaceState(null, '', `/?text=${shared}`);
    expect(getUrlFromParams()).toBe('https://share.google/o5SabsH2YlQYu8x7F');
  });

  it('returns null when all candidate params are present but invalid', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=garbage&text=no+url+here&title=nope&link=&u=also-not-a-url',
    );
    expect(getUrlFromParams()).toBeNull();
  });

  it('returns null when ?url= is an empty string and fallbacks are invalid', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=&text=nope&title=nope&link=nope&u=nope',
    );
    expect(getUrlFromParams()).toBeNull();
  });

  it('falls back to ?text= when ?url= contains an invalid URL', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=garbage&text=https%3A%2F%2Fexample.com%2Fpost',
    );
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('falls back to ?title= when both ?url= and ?text= are invalid', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=bogus&text=nope&title=Article Title%20https%3A%2F%2Fexample.com%2Fpost',
    );
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });
});

// ── clearQueryParams ────────────────────────────────────────────────

describe('clearQueryParams', () => {
  it('removes query params from the URL bar', () => {
    window.history.replaceState(null, '', '/?url=https%3A%2F%2Fexample.com');
    clearQueryParams();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/');
  });

  it('preserves pathname when clearing a non-root URL', () => {
    window.history.replaceState(null, '', '/article/123?url=https%3A%2F%2Fexample.com');
    clearQueryParams();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/article/123');
  });

  it('does nothing when there are no query params', () => {
    window.history.replaceState(null, '', '/');
    clearQueryParams(); // should not throw
    expect(window.location.pathname).toBe('/');
  });
});
