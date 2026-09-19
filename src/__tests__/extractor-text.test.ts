import { describe, it, expect } from 'vitest';
import { createArticleFromText, createArticleFromTextFile } from '../lib/extractor.js';

describe('createArticleFromText', () => {
  it('creates an article from valid text', () => {
    const text = 'Title Line\nThis is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const article = createArticleFromText(text);
    
    expect(article.title).toBe('Title Line');
    expect(article.textContent).toContain('This is a valid article');
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it('throws error for very short text', () => {
    // 'A' is too short (charCount < 4)
    expect(() => createArticleFromText('A')).toThrow('Pasted text is too short to read as an article.');
  });

  it('handles empty text by throwing error', () => {
    expect(() => createArticleFromText('')).toThrow();
  });

  it('throws for single-line paste (title-only, no body)', () => {
    // Single line with no newline: the entire string becomes the title,
    // leaving zero words of body content.
    expect(() => createArticleFromText('Just one line of plain text here.')).toThrow(
      'Pasted text is too short to read as an article.',
    );
  });

  it('uses "Pasted Article" when first line exceeds 150 chars', () => {
    const title = 'x'.repeat(200);
    const body = 'This is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const text = `${title}\n${body}`;
    const article = createArticleFromText(text);

    expect(article.title).toBe('Pasted Article');
    expect(article.textContent).toContain(body);
  });

  it('splits multi-paragraph pasted text into multiple paragraphs', () => {
    const text = 'My Title\n\nFirst paragraph with enough words.\n\nSecond paragraph also valid.';
    const article = createArticleFromText(text);

    expect(article.paragraphs).toHaveLength(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
  });

  it('accepts exactly 3 words as minimum body', () => {
    const text = 'Title Line\none two three';
    const article = createArticleFromText(text);

    expect(article.wordCount).toBeGreaterThanOrEqual(3);
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it('rejects body with fewer than 3 words', () => {
    // Body has exactly 2 words — below the 3-word minimum.
    const text = 'Title Line\none two';
    expect(() => createArticleFromText(text)).toThrow();
  });

  it('accepts title at exact 150-char boundary', () => {
    const title = 'x'.repeat(150);
    const body = 'This is a valid article with enough words to be processed correctly.';
    const text = `${title}\n${body}`;
    const article = createArticleFromText(text);

    expect(article.title).toBe(title);
    expect(article.textContent).toContain(body);
  });

  it('strips markdown image references before processing', () => {
    const body = 'This is a valid article with enough words to be processed correctly.';
    const text = `My Title\n![alt](image.png)\n${body}`;
    const article = createArticleFromText(text);

    expect(article.title).toBe('My Title');
    // Image reference should not appear in body content.
    expect(article.textContent).not.toContain('![alt]');
    expect(article.textContent).toContain(body);
  });

  it('handles tab-separated words in body correctly', () => {
    const text = 'Title Line\nword one\tword two\tword three';
    const article = createArticleFromText(text);

    // Tabs are preserved as whitespace separators within a paragraph.
    expect(article.paragraphs.length).toBeGreaterThan(0);
    expect(article.wordCount).toBeGreaterThanOrEqual(3);
    expect(article.textContent).toContain('word one');
  });

  it('produces paragraphs when long-title pasted text has single body line', () => {
    const title = 'x'.repeat(200);
    const body = 'This is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const text = `${title}\n${body}`;
    const article = createArticleFromText(text);

    expect(article.paragraphs.length).toBeGreaterThan(1);
  });

  it('strips interleaved markdown images and preserves surrounding paragraph structure', () => {
    // Images embedded between real body text — exercises replace(IMAGE_MD_RE, '') followed
    // by splitPlainTextParagraphs, the two-step path where stripping leaves blank lines that
    // paragraph splitting must collapse cleanly.
    const title = 'My Title';
    const para1 = 'First paragraph with enough words to count as valid body content.';
    const para2 = 'Second paragraph also valid for processing the article correctly.';
    const text = `${title}\n${para1}\n![left](l.png)\n\n![right](r.png)\n\n${para2}`;
    const article = createArticleFromText(text);

    expect(article.title).toBe('My Title');
    expect(article.textContent).not.toContain('![left]');
    expect(article.textContent).not.toContain('![right]');
    expect(article.textContent).toContain(para1);
    expect(article.textContent).toContain(para2);
  });

  it('strips markdown bold markers from body text', () => {
    const text =
      'My Article\nThis text contains **bold word** inline and it has enough words to process.';
    const article = createArticleFromText(text);

    expect(article.textContent).not.toContain('*');
    expect(article.paragraphs.some((p) => p.includes('bold word'))).toBe(true);
  });

  it('strips markdown heading markers from body lines', () => {
    const text =
      'My Article\n# My Heading Title Here\nThis body has enough words to be processed by the reader correctly.';
    const article = createArticleFromText(text);

    expect(article.title).toBe('My Article');
    expect(article.textContent).not.toContain('#');
    expect(article.paragraphs.some((p) => p.includes('My Heading Title Here'))).toBe(true);
  });

  it('removes horizontal-rule lines between paragraphs', () => {
    const text =
      'My Article\nFirst paragraph with enough words to count as valid body content.\n---\nSecond paragraph also has enough words to process correctly.';
    const article = createArticleFromText(text);

    expect(article.paragraphs).toHaveLength(2);
    expect(
      article.paragraphs.some((p) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(p)),
    ).toBe(false);
  });

  it('preserves link text and strips image markers when mixed with formatting', () => {
    const text =
      'My Article\nRead [link text](http://example.com) for more. This sentence has enough words to process.\n![alt](img.png)';
    const article = createArticleFromText(text);

    expect(article.paragraphs.some((p) => p.includes('link text'))).toBe(true);
    expect(article.textContent).not.toContain('![alt]');
  });

  it('rejects body that becomes empty after stripping all-image content', () => {
    // When the body is composed entirely of markdown image references, stripping them
    // leaves nothing — must raise the standard short-text error.
    const title = 'My Title';
    const text = `${title}\n![a](a.png)\n![b](b.png)`;

    expect(() => createArticleFromText(text)).toThrow('Pasted text is too short to read as an article.');
  });

  it('trims leading and trailing whitespace from a valid title line', () => {
    // Production code runs firstLine.trim() before length-checking — verify the stored
    // title matches that trimmed form, not the raw input.
    const text = '   My Title   \nThis is a valid article with enough words to be processed correctly.';
    const article = createArticleFromText(text);

    expect(article.title).toBe('My Title');
  });
});

describe('createArticleFromTextFile', () => {
  it('creates an article from a valid file', async () => {
    const file = new File(['This is a valid article with enough words to be processed correctly.'], 'test.txt', {
      type: 'text/plain',
    });
    const article = await createArticleFromTextFile(file);
    expect(article.title).toBe('test');
    expect(article.wordCount).toBeGreaterThan(0);
  });

  it('throws error for too large file', async () => {
    const hugeFile = new File(['a'.repeat(3 * 1024 * 1024)], {
      type: 'text/plain',
    });
    await expect(createArticleFromTextFile(hugeFile)).rejects.toThrow('File is too large');
  });

  it('throws error for empty file', async () => {
    const emptyFile = new File([''], {
      type: 'text/plain',
    });
    await expect(createArticleFromTextFile(emptyFile)).rejects.toThrow('The text file is empty.');
  });
});
