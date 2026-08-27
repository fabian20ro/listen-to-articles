import { describe, it, expect } from 'vitest';
import type { Language } from '../lib/language-config.js';
import {
  SUPPORTED_LANGUAGES,
  LANG_TTS_CODES,
  langToCode,
  isLanguage,
  DEFAULT_LANGUAGE,
  DEFAULT_TRANSLATION_TARGET,
} from '../lib/language-config.js';

// ── SUPPORTED_LANGUAGES ─────────────────────────────────────────────

describe('SUPPORTED_LANGUAGES', () => {
  it('contains English and Romanian', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('ro');
  });

  it('every supported language has TTS code and langToCode entry', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANG_TTS_CODES[lang], `TTS code missing for ${lang}`).toBeDefined();
      const code = langToCode(lang);
      expect(typeof code, `langToCode(${lang})`).toBe('string');
      expect(code.length > 0, `langToCode(${lang})`).toBeTruthy();
    }
  });
});

// ── DEFAULT_LANGUAGE ────────────────────────────────────────────────

describe('DEFAULT_LANGUAGE', () => {
  it('equals the first supported language', () => {
    expect(DEFAULT_LANGUAGE).toBe(SUPPORTED_LANGUAGES[0]);
  });

  it('is a valid supported language', () => {
    expect(isLanguage(DEFAULT_LANGUAGE)).toBe(true);
  });

  // Pin the concrete default: new sessions must start in English even if
  // SUPPORTED_LANGUAGES is reordered (the mirror test above cannot catch that).
  it('defaults to English', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
  });
});

// ── LANG_TTS_CODES ──────────────────────────────────────────────────

describe('LANG_TTS_CODES', () => {
  it('maps English to en-US', () => {
    expect(LANG_TTS_CODES.en).toBe('en-US');
  });

  it('maps Romanian to ro', () => {
    expect(LANG_TTS_CODES.ro).toBe('ro');
  });

  it('has an entry for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANG_TTS_CODES[lang]).toBeDefined();
    }
  });
});

// ── langToCode ──────────────────────────────────────────────────────

describe('langToCode', () => {
  it('returns "en" for English', () => {
    expect(langToCode('en')).toBe('en');
  });

  it('returns "ro" for Romanian', () => {
    expect(langToCode('ro')).toBe('ro');
  });

  // Regression: silent fallback must not change when new languages are added.
  it('falls back to "en" for any unsupported language', () => {
    expect(langToCode('fr' as Language)).toBe('en');
    expect(langToCode('de' as Language)).toBe('en');
  });

  // Dynamic guard: every supported language must yield a defined code, even
  // after SUPPORTED_LANGUAGES grows. This catches missing langToCode cases.
  it('returns a non-empty code for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const code = langToCode(lang);
      expect(typeof code, `langToCode(${lang})`).toBe('string');
      expect(code.length > 0, `langToCode(${lang})`).toBeTruthy();
    }
  });

  // Normalization: langToCode does not normalize BCP-47 subtags; it falls through
  // to the en default for any input other than an explicit 'ro'.
  it('falls back to "en" for region-tagged codes', () => {
    expect(langToCode('en-US' as Language)).toBe('en');
    expect(langToCode('ro-RO' as Language)).toBe('en');
  });

  // Regression: langToCode must never throw or return undefined when handed a
  // Language-like string that is not explicitly 'ro'; it always returns 'en'.
  // This protects callers who pass arbitrary language codes to TTS endpoints.
  for (const fallback of ['ja', 'zh-CN', 'pt-BR', '', 'EN'] as const) {
    it(`falls back to "en" when given ${JSON.stringify(fallback)}`, () => {
      expect(langToCode(fallback as Language)).toBe('en');
    });
  }

  // Edge case: langToCode must handle numeric strings gracefully without throwing.
  it('returns "en" for numeric string input', () => {
    expect(langToCode('123' as Language)).toBe('en');
  });

  // Edge case: langToCode must handle whitespace-only strings without throwing.
  it('returns "en" for whitespace-only string input', () => {
    expect(langToCode('   ' as Language)).toBe('en');
  });
});

// ── isLanguage ──────────────────────────────────────────────────────

describe('isLanguage', () => {
  it('returns true for "en"', () => {
    expect(isLanguage('en')).toBe(true);
  });

  it('returns true for "ro"', () => {
    expect(isLanguage('ro')).toBe(true);
  });

  it('returns false for unsupported language codes', () => {
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage('ja')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
    expect(isLanguage(123)).toBe(false);
    expect(isLanguage(true)).toBe(false);
    expect(isLanguage({})).toBe(false);
    expect(isLanguage([])).toBe(false);
    expect(isLanguage(Symbol('lang'))).toBe(false);
    expect(isLanguage(new Date())).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLanguage('')).toBe(false);
  });

  it('returns false for region-tagged codes (e.g. "en-US")', () => {
    expect(isLanguage('en-US')).toBe(false);
    expect(isLanguage('ro-RO')).toBe(false);
  });
});

// ── DEFAULT_TRANSLATION_TARGET ──────────────────────────────────────

describe('DEFAULT_TRANSLATION_TARGET', () => {
  // Structural contract: translation target mirrors default source language.
  // If SUPPORTED_LANGUAGES[0] changes, both must update together — no drift.
  it('matches DEFAULT_LANGUAGE (first supported language)', () => {
    expect(DEFAULT_TRANSLATION_TARGET).toBe(DEFAULT_LANGUAGE);
  });

  it('is a supported language', () => {
    expect(isLanguage(DEFAULT_TRANSLATION_TARGET)).toBe(true);
  });
});

// ── LANG_TTS_CODES maintenance contract ───────────────────────────────

describe('LANG_TTS_CODES maintenance contract', () => {
  // Forward: every supported language must have a TTS code.
  it('has an entry for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANG_TTS_CODES[lang]).toBeDefined();
    }
  });

  // Backward: no orphan keys — every LANG_TTS_CODES key must be a supported language.
  it('every TTS code entry maps to a supported language', () => {
    const ttsKeys = Object.keys(LANG_TTS_CODES) as Language[];
    const orphans = ttsKeys.filter((lang) => !SUPPORTED_LANGUAGES.includes(lang));
    expect(orphans).toEqual([]);
  });
});
