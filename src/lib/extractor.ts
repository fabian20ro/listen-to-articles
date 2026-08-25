/**
 * Article extraction — barrel file.
 *
 * Re-exports all public APIs from the per-format extraction modules.
 * Consumers import from './extractor.js' and never need to know about the
 * internal module split.
 */

// Types & shared constants
export type { Article } from './extractors/types.js';
export { IMAGE_MD_RE, IMAGE_HTML_RE } from './extractors/types.js';

// Shared constants & utilities (re-exported for consumer/test use)
export { MIN_PARAGRAPH_LENGTH } from './extractors/types.js';
export { splitTextBySentences } from './extractors/utils.js';

// URL fetch orchestration (detects format and dispatches to the right parser)
export {
  extractArticle,
  extractArticleFromPdfUrl,
  extractArticleFromEpubUrl,
} from './extractors/extract-url.js';

export { extractArticleFromYoutube, extractYoutubeVideoId } from './extractors/extract-youtube.js';

// HTML parsing
export { parseArticleFromHtml, sanitizeRenderedHtml } from './extractors/extract-html.js';

// PDF
export {
  createArticleFromPdf,
  extractParagraphsFromTextItems,
} from './extractors/extract-pdf.js';

// EPUB
export {
  createArticleFromEpub,
  parseEpubFromArrayBuffer,
} from './extractors/extract-epub.js';

// Plain text & Markdown files
export {
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromMarkdownFile,
} from './extractors/extract-text.js';
