import JSZip from 'jszip';
import { type Article, MAX_PDF_SIZE } from './types.js';
import { buildArticleFromParagraphs, stripNonTextContent, isSpeakableText } from './utils.js';

// ── JSZip types ───────────────────────────────────────────────────────

type JSZipInstance = {
  files: Record<string, { async(type: 'string'): Promise<string>; async(type: 'arraybuffer'): Promise<ArrayBuffer> }>;
  loadAsync(data: ArrayBuffer): Promise<JSZipInstance>;
  file(name: string): { async(type: 'string'): Promise<string> } | null;
};

/**
 * Core EPUB parsing: unzips buffer, reads OPF, extracts chapters → Article.
 */
async function parseEpubCore(
  buffer: ArrayBuffer,
  titleFallback: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
  onProgress?: (message: string) => void,
): Promise<Article> {
  onProgress?.('Loading EPUB...');

  const zip = await new JSZip().loadAsync(buffer);

  // Parse container.xml to find the OPF file
  const containerXml = await readZipFile(zip as unknown as JSZipInstance, 'META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing container.xml');
  }

  const opfPath = extractOpfPath(containerXml);
  if (!opfPath) {
    throw new Error('Invalid EPUB: cannot find content.opf path');
  }

  const opfContent = await readZipFile(zip as unknown as JSZipInstance, opfPath);
  if (!opfContent) {
    throw new Error('Invalid EPUB: cannot read content.opf');
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const { title: epubTitle, chapterPaths } = parseOpf(opfContent, opfDir, DOMParserConstructor);

  if (chapterPaths.length === 0) {
    throw new Error('Could not find any chapters in this EPUB.');
  }

  onProgress?.(`Processing ${chapterPaths.length} chapters...`);

  // Guard against zip bombs: limit total extracted text to 50 MB
  const MAX_EXTRACTED_BYTES = 50_000_000;
  let totalExtracted = 0;

  const allParagraphs: string[] = [];
  for (let i = 0; i < chapterPaths.length; i++) {
    if (chapterPaths.length > 5 && i % 3 === 0) {
      onProgress?.(`Processing chapter ${i + 1} of ${chapterPaths.length}...`);
    }
    const html = await readZipFile(zip as unknown as JSZipInstance, chapterPaths[i]);
    if (!html) continue;

    totalExtracted += html.length;
    if (totalExtracted > MAX_EXTRACTED_BYTES) {
      throw new Error('EPUB content is too large after decompression. The file may be corrupted.');
    }

    const chapterParagraphs = extractTextFromXhtml(html, DOMParserConstructor);
    allParagraphs.push(...chapterParagraphs);
  }

  // Headings (## Title) bypass the length and speakability filters —
  // they may be short but are important for chapter navigation.
  const isHeading = (p: string) => /^#{2,4}\s/.test(p);
  const paragraphs = allParagraphs
    .map((p) => (isHeading(p) ? p : stripNonTextContent(p)))
    .filter((p) => isHeading(p) || (p.length >= 20 && isSpeakableText(p)));

  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable text from this EPUB.');
  }

  const title = epubTitle || titleFallback || 'EPUB Document';
  return buildArticleFromParagraphs(paragraphs, title, 'EPUB', paragraphs.join('\n\n'));
}

/**
 * Create an Article from a local EPUB file.
 */
export async function createArticleFromEpub(
  file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (file.size > MAX_PDF_SIZE) {
    throw new Error('EPUB is too large (>10 MB). Please use a smaller file.');
  }

  const buffer = await file.arrayBuffer();
  return parseEpubCore(buffer, file.name.replace(/\.epub$/i, ''), DOMParserConstructor, onProgress);
}

/**
 * Create an Article from an EPUB ArrayBuffer fetched from a URL.
 */
