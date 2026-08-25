import { type Article, MIN_PARAGRAPH_LENGTH, MAX_PDF_SIZE } from './types.js';
import { buildArticleFromParagraphs } from './utils.js';

export interface PdfJsTextItem {
  str: string;
  transform: number[];
  height?: number;
}

/** Detect paragraph boundaries from PDF text items using vertical position gaps. */
export function extractParagraphsFromTextItems(items: PdfJsTextItem[]): string[] {
  if (!items || items.length === 0) return [];

  const paragraphs: string[] = [];
  let currentParagraph = '';
  let lastY: number | null = null;
  let lastHeight = 0;

  for (const item of items) {
    const rawStr = typeof item.str === 'string' ? item.str : '';
    const text = rawStr.trim();
    if (!text) continue;

    const transform = Array.isArray(item.transform) && item.transform.length >= 6 ? item.transform : null;
    const y = transform ? transform[5] : 0;
    const height = (item.height != null && item.height > 0) ? item.height : 12;

    if (lastY !== null) {
      const gap = Math.abs(lastY - y);
      const lineSpacing = lastHeight * 1.5;

      if (gap > lineSpacing * 1.5) {
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
        }
        currentParagraph = text;
      } else {
        const trimmed = currentParagraph.trimEnd();
        if (trimmed.endsWith('-')) {
          // Handle hyphenated line breaks: strip trailing `-` and any whitespace around it, then join.
          currentParagraph = trimmed.slice(0, -1).trimEnd() + ' ' + text;
        } else {
          currentParagraph += (currentParagraph ? ' ' : '') + text;
        }
      }
    } else {
      currentParagraph = text;
    }

    lastY = y;
    lastHeight = height;
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs;
}

/** Create an Article from a local PDF file. */
export async function createArticleFromPdf(
  file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('Invalid file object: size must be a non-negative finite number.');
  }

  const maxMb = Math.round(MAX_PDF_SIZE / 1_000_000);
  if (file.size > MAX_PDF_SIZE) {
    throw new Error(`PDF is too large (>${maxMb} MB). Please use a smaller file.`);
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (readErr) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    throw new Error(`Could not read PDF file: ${msg}`);
  }

  return parsePdfFromArrayBuffer(buffer, file.name, onProgress);
}

/** Parse PDF metadata (title/author) from the document Info dictionary. */
function extractDocumentMetadata(pdf: any): { title?: string; author?: string } {
  try {
    // pdfjs v1.x exposes .info.Title/.Author as strings.
    // Some builds omit the info dict entirely; create it so decoded
    // metadata values are not written to a detached object and lost.
    const info = pdf.info ?? (pdf.info = {});
    let metadataJson: Record<string, unknown> | undefined;
    if (pdf.metadata?.toJSON) {
      try {
        metadataJson = pdf.metadata.toJSON();
      } catch { /* ignore */ }
    }

    function decode(value: unknown): string {
      if (typeof value === 'string') return value.trim();
      if (value instanceof Uint8Array && value.length >= 4) {
        // PDF strings are UTF-16 BE, sometimes prefixed with BOM.
        const bytes = new Uint8Array(value.buffer, value.byteOffset + 2, Math.max(0, value.length - 2));
        let s = '';
        for (let i = 0; i < bytes.length; i += 2) {
          if (i + 1 >= bytes.length) break; // skip partial trailing byte to avoid garbage chars
          s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        }
        return s.replace(/\u0000/g, '').trim();
      }
      if (Array.isArray(value)) {
        // pdfjs can return title/author as arrays of strings or nested objects.
        const joined = value.map((v) => decode(v)).join(' ').trim();
        return joined;
      }
      return '';
    }

    const title = decode(info.Title ?? metadataJson?.title);
    const author = decode(info.Author ?? metadataJson?.author);
    if (title) info.Title = title; // normalize so callers below use a single path
    if (author) info.Author = author;
  } catch { /* ignore extraction errors */ }

  return {
    title: typeof pdf.info?.Title === 'string' ? pdf.info.Title : undefined,
    author: typeof pdf.info?.Author === 'string' ? pdf.info.Author : undefined,
  };
}

/** Parse a PDF buffer into an Article. */
export async function parsePdfFromArrayBuffer(
  buffer: ArrayBuffer,
  url: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError(
      'Invalid input: expected an ArrayBuffer.',
    );
  }

  if (buffer.byteLength === 0) {
    throw new Error('Could not load PDF: file is empty.');
  }

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('PDF URL must be a non-empty string.');
  }

  onProgress?.('Loading PDF...');
  
  let pdfjs: any;
  try {
    pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  } catch (importErr) {
    const msg = importErr instanceof Error ? importErr.message : String(importErr);
    throw new Error(`Could not load PDF rendering library: ${msg}`);
  }
  
  // In a real environment, the worker would be hosted. 
  // For local/service worker, we use an empty string or the same url.
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  let pdf: any;
  try {
    const loadingTask = pdfjs.getDocument({
      data: buffer,
      // Avoid issues with some PDF versions by specifying version if needed
      // but usually it's auto-detected.
    });
    pdf = await loadingTask.promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid or corrupted PDF file: ${message}`);
  }
  const numPages = pdf.numPages;
  const allParagraphs: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(`Parsing page ${i}/${numPages}...`);
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const paragraphs = extractParagraphsFromTextItems(textContent.items);
    allParagraphs.push(...paragraphs);
  }

  // Clean up paragraphs (remove empty ones and sub-threshold noise like headers/page-numbers).
  const cleanParagraphs = allParagraphs.filter(
    p => p.trim().length >= MIN_PARAGRAPH_LENGTH,
  );

  if (cleanParagraphs.length === 0) {
    throw new Error('Could not extract text from PDF');
  }

  // Fallback for single paragraph that might be too short OR a single long block.
  let finalParagraphs = cleanParagraphs;
  if (cleanParagraphs.length === 1) {
    if (cleanParagraphs[0].trim().length < MIN_PARAGRAPH_LENGTH) {
      throw new Error('PDF content too short to be meaningful');
    } else {
      // Fallback: split single long block into sentences to improve readability.
      const splitParagraphs = cleanParagraphs[0]
        .split(/\. (?=[A-Z])/)
        .filter((s) => s.trim().length >= MIN_PARAGRAPH_LENGTH);
      if (splitParagraphs.length > 0) {
        finalParagraphs = splitParagraphs;
      } else {
        // Sentence splitting produced nothing usable — keep the original block.
        finalParagraphs = cleanParagraphs;
      }
    }
  }

  // Extract document-level metadata (title, author) when available.
  const meta = extractDocumentMetadata(pdf);

  // Default title from filename.
  let title = url.includes('/')
    ? url.split('/').pop()?.replace(/\.[^/.]+$/, "") || 'PDF Document'
    : url.replace(/\.[^/.]+$/, "");
  let siteName = 'PDF';

  if (meta.title) title = meta.title;
  if (meta.author) siteName = meta.author;

  return buildArticleFromParagraphs(finalParagraphs, title, siteName, finalParagraphs.join('\n\n'));
}
