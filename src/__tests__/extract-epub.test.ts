import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { sanitizeHref, parseEpubFromArrayBuffer, createArticleFromEpub, extractOpfPath } from '../lib/extractors/extract-epub.js';

describe('sanitizeHref', () => {
  it('returns normal paths as-is', () => {
    expect(sanitizeHref('chapters/intro.xhtml')).toBe('chapters/intro.xhtml');
    expect(sanitizeHref('text/section.html')).toBe('text/section.html');
    expect(sanitizeHref('a/b/c/d/e.xhtml')).toBe('a/b/c/d/e.xhtml');
  });

  it('strips single-dot segments', () => {
    expect(sanitizeHref('./chapter.xhtml')).toBe('chapter.xhtml');
    expect(sanitizeHref('text/./section.html')).toBe('text/section.html');
    expect(sanitizeHref('a/b/c/./d.xhtml')).toBe('a/b/c/d.xhtml');
  });

  it('collapses double-dot segments', () => {
    expect(sanitizeHref('../chapter.xhtml')).toBe('chapter.xhtml');
    expect(sanitizeHref('text/../section.html')).toBe('section.html');
    expect(sanitizeHref('a/b/../../c.xhtml')).toBe('c.xhtml');
  });

  it('does not allow path traversal beyond root', () => {
    expect(sanitizeHref('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeHref('../../../etc/shadow')).toBe('etc/shadow');
  });

  it('handles URL-encoded traversal', () => {
    expect(sanitizeHref('%2e%2e/chapters/intro.xhtml')).toBe('chapters/intro.xhtml');
    expect(sanitizeHref('text/%2e%2e/section.html')).toBe('section.html');
  });

  it('decodes percent-encoded slashes', () => {
    // %2F is '/' — decoded, the path collapses to a single segment
    expect(sanitizeHref('chapters%2Fintro.xhtml')).toBe('chapters/intro.xhtml');
  });

  it('throws on malformed percent-encoding (e.g. "%2")', () => {
    // decodeURIComponent('%2') raises URIError — sanitizeHref does not catch this,
    // so the error propagates to the caller as a contract boundary.
    expect(() => sanitizeHref('%2')).toThrow();
  });

  it('throws on invalid percent-encoded characters (e.g. "%GG")', () => {
    expect(() => sanitizeHref('chapters%GGintro.xhtml')).toThrow();
  });
});

describe('parseEpubFromArrayBuffer', () => {
  it('throws when given an empty buffer', async () => {
    await expect(
      parseEpubFromArrayBuffer(new ArrayBuffer(0), 'https://example.com/book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      }),
    ).rejects.toThrow(/zip/i);
  });

  it('throws on invalid EPUB (junk buffer)', async () => {
    await expect(
      parseEpubFromArrayBuffer(new ArrayBuffer(20), 'https://example.com/book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      }),
    ).rejects.toThrow(/zip/i);
  });

  it('derives title from URL pathname (does not throw "Invalid URL")', async () => {
    // Use a buffer that will fail at parseEpubCore but verify the fallback path works
    const buf = new Uint8Array(10).buffer;
    try {
      await parseEpubFromArrayBuffer(buf, 'https://example.com/my-book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      });
    } catch (err: any) {
      // Expected to fail at some point — just ensure it doesn't throw about invalid URL
      expect(err.message).not.toContain('Invalid URL');
    }
  });

  it('extracts text from a minimal valid EPUB', async () => {
    const zip = new JSZip();

    // META-INF/container.xml — OPF entry point
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );

    // content.opf — manifest + spine referencing one chapter
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
  <metadata dc:language="en">
    <dc:title>Test Book</dc:title>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    // One XHTML chapter with two paragraphs of text
    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <p>This is the first paragraph of a test book about pixel article reading.</p>
    <p>A second paragraph with enough words to pass minimum length filters.</p>
  </body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    // The DOMParser mock delegates to the real one provided by JSDOM/Vitest globals
    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/test-book.epub', domParserCtor);

    expect(article.title).toBe('Test Book');
    expect(article.textContent).toContain('first paragraph');
    expect(article.textContent).toContain('second paragraph');
  });

  it('uses URL-derived fallback title when OPF has no <title>', async () => {
    const zip = new JSZip();

    // container.xml without namespace — extractOpfPath only uses full-path regex, so this still works
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    // OPF with empty title — should fall through to URL pathname fallback
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata dc:language="en"></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>A paragraph long enough to satisfy the minimum length requirement for extraction.</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/my-book.epub', domParserCtor);

    expect(article.title).toBe('my-book');
  });

  it('skips manifest entries with unsupported media types (e.g. images)', async () => {
    const zip = new JSZip();

    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Image Book</dc:title></metadata>
  <manifest>
    <item id="img1" href="cover.png" media-type="image/png"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="img1"/>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'cover.png',
      '\x89PNG\r\n\x1a\n' // minimal PNG header bytes — content doesn't matter; file is skipped
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>This paragraph survives because it passes the extraction filter.</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/image-book.epub', domParserCtor);

    expect(article.title).toBe('Image Book');
    // cover.png is skipped — only the chapter paragraph should appear
    expect(article.textContent).toContain('survives');
  });

  it('handles case-different container.xml path (readZipFile fallback)', async () => {
    const zip = new JSZip();

    // Use uppercase Container.xml — extractOpfPath regex still finds full-path,
    // but readZipFile must fall back to case-insensitive match in zip.files.
    zip.file(
      'META-INF/Container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Case Book</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>A paragraph that is long enough to pass the extraction filter in this test.</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/case-book.epub', domParserCtor);

    expect(article.title).toBe('Case Book');
    expect(article.textContent).toContain('long enough');
  });

  it('silently skips spine entries whose idref is absent from manifest (robustness contract)', async () => {
    const zip = new JSZip();

    // container.xml
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    // OPF: spine references idref "ghost-ch" which is NOT in manifest, and idref "ch1" which IS.
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Broken Spine</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ghost-ch"/>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>A paragraph long enough to pass the extraction filter through a broken-spine EPUB.</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    // Should not throw — production silently skips the missing idref and still produces text from valid chapters.
    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/broken.spine.epub', domParserCtor);

    expect(article.title).toBe('Broken Spine');
    expect(article.textContent).toContain('long enough to pass');
  });

  it('throws when decompressed content exceeds the zip-bomb guard', async () => {
    const zip = new JSZip();

    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Big Book</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    // Generate a chapter whose string length exceeds MAX_EXTRACTED_BYTES (50 MB).
    const giantText = 'x'.repeat(51_000_000);
    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>${giantText}</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    await expect(
      parseEpubFromArrayBuffer(buf, 'https://example.com/big.epub', domParserCtor),
    ).rejects.toThrow(/too large after decompression/);
  });

  it('throws when OPF yields no extractable chapters (empty spine)', async () => {
    const zip = new JSZip();

    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    // OPF with valid manifest and spine, but references an idref that does NOT exist in the manifest.
    // Production should detect zero extractable chapters and throw a specific error.
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Empty Book</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="nonexistent-chapter"/>
  </spine>
</package>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    // The spine references an idref absent from the manifest — parseOpf builds zero chapterPaths.
    await expect(
      parseEpubFromArrayBuffer(buf, 'https://example.com/empty.epub', domParserCtor),
    ).rejects.toThrow(/Could not find any chapters in this EPUB/);
  });

  it('preserves heading markdown formatting in extracted text', async () => {
    const zip = new JSZip();

    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata><dc:title>Heading Book</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h2>Chapter Title</h2>
    <p>A paragraph long enough to pass the extraction filter and survive the speakable-text check.</p>
    <h3>Subsection Header</h3>
    <p>Another paragraph that is sufficiently long and speakable for test validation purposes here.</p>
  </body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await parseEpubFromArrayBuffer(buf, 'https://example.com/heading-book.epub', domParserCtor);

    // Headings are formatted with ## or ### prefix per extractTextFromXhtml.
    expect(article.textContent).toContain('## Chapter Title');
    expect(article.textContent).toContain('### Subsection Header');
    expect(article.textContent).toContain('long enough to pass');
  });
});

describe('createArticleFromEpub', () => {
  it('throws when file.size exceeds MAX_PDF_SIZE (10 MB)', async () => {
    const oversizedFile = {
      name: 'huge.epub',
      size: 11_000_000, // > 10 MB
      async arrayBuffer() { return new ArrayBuffer(0); },
    };

    await expect(
      createArticleFromEpub(oversizedFile as any, class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      }),
    ).rejects.toThrow(/EPUB is too large/);
  });

  it('creates an Article from a minimal valid EPUB via the File-based path', async () => {
    const zip = new JSZip();

    // Build a complete valid EPUB in memory
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`
    );

    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf">
  <metadata dc:language="en">
    <dc:title>File Path Book</dc:title>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
    );

    zip.file(
      'chapter.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>A paragraph long enough to pass the extraction filter through the file-based path.</p></body>
</html>`
    );

    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const fileLike = {
      name: 'file-path-book.epub',
      get size(): number { return buf.byteLength; },
      async arrayBuffer() { return buf; },
    };

    const domParserCtor = class {
      parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
    };

    const article = await createArticleFromEpub(fileLike as any, domParserCtor);

    expect(article.title).toBe('File Path Book');
    expect(article.textContent).toContain('long enough to pass');
  });
});

describe('extractOpfPath', () => {
  it('returns the full-path value from a standard container.xml', () => {
    const xml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf"/>
  </rootfiles>
</container>`;
    expect(extractOpfPath(xml)).toBe('content.opf');
  });

  it('returns the path even with media-type attribute', () => {
    const xml = '<rootfile full-path="oebps/content.opf" media-type="application/oebps-package+xml"/>';
    expect(extractOpfPath(xml)).toBe('oebps/content.opf');
  });

  it('returns null when no full-path attribute is present', () => {
    const xml = '<rootfile media-type="application/oebps-package+xml"/>';
    expect(extractOpfPath(xml)).toBeNull();
  });

  it('rejects paths containing unsafe characters (spaces, parens)', () => {
    const xml = '<rootfile full-path="my content.opf"/>';
    expect(extractOpfPath(xml)).toBeNull();
    const xml2 = '<rootfile full-path="bad(path).opf"/>';
    expect(extractOpfPath(xml2)).toBeNull();
  });

  it('rejects paths containing backslash characters', () => {
    // Backslashes in OPF full-path values indicate malformed or crafted EPUBs;
    // the validation regex should reject them.
    const xml = '<rootfile full-path="chapters\\intro.xhtml"/>';
    expect(extractOpfPath(xml)).toBeNull();
  });

  it('rejects paths longer than 512 characters', () => {
    const longName = 'a'.repeat(513);
    const xml = `<rootfile full-path="${longName}"/>`;
    expect(extractOpfPath(xml)).toBeNull();
  });

  it('accepts a path exactly at the 512-character limit', () => {
    const exactName = 'a'.repeat(512);
    const xml = `<rootfile full-path="${exactName}"/>`;
    expect(extractOpfPath(xml)).toBe(exactName);
  });

  it('returns the first full-path match only', () => {
    const xml = `full-path="first.opf" full-path="second.opf"`;
    expect(extractOpfPath(xml)).toBe('first.opf');
  });
});
