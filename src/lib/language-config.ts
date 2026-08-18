/**
 * Centralized language configuration — single source of truth for
 * supported languages, TTS voice codes, and language validation.
 *
 * Adding a new language: add it to SUPPORTED_LANGUAGES and LANG_TTS_CODES.
 */

export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Maps Language → BCP-47 code used by TTS voices and speechSynthesis. */
export const LANG_TTS_CODES: Record<Language, string> = {
  en: 'en-US',
  ro: 'ro',
};

/** Shorter code for translation/audio APIs (no region subtag). */
export function langToCode(lang: Language): string {
  const ttsCode = LANG_TTS_CODES[lang];
  return ttsCode ? ttsCode.split('-')[0] : 'en';
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && SUPPORTED_LANGUAGES.includes(v as Language);
}

/** First supported language — used as default for new sessions. */
export const DEFAULT_LANGUAGE: Language = SUPPORTED_LANGUAGES[0];

/** Default target language for translations — mirrors DEFAULT_LANGUAGE so it stays in sync. */
export const DEFAULT_TRANSLATION_TARGET: Language = DEFAULT_LANGUAGE;