export async function parseEpubFromArrayBuffer(
  buffer: ArrayBuffer,
  sourceUrl: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
  onProgress?: (message: string) => void,
): Promise<Article> {
  // Derive a fallback title from the URL filename
  let titleFallback = '';
  try {
    const pathname = new URL(sourceUrl).pathname;
    const filename = pathname.split('/').pop() || '';
    titleFallback = filename.replace(/\.epub(?:\.\w+)?$/i, '');
  } catch { /* ignore invalid URLs */ }

  const article = await parseEpubCore(buffer, titleFallback, DOMParserConstructor, onProgress);
  article.resolvedUrl = sourceUrl;
  return article;
}

/** Read a file from a JSZip instance, trying both exact path and case-insensitive match. */
async function readZipFile(zip: JSZipInstance, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (entry) return entry.async('string');

  // Case-insensitive fallback
  const lowerPath = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lowerPath) {
      return zip.files[name].async('string');
    }
  }
  return null;
}

/** Extract the OPF file path from container.xml with bounds and character validation. */
export function extractOpfPath(containerXml: string): string | null {
  const match = containerXml.match(/full-path\s*=\s*"([^"]{1,512})"/);
  if (!match) return null;
  const path = match[1];
  // Only allow safe path characters
  if (!/^[\w/.\-]+$/.test(path)) return null;
  return path;
}

/** Sanitize a ZIP-internal href from OPF manifest to prevent path traversal. */
export function sanitizeHref(href: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    return '';
  }
  decoded = decoded.replace(/\\/g, '/');
  const parts = decoded.split('/').filter(Boolean);
  const safe: string[] = [];
  for (const part of parts) {
    if (part === '..') safe.pop();
    else if (part !== '.') safe.push(part);
  }
  return safe.join('/');
}

/** Parse OPF (Open Packaging Format) to get title and ordered chapter paths. */
function parseOpf(
  opfXml: string,
  opfDir: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
): { title: string; chapterPaths: string[] } {
  const doc = new DOMParserConstructor().parseFromString(opfXml, 'application/xml');

  // Extract title from <dc:title>
  const titleEl = doc.querySelector('title');
  const title = titleEl?.textContent?.trim() || '';

  // Build manifest id→{href, mediaType} map
  const manifest = new Map<string, { href: string; mediaType: string }>();
  doc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  });

  // Get spine order (reading order)
  const chapterPaths: string[] = [];
  doc.querySelectorAll('spine > itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref') || '';
    const entry = manifest.get(idref);
    if (entry) {
      // Only include XHTML/HTML content documents
      if (entry.mediaType.includes('html') || entry.mediaType.includes('xml') || entry.mediaType.includes('xhtml')) {
        chapterPaths.push(opfDir + sanitizeHref(entry.href));
      }
    }
  });

  return { title, chapterPaths };
}

/** Extract readable text paragraphs from an XHTML chapter. */
function extractTextFromXhtml(
  html: string,
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document },
): string[] {
  const doc = new DOMParserConstructor().parseFromString(html, 'text/html');

  // Remove non-content elements
  doc.querySelectorAll('script, style, nav, head, meta, link').forEach((el) => el.remove());

  const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, div';
  const paragraphs: string[] = [];

  // Extract text from block-level elements
  const blocks = doc.querySelectorAll(BLOCK_SELECTOR);
  if (blocks.length > 0) {
    blocks.forEach((block) => {
      const tag = block.tagName.toLowerCase();
      // A block containing nested blocks gets its children extracted separately;
      // take only direct text nodes so nested content is not duplicated.
      const text = block.querySelector(BLOCK_SELECTOR)
        ? Array.from(block.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim()
        : block.textContent?.trim();
      if (!text || text.length === 0) return;
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const hashes = '#'.repeat(Math.min(Math.max(level, 2), 4));
        paragraphs.push(`${hashes} ${text}`);
      } else {
        paragraphs.push(text);
      }
    });
  } else {
    // Fallback: get all body text
    const bodyText = doc.body?.textContent?.trim();
    if (bodyText) {
      paragraphs.push(...bodyText.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean));
    }
  }

  return paragraphs;
}
