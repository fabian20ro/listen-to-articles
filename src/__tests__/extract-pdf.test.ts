import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePdfFromArrayBuffer, createArticleFromPdf, extractParagraphsFromTextItems } from '../lib/extractors/extract-pdf';
import { MAX_PDF_SIZE, MIN_PARAGRAPH_LENGTH } from '../lib/extractors/types.js';

describe('extractParagraphsFromTextItems', () => {
  it('should handle empty or whitespace-only strings', () => {
    const items = [
      { str: ' ', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 650], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual([]);
  });

  it('should extract single paragraph', () => {
    const items = [
      { str: 'Hello world', transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });

  it('should split paragraphs based on vertical gap', () => {
    const items = [
      { str: 'First paragraph', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Second paragraph', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 50 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['First paragraph', 'Second paragraph']);
  });

  it('should handle hyphenated line breaks', () => {
    const items = [
      { str: 'This is a long-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 690], height: 12 } // gap 10 <= 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long word']);
  });

  it('should handle multiple items on the same line', () => {
    const items = [
      { str: 'Word 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Word 2', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Word 3', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 50 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Word 1 Word 2', 'Word 3']);
  });

  it('should handle multiple lines with a hyphenated word in the middle', () => {
    const items = [
      { str: 'This is a long-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word that spans lines', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'on a new line', transform: [1, 0, 0, 1, 0, 680], height: 12 },
      { str: 'next paragraph', transform: [1, 0, 0, 1, 0, 600], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual([
      'This is a long word that spans lines on a new line',
      'next paragraph'
    ]);
  });

  it('should handle multiple lines with varying heights on the same line', () => {
    const items = [
      { str: 'Line 1', transform: [1, 0, 0, 1, 0, 700], height: 20 },
      { str: 'Line 2', transform: [1, 0, 0, 1, 0, 650], height: 10 },
      { str: 'Line 3', transform: [1, 0, 0, 1, 0, 640], height: 10 }
    ];
    // gap 1: |700-650|=50. threshold=30. 50 > 30 -> new para.
    // gap 2: |650-640|=10. threshold=15. 10 < 15 -> same para.
    expect(extractParagraphsFromTextItems(items)).toEqual(['Line 1', 'Line 2 Line 3']);
  });

  it('should handle " - " hyphenation', () => {
    const items = [
      { str: 'This is a long -', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 690], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long word']);
  });

  it('should handle trailing whitespace before hyphen on next line', () => {
    const items = [
      { str: 'Word with trailing ', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '-', transform: [1, 0, 0, 1, 0, 685], height: 12 }, // gap 15 <= 27 -> same paragraph
      { str: 'continuation', transform: [1, 0, 0, 1, 0, 670], height: 12 } // gap 15 <= 27 -> still same paragraph
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Word with trailing continuation']);
  });

  it('should join paragraphs when hyphen has surrounding whitespace', () => {
    const items = [
      { str: 'This is a long - ', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 685], height: 12 } // gap 15 <= 27 -> same paragraph
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long word']);
  });

  it('should handle line spacing accurately', () => {
    const items = [
      { str: 'Line 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Line 2', transform: [1, 0, 0, 1, 0, 675], height: 12 }, // gap 25 <= 27
      { str: 'Line 3', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 25 <= 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Line 1 Line 2 Line 3']);
  });

  it('should handle large gaps between paragraphs', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 600], height: 12 } // gap 100 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });

  it('should handle items with zero height', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 0 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 650], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });

  it('should handle empty strings in items', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 673], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 600], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });

  it('should respect the paragraph boundary threshold', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 673], height: 12 }, // gap 27 (threshold 27)
      { str: 'Para 3', transform: [1, 0, 0, 1, 0, 645], height: 12 }, // gap 28 (threshold 27)
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1 Para 2', 'Para 3']);
  });

  it('should handle a single hyphen as a text item', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '-', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'world', transform: [1, 0, 0, 1, 0, 680], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });

  it('should return a single block for items with no sentence boundaries (regression: empty-after-split guard input)', () => {
    const items = [
      { str: 'Continuous text without any periods that would split into sentences', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'stays on the same line or next line without a period-space-uppercase pattern', transform: [1, 0, 0, 1, 0, 688], height: 12 }
    ];
    // No ". " followed by uppercase -> extractParagraphsFromTextItems returns one paragraph;
    // parsePdfFromArrayBuffer's sentence-split would yield zero qualifying fragments.
    expect(extractParagraphsFromTextItems(items)).toEqual([
      'Continuous text without any periods that would split into sentences stays on the same line or next line without a period-space-uppercase pattern'
    ]);
  });


});

describe('extractParagraphsFromTextItems - input guards', () => {
  it('should return [] for undefined items (regression: null guard)', () => {
    expect(extractParagraphsFromTextItems(undefined as any)).toEqual([]);
  });

  it('should return [] for null items (regression: null guard)', () => {
    expect(extractParagraphsFromTextItems(null as any)).toEqual([]);
  });

  it('should skip text items with non-string str without throwing', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: null as any, transform: [1, 0, 0, 1, 0, 693], height: 12 },
      { str: undefined as any, transform: [1, 0, 0, 1, 0, 686], height: 12 },
      { str: ' world', transform: [1, 0, 0, 1, 0, 679], height: 12 }
    ];
    // gaps are all <= 27 (lastY stays 700 across skips), so same paragraph.
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });

  it('should handle items with missing/null transform without throwing', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'missing transform', transform: undefined as any, height: 12 }, // y defaults to 0 -> new para (gap > threshold)
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 650], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'missing transform', 'Para 2']);
  });

  it('should handle items with missing/null transform within a line without throwing', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: null as any, transform: undefined as any, height: 12 }, // skipped due to no text
      { str: ' world', transform: [1, 0, 0, 1, 0, 693], height: 12 } // gap from lastY=700 is |700-693|=7 <= 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });

  it('should handle items with missing/null transform within a line (null text, defined transform)', () => {
    const items = [
      { str: 'First', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: null as any, transform: [1, 0, 0, 1, 0, 693], height: undefined as any }, // null text skipped; lastY stays 700
      { str: ' Second', transform: [1, 0, 0, 1, 0, 693], height: 12 } // gap |700-693|=7 <= 27 -> same para
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['First Second']);
  });
});

