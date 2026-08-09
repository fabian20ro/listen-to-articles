import type { Article } from './extractor.js';

const LAST_ARTICLE_KEY = 'article-reader-last-article';

export interface LastSessionData {
  article: Article;
  savedAt: number;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity;
}

function isValidArticleShape(value: unknown): value is Article {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.title === 'string' &&
    typeof a.content === 'string' &&
    typeof a.textContent === 'string' &&
    typeof a.markdown === 'string' &&
    Array.isArray(a.paragraphs) && a.paragraphs.every((paragraph) => typeof paragraph === 'string') &&
    typeof a.lang === 'string' &&
    typeof a.htmlLang === 'string' &&
    typeof a.siteName === 'string' &&
    typeof a.excerpt === 'string' &&
    typeof a.wordCount === 'number' &&
    typeof a.estimatedMinutes === 'number' &&
    typeof a.resolvedUrl === 'string'
  );
}

export function saveLastArticle(article: Article): void {
  const payload: LastSessionData = {
    article,
    savedAt: Date.now(),
  };
  const json = JSON.stringify(payload);
  localStorage.setItem(LAST_ARTICLE_KEY, json);
}

export function loadLastArticle(): LastSessionData | null {
  try {
    const raw = localStorage.getItem(LAST_ARTICLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSessionData>;
    const savedAt = parsed.savedAt;
    if (!parsed || !isFiniteTimestamp(savedAt) || !isValidArticleShape(parsed.article)) {
      localStorage.removeItem(LAST_ARTICLE_KEY);
      return null;
    }
    return { article: parsed.article, savedAt };
  } catch {
    localStorage.removeItem(LAST_ARTICLE_KEY);
    return null;
  }
}

export function clearLastArticle(): void {
  try {
    localStorage.removeItem(LAST_ARTICLE_KEY);
  } catch {
    // Storage unavailable — nothing to remove.
  }
}
