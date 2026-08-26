/**
 * Language detection for TTS voice selection and translation decisions.
 *
 * - detectLanguage(): text-based EN/RO detection for TTS (unchanged)
 * - detectLangFromHtml(): normalizes <html lang="..."> attribute
 * - detectLangFromUrl(): maps URL TLDs to language codes
 * - needsTranslation(): decides if article should be translated to English
 * - getSourceLang(): best-guess source language code for the translation API
 */

export type { Language } from './language-config.js';
import { SUPPORTED_LANGUAGES, type Language } from './language-config.js';

const RO_CHARS = /[ăâîșțĂÂÎȘȚ]/g;
const RO_WORDS = [
  'și', 'este', 'care', 'pentru', 'într', 'sunt',
  'acest', 'poate', 'prin', 'doar', 'mai', 'sau',
  'fost', 'avea', 'acesta', 'despre', 'când', 'toate',
  'numai', 'după', 'foarte', 'acum', 'unde', 'că', 'de', 'un', 'o', 'la', 'cu',
  // Additional common Romanian stop words for better coverage
  'aceasta', 'așa', 'cum', 'dar', 'dintr', 'din',
  'era', 'fără', 'între', 'lângă', 'mulți', 'multe',
  'ne', 'niște', 'pe', 'se', 'trecut', 'totuși', 'trebuie',
  // High-frequency function words missing from baseline coverage
  'iar', 'însă'
];

/**
 * Detect whether `text` is Romanian or English.
 * Examines the first ~1 000 characters for Romanian-specific indicators.
 */
export function detectLanguage(text: string): Language {
  const sample = text.slice(0, 1000).toLowerCase();

  // Count Romanian diacritics
  const roCharMatches = sample.match(RO_CHARS);
  const roCharCount = roCharMatches ? roCharMatches.length : 0;

  // Count Romanian common words
  const roWordCount = RO_WORDS.filter((w) => {
    // Match whole word or prefix (diacritics don't work with \b)
    const re = new RegExp(`(?:^|\\s)${w}(?=[\\s.,!?;:]|$)`, 'i');
    return re.test(sample);
  }).length;

  if (roCharCount > 3 || roWordCount > 2) return 'ro';
  return 'en';
}

// ── HTML lang attribute detection ────────────────────────────────────

/**
 * BCP 47 special registrations that carry no language information
 * ("und" = undetermined, "mis" = miscellaneous, "zxx" = no content).
 * Real pages emit lang="und" for machine-generated or mixed content;
 * treating them as a known language would force translation decisions
 * before cheaper signals (URL TLD, text) get a chance.
 */
const NO_LANG_CODES = new Set(['und', 'mis', 'zxx']);

/**
 * Normalize an HTML lang attribute value to a base language code.
 * e.g. "de-DE" → "de", "en-US" → "en", "" → ""
 * BCP 47 no-language codes ("und", "mis", "zxx") normalize to "" so
 * callers fall through to the next signal instead of forcing a decision.
 */
export function detectLangFromHtml(htmlLang: string): string {
  if (!htmlLang) return '';
  const code = htmlLang.trim().split(/[-_]/)[0].toLowerCase();
  return NO_LANG_CODES.has(code) ? '' : code;
}

// ── URL TLD → language mapping ───────────────────────────────────────

const TLD_LANG_MAP: Record<string, string> = {
  de: 'de', fr: 'fr', es: 'es', it: 'it', nl: 'nl', pt: 'pt',
  ru: 'ru', jp: 'ja', cn: 'zh', kr: 'ko', pl: 'pl', cz: 'cs',
  ro: 'ro', at: 'de', ch: 'de', be: 'nl', dk: 'da', se: 'sv',
  no: 'no', fi: 'fi', hu: 'hu', gr: 'el', tr: 'tr', ua: 'uk',
  bg: 'bg', hr: 'hr', sk: 'sk', si: 'sl', rs: 'sr', me: 'sr', mk: 'mk',
  lt: 'lt', lv: 'lv', ee: 'et',
  uk: 'en', us: 'en', au: 'en', ca: 'en', nz: 'en', ie: 'en',
};

/** Known generic TLDs that don't indicate a language. */
const GENERIC_TLDS = new Set(['com', 'org', 'net', 'io', 'dev', 'app', 'info', 'biz', 'co']);

/**
 * Detect language from a URL's top-level domain.
 * Returns a language code (e.g. "de") or "" if unknown.
 */
export function detectLangFromUrl(url: string): string {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    // Try the last part (TLD), e.g. "web.de" → "de"
    const tld = parts[parts.length - 1];
    if (GENERIC_TLDS.has(tld)) return '';
    return TLD_LANG_MAP[tld] || '';
  } catch {
    return '';
  }
}

// ── Translation decision ─────────────────────────────────────────────

const SUPPORTED_SET = new Set<string>(SUPPORTED_LANGUAGES);

/**
 * Determine if an article needs translation to English.
 *
 * Checks htmlLang, URL TLD, and text-based detection in priority order.
 * Per user requirement: if language can't be determined, assume it's NOT
 * English and return true (needs translation).
 */
export function needsTranslation(htmlLang: string, url: string, textLang?: Language): boolean {
  // 1. Check HTML lang attribute (most reliable signal)
  const fromHtml = detectLangFromHtml(htmlLang);
  if (fromHtml && SUPPORTED_SET.has(fromHtml)) return false;
  if (fromHtml) return true; // known non-EN/RO language

  // 2. Check URL TLD
  const fromUrl = detectLangFromUrl(url);
  if (fromUrl && SUPPORTED_SET.has(fromUrl)) return false;
  if (fromUrl) return true; // known non-EN/RO language

  // 3. Check text-based detection.
  // Trust the heuristic when we already have no stronger signal from HTML/URL.
  // English here means the article is already in the target language.
  if (textLang === 'ro' || textLang === 'en') return false;

  // 4. Default: assume it's not English → needs translation
  return true;
}

/**
 * Return the best-guess source language code for the translation API.
 * Falls back to 'auto' if unknown.
 */
export function getSourceLang(htmlLang: string, url: string): string {
  const fromHtml = detectLangFromHtml(htmlLang);
  if (fromHtml) return fromHtml;

  const fromUrl = detectLangFromUrl(url);
  if (fromUrl) return fromUrl;

  return 'auto';
}