describe('parsePdfFromArrayBuffer - input guards', () => {
  it('should throw when buffer is not an ArrayBuffer', async () => {
    await expect(parsePdfFromArrayBuffer(null as any, 'test.pdf')).rejects.toThrow(/expected an ArrayBuffer/i);
    await expect(parsePdfFromArrayBuffer(undefined as any, 'test.pdf')).rejects.toThrow(/expected an ArrayBuffer/i);
    await expect(parsePdfFromArrayBuffer('not a buffer' as any, 'test.pdf')).rejects.toThrow(/expected an ArrayBuffer/i);
    await expect(parsePdfFromArrayBuffer(123 as any, 'test.pdf')).rejects.toThrow(/expected an ArrayBuffer/i);
  });

  it('should throw when buffer is empty (regression: zero-byte guard)', async () => {
    const emptyBuf = new ArrayBuffer(0);
    await expect(parsePdfFromArrayBuffer(emptyBuf, 'test.pdf')).rejects.toThrow(/empty/i);
  });

  it('should throw when url is not a string', async () => {
    const buf = new ArrayBuffer(16);
    // pdfjs will reject garbage bytes; we just need to confirm the guard fires first.
    await expect(parsePdfFromArrayBuffer(buf, null as any)).rejects.toThrow(/PDF URL must be/);
    await expect(parsePdfFromArrayBuffer(buf, undefined as any)).rejects.toThrow(/PDF URL must be/);
    await expect(parsePdfFromArrayBuffer(buf, 123 as any)).rejects.toThrow(/PDF URL must be/);
  });

  it('should throw when url is an empty string', async () => {
    const buf = new ArrayBuffer(16);
    // Guard should fire before pdfjs attempts to parse garbage.
    await expect(parsePdfFromArrayBuffer(buf, '')).rejects.toThrow(/PDF URL must be/);
    await expect(parsePdfFromArrayBuffer(buf, '   ')).rejects.toThrow(/PDF URL must be/);
  });

  it('should throw a descriptive error when PDF parsing fails', async () => {
    // Garbage bytes that pdfjs-dist will reject as invalid.
    const garbageBuf = new ArrayBuffer(8);
    const view = new Uint8Array(garbageBuf);
    view[0] = 0x48; view[1] = 0x49; view[2] = 0x58; // "HIX" — not a valid PDF header
    await expect(parsePdfFromArrayBuffer(garbageBuf, 'test.pdf')).rejects.toThrow(/invalid|corrupted/i);
  });
});

