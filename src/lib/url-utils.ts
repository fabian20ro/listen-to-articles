/**
 * URL validation and share target parameter parsing.
 */

/** Extract the article URL from the current page's query parameters. */
export function getUrlFromParams(): string | null {
  const params = new URLSearchParams(window.location.search);

  // Share Target sends ?url=...  Some apps put the URL in ?text=, ?title=, or ?targetUrl= instead.
  const candidates = [params.get('url'), params.get('text'), params.get('title'), params.get('link'), params.get('u'), params.get('targetUrl')];
  for (const raw of candidates) {
    if (!raw) continue;
    const url = extractUrl(raw);
    if (url) return url;
  }
  return null;
}

/** Try to pull a valid http(s) URL out of an arbitrary string.
 *
 * Extracts URLs at the start or end of the text (share-text formats like
 * "https://... Read this" or "Article Title\nhttps://...").  If the URL is
 * embedded in the middle of long text, returns null so the caller can treat
 * the input as pasted article content.
 */
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();

  // Direct URL: a single token with no whitespace. new URL() would silently
  // percent-encode embedded spaces/newlines, so a multi-token string is not
  // a direct URL and falls through to the start/end extraction below.
  if (!/\s/.test(trimmed) && isValidArticleUrl(trimmed)) return trimmed;

  // URL at the end of the text with a description prefix (≤ 500 chars).
  // Covers the common share-text pattern: "Article Title\nhttps://..."
  // as well as longer social-media shares (tweets, post snippets, etc.).
  const endMatch = trimmed.match(/(?:https?:\/\/|\/\/)[^\s"'<>]+$/i);
  if (endMatch && isValidArticleUrl(endMatch[0])) {
    const prefix = trimmed.slice(0, endMatch.index!).trim();
    if (prefix.length <= 500) {
      let url = endMatch[0];
      // Strip trailing punctuation that might have been caught
      url = url.replace(/[.,!?;:()\[\]{},<>]+$/, '');
      if (isValidArticleUrl(url)) return url;
    }
  }

  // URL at the start of the text with a description suffix (≤ 500 chars).
  // Covers the common share-text pattern: "https://...\nRead this"
  const startMatch = trimmed.match(/^(?:https?:\/\/|\/\/)[^\s"'<>]+/i);
  if (startMatch && isValidArticleUrl(startMatch[0])) {
    const suffix = trimmed.slice(startMatch[0].length).trim();
    if (suffix.length <= 500) {
      let url = startMatch[0];
      // Strip trailing punctuation that might have been caught
      url = url.replace(/[.,!?;:()\[\]{},<>]+$/, '');
      if (isValidArticleUrl(url)) return url;
    }
  }

  return null;
}

/** Basic validation: must be http or https and have a hostname with a dot. */
export function isValidArticleUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/** Clear share-target query params from the URL bar without a reload. */
export function clearQueryParams(): void {
  if (window.location.search) {
    const clean = window.location.pathname;
    window.history.replaceState(null, '', clean);
  }
}