describe('createArticleFromPdf - input guards', () => {
  it('should wrap arrayBuffer() failures with a descriptive error', async () => {
    const failingFile = {
      name: 'broken.pdf',
      size: 1024,
      async arrayBuffer(): Promise<ArrayBuffer> {
        throw new DOMException('Read failed', 'InvalidStateError');
      },
    };
    await expect(createArticleFromPdf(failingFile as any)).rejects.toThrow(/Could not read PDF file/);
  });

  it('should reject an object missing a numeric size with a descriptive error', async () => {
    const badSizeFile = {
      name: 'no-size.pdf',
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    await expect(createArticleFromPdf(badSizeFile as any)).rejects.toThrow(/Invalid file object/);
  });

  it('should reject a File-like object with NaN size (regression: NaN > MAX_PDF_SIZE is false)', async () => {
    const nanSizeFile = {
      name: 'nan-size.pdf',
      get size() { return NaN; },
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    await expect(createArticleFromPdf(nanSizeFile as any)).rejects.toThrow(/Invalid file object/);
  });

  it('should reject a File-like object with negative size (regression: negative size slips past guard)', async () => {
    const negSizeFile = {
      name: 'neg-size.pdf',
      get size() { return -1; },
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    await expect(createArticleFromPdf(negSizeFile as any)).rejects.toThrow(/Invalid file object/);
  });

  it('should not crash on a plain non-File-like object (regression: missing arrayBuffer)', async () => {
    const noArrayBuf = { size: 100, name: 'x.pdf' };
    await expect(createArticleFromPdf(noArrayBuf as any)).rejects.toThrow(/Could not read PDF file/);
  });

  it('should surface the configured MAX_PDF_SIZE limit in the rejection message (regression: stale MB constant)', async () => {
    const oversizedFile = {
      name: 'huge.pdf',
      size: MAX_PDF_SIZE + 1,
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    const maxMb = Math.round(MAX_PDF_SIZE / 1_000_000);
    await expect(createArticleFromPdf(oversizedFile as any)).rejects.toThrow(new RegExp(`>${maxMb} MB`));
  });

  it('should reject a File-like object with Infinity size (regression: non-finite size slips past guard)', async () => {
    const infSizeFile = {
      name: 'inf-size.pdf',
      get size() { return Infinity; },
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    await expect(createArticleFromPdf(infSizeFile as any)).rejects.toThrow(/Invalid file object/);
  });

  it('should reject a File-like object with -Infinity size (regression: non-finite negative size slips past guard)', async () => {
    const negInfSizeFile = {
      name: 'neg-inf-size.pdf',
      get size() { return -Infinity; },
      arrayBuffer(): Promise<ArrayBuffer> { throw new Error('unreachable'); },
    };
    await expect(createArticleFromPdf(negInfSizeFile as any)).rejects.toThrow(/Invalid file object/);
  });
});

describe('parsePdfFromArrayBuffer - happy path integration', () => {
  const mock = vi.hoisted(() => ({
    getDocument: vi.fn(),
    GlobalWorkerOptions: {},
  }));

  beforeEach(() => {
    vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => mock);
  });

  function setupMockPdf(numPages: number, info: any, itemsPerPage: (pageNum: number) => Array<{ str: string; transform: number[]; height?: number }>) {
    const getPage = vi.fn((pageNum: number) => Promise.resolve({
      getTextContent: () => Promise.resolve({
        items: itemsPerPage(pageNum),
      }),
    }));

    mock.getDocument.mockReturnValue({ promise: Promise.resolve({
      numPages,
      info,
      getPage,
    })});
  }

  it('should produce a correct Article from valid PDF text items with metadata', async () => {
    setupMockPdf(1, { Title: 'Test Article', Author: 'Test Author' }, () => [
      { str: 'This is the first paragraph of the article.', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 650], height: 12 }, // empty -> skipped
      { str: 'This is the second paragraph with more content.', transform: [1, 0, 0, 1, 0, 640], height: 12 }
    ]);

    const buffer = new ArrayBuffer(1024); // non-empty valid buffer
    const result = await parsePdfFromArrayBuffer(buffer, 'test-article.pdf');

    expect(result).toBeDefined();
    expect(result.title).toBe('Test Article');
    expect(result.siteName).toBe('Test Author');
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toContain('This is the first paragraph');
    expect(result.paragraphs[1]).toContain('This is the second paragraph');
    expect(result.textContent).toContain('first paragraph');
    expect(result.textContent).toContain('second paragraph');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('should handle multiple pages correctly', async () => {
    setupMockPdf(2, {}, (pageNum: number) => [
      { str: `Page ${pageNum} content here.`, transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ]);

    const buffer = new ArrayBuffer(1024);
    const result = await parsePdfFromArrayBuffer(buffer, 'multi-page.pdf');

    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toContain('Page 1 content');
    expect(result.paragraphs[1]).toContain('Page 2 content');
  });

  it('should use filename as title when no metadata present', async () => {
    setupMockPdf(1, {}, () => [
      { str: 'Some content here for the article.', transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ]);

    const buffer = new ArrayBuffer(1024);
    const result = await parsePdfFromArrayBuffer(buffer, 'document-name.pdf');

    expect(result.title).toBe('document-name'); // filename without extension used as title
  });

  it('should decode UTF-16 BE Uint8Array-encoded metadata in pdf.info (regression: encoded title/author silently lost)', async () => {
    function encodeUtf16Be(s: string): Uint8Array {
      const bytes = new Uint8Array(2 + s.length * 2); // BOM + chars
      bytes[0] = 0xFE;
      bytes[1] = 0xFF;
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        bytes[2 + i * 2] = (code >> 8) & 0xff;
        bytes[2 + i * 2 + 1] = code & 0xff;
      }
      return bytes;
    }

    setupMockPdf(1, {
      Title: encodeUtf16Be('Encoded Article'),
      Author: encodeUtf16Be('Encoded Author'),
    }, () => [
      { str: 'Content paragraph here.', transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ]);

    const buffer = new ArrayBuffer(1024);
    const result = await parsePdfFromArrayBuffer(buffer, 'encoded.pdf');

    expect(result.title).toBe('Encoded Article');
    expect(result.siteName).toBe('Encoded Author');
    expect(result.paragraphs[0]).toContain('Content paragraph here.');
  });

  it('should degrade gracefully on malformed UTF-16 BE metadata (truncated BOM-less buffer, regression: truncated bytes produce garbage title)', async () => {
    function encodeUtf16Be(s: string): Uint8Array {
      const bytes = new Uint8Array(2 + s.length * 2);
      bytes[0] = 0xFE;
      bytes[1] = 0xFF;
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        bytes[2 + i * 2] = (code >> 8) & 0xff;
        bytes[2 + i * 2 + 1] = code & 0xff;
      }
      return bytes;
    }

    // Truncate the encoded title to fewer than 4 bytes (less than BOM+one-char) — decode should return '' not throw.
    const truncatedTitle = encodeUtf16Be('X').slice(0, 2); // only BOM, no actual chars → length < 4

    setupMockPdf(1, {
      Title: truncatedTitle,
      Author: encodeUtf16Be('Encoded Author'),
    }, () => [
      { str: 'Content paragraph here.', transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ]);

    const buffer = new ArrayBuffer(1024);
    await expect(parsePdfFromArrayBuffer(buffer, 'truncated.pdf')).resolves.toMatchObject({
      siteName: 'Encoded Author',
      paragraphs: expect.arrayContaining([expect.stringContaining('Content paragraph here.')]),
    });
  });

  it('should split a single long block into sentence-level paragraphs (regression: no fallback test)', async () => {
    // Single paragraph that passes MIN_PARAGRAPH_LENGTH on its own but is short enough
    // to trigger the sentence-splitting fallback when only one clean paragraph exists.
    const bigText = 'First sentence here with enough words to qualify today. Second sentence too has many good words in it now.';
    setupMockPdf(1, {}, () => [
      { str: bigText, transform: [1, 0, 0, 1, 0, 700], height: 12 },
    ]);

    const buffer = new ArrayBuffer(1024);
    const result = await parsePdfFromArrayBuffer(buffer, 'single-block.pdf');

    expect(result.paragraphs.length).toBeGreaterThan(1);
    for (const p of result.paragraphs) {
      expect(p.trim().length).toBeGreaterThanOrEqual(MIN_PARAGRAPH_LENGTH);
    }
    expect(result.paragraphs.join(' ')).toContain('First sentence');
    expect(result.paragraphs.join(' ')).toContain('Second sentence');
  });

  it('should use metadata.toJSON() as fallback for title/author when info is absent (regression: metadata.toJSON path untested)', async () => {
    setupMockPdf(1, {}, (pageNum: number) => [
      { str: 'Metadata from JSON test content.', transform: [1, 0, 0, 1, 0, 700], height: 12 },
    ]);

    // Patch the mock to add metadata.toJSON() on the returned pdf object.
    const originalGetDocument = mock.getDocument;
    mock.getDocument.mockImplementation((_params: any) => {
      const pdfObj = {
        numPages: 1,
        info: {},
        getPage: (_pageNum: number) => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: [{ str: 'Metadata from JSON test content.', transform: [1, 0, 0, 1, 0, 700], height: 12 }] }),
        }),
        metadata: {
          toJSON() { return { title: 'JSON Title', author: 'JSON Author' }; },
        },
      } as any;
      return { promise: Promise.resolve(pdfObj) };
    });

    const buffer = new ArrayBuffer(1024);
    const result = await parsePdfFromArrayBuffer(buffer, 'json-meta.pdf');

    expect(result.title).toBe('JSON Title');
    expect(result.siteName).toBe('JSON Author');
    expect(result.paragraphs[0]).toContain('Metadata from JSON test content.');
  });

  it('should produce an Article through createArticleFromPdf when given a valid file-like object (regression: createArticleFromPdf happy path untested)', async () => {
    setupMockPdf(1, { Title: 'File Article', Author: 'File Author' }, () => [
      { str: 'First paragraph of the article.', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Second paragraph here with more content.', transform: [1, 0, 0, 1, 0, 650], height: 12 },
    ]);

    const buffer = new ArrayBuffer(1024);
    const fileObj = {
      name: 'file-article.pdf',
      size: 512,
      async arrayBuffer() { return buffer; },
    };

    const result = await createArticleFromPdf(fileObj as any);

    expect(result.title).toBe('File Article');
    expect(result.siteName).toBe('File Author');
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toContain('First paragraph');
    expect(result.paragraphs[1]).toContain('Second paragraph');
  });

  it('should accept a file at exactly MAX_PDF_SIZE boundary without throwing on size guard (regression: boundary not verified)', async () => {
    setupMockPdf(1, {}, () => [
      { str: 'Boundary test content paragraph.', transform: [1, 0, 0, 1, 0, 700], height: 12 },
    ]);

    const buffer = new ArrayBuffer(64);
    const boundaryFile = {
      name: 'boundary.pdf',
      size: MAX_PDF_SIZE,
      async arrayBuffer() { return buffer; },
    };

    await expect(createArticleFromPdf(boundaryFile as any)).resolves.toBeDefined();
  });
});
