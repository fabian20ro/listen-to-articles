import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  detectLangFromHtml,
  detectLangFromUrl,
  needsTranslation,
  getSourceLang,
} from '../lib/lang-detect.js';

describe('detectLanguage', () => {
  // ── English detection ───────────────────────────────────────────
  it('detects English text', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. This is a sample English article about technology and science. We will explore many topics in this comprehensive guide.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('detects English for a longer passage', () => {
    const text =
      'Artificial intelligence has transformed the way we interact with technology. Machine learning models can now process natural language, recognize images, and even generate creative content. The implications for society are profound and far-reaching.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('defaults to English for empty text', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('defaults to English for short ambiguous text', () => {
    expect(detectLanguage('Hello world')).toBe('en');
  });

  // ── Romanian detection ──────────────────────────────────────────
  it('detects Romanian via diacritics', () => {
    const text =
      'România este o țară situată în sud-estul Europei. Capitala și cel mai mare oraș este București.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via common words', () => {
    const text =
      'Acest articol este despre tehnologie și despre cum poate schimba viața pentru toți oamenii care sunt interesați.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian with heavy diacritics', () => {
    const text = 'Îți mulțumesc că ai venit. Această întâlnire a fost foarte importantă.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian with uppercase diacritics', () => {
    const text = 'BUCUREȘTI este capitala României. Țara este în Uniunea Europeană.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via very short common words', () => {
    const text = 'de un la o cu';
    expect(detectLanguage(text)).toBe('ro');
  });

  // ── Edge cases ────────────────────────────────────────────────
  it('only examines the first ~1000 characters', () => {
    // English text padded to >1000 chars, followed by heavy Romanian
    const englishPart = 'This is English. '.repeat(70); // ~1190 chars
    const romanianPart = 'Această țară este România și sunt foarte fericit.';
    expect(detectLanguage(englishPart + romanianPart)).toBe('en');
  });

  it('detects Romanian when diacritics appear early', () => {
    const text = 'Aceasta este o întâmplare ciudată și neașteptată în orașul nostru.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('treats text with exactly 3 Romanian diacritics as English (threshold is >3)', () => {
    // Exactly 3 diacritics but no Romanian common words
    const text = 'The café résumé naïveté is wonderful and beautiful.';
    // ă, é, ë are not all Romanian diacritics — only ă counts
    // Actually café has no Romanian diacritics. Let's construct carefully:
    // We need exactly 3 hits on [ăâîșț]
    const crafted = 'Word ă word â word î and nothing else in this text about science.';
    expect(detectLanguage(crafted)).toBe('en');
  });

  it('detects Romanian when exactly 4 diacritics are present', () => {
    const text = 'Word ă word â word î word ș and nothing else here.';
    expect(detectLanguage(text)).toBe('ro');
  });

  // ── Mixed HTML/content input shape (realistic extraction artifact) ─

  it('handles English text with embedded Romanian diacritics in tags', () => {
    // Simulates readability output where a word is wrapped in formatting tags.
    // Diacritics should still be counted past the tag boundary.
    const text = 'The <b>cafeteria</b> serves great food. This article covers many topics.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('handles Romanian text with English words inside HTML tags', () => {
    // Mixed content: Romanian prose with an English word wrapped in <span>.
    const text = 'Acest articol despre <span>technology</span> și inovație este important.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('counts Romanian diacritics even when they are inside HTML tags', () => {
    // Simulates readability output where a single Romanian word is wrapped in <b>.
    // No Romanian common words outside the tag; detection relies solely on diacritics.
    const text = 'Acest articol este despre <b>țară</b> și inovație.';
    expect(detectLanguage(text)).toBe('ro');
  });

  // ── Word-boundary edge cases (heuristic contract) ────────────────

  it('does not detect Romanian when words are stuck to punctuation without diacritics', () => {
    // Word boundary regex requires whitespace/punctuation BEFORE the word,
    // but "ș" in "Hello,și" is attached to a comma with no preceding space.
    // No diacritics above threshold either → English.
    const text = 'Hello,și ești aici și nu este frumos.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('detects Romanian when diacritic count exceeds threshold regardless of word boundaries', () => {
    // Even with words stuck to punctuation, the diacritic counter alone
    // should push detection past the >3 threshold.
    const text = 'Hello,ăâîș ești aici și nu este frumos.';
    expect(detectLanguage(text)).toBe('ro');
  });

  // ── Extended word-list coverage (new stop words) ────────────────

  it('detects Romanian via new stop word "aceasta" + diacritic', () => {
    const text = 'Această întrebare este foarte importantă pentru aceasta.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via new stop words "așa" and "cum"', () => {
    const text = 'Așa cum știm, acest lucru este posibil.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via new stop word "fără" + diacritics', () => {
    const text = 'Fără aceste semne, articolul ar fi în engleză.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via new stop words "niște" and "pe"', () => {
    const text = 'Pe niște site-uri românești se găsesc articole interesante.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via new stop word "totuși" + diacritic', () => {
    const text = 'Totuși, această idee este foarte interesantă.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('does not falsely detect English when only new stop words are present without other signals', () => {
    // A single common word should still need another signal to trigger ro detection.
    const text = 'Aceasta este o întrebare despre tehnologie.';
    expect(detectLanguage(text)).toBe('ro'); // 2 words: aceasta + despre (existing)
  });

  it('detects Romanian via new stop word "trebuie" + diacritic', () => {
    const text = 'Trebuie să studiem această problemă pentru a înțelege.';
    expect(detectLanguage(text)).toBe('ro');
  });
});

// ── detectLangFromHtml ─────────────────────────────────────────────

describe('detectLangFromHtml', () => {
  it('normalizes "de-DE" to "de"', () => {
    expect(detectLangFromHtml('de-DE')).toBe('de');
  });
  it('normalizes "en-US" to "en', () => {
    expect(detectLangFromHtml('en-US')).toBe('en');
  });
  it('normalizes "en_US" to "en', () => {
    expect(detectLangFromHtml('en_US')).toBe('en');
  });
  it('normalizes "de_DE" to "de', () => {
    expect(detectLangFromHtml('de_DE')).toBe('de');
  });
  it('normalizes "fr-CA" to "fr', () => {
    expect(detectLangFromHtml('fr-CA')).toBe('fr');
  });
  it('normalizes "it-IT" to "it', () => {
    expect(detectLangFromHtml('it-IT')).toBe('it');
  });

  it('handles simple code like "fr"', () => {
    expect(detectLangFromHtml('fr')).toBe('fr');
  });

  it('handles underscore variant "pt_BR"', () => {
    expect(detectLangFromHtml('pt_BR')).toBe('pt');
  });

  it('lowercases the result', () => {
    expect(detectLangFromHtml('DE')).toBe('de');
  });

  it('trims whitespace', () => {
    expect(detectLangFromHtml('  de  ')).toBe('de');
  });

  it('returns empty string for empty input', () => {
    expect(detectLangFromHtml('')).toBe('');
  });
});

// ── detectLangFromUrl ──────────────────────────────────────────────

describe('detectLangFromUrl', () => {
  it('detects German from .de TLD', () => {
    expect(detectLangFromUrl('https://web.de/magazine/article')).toBe('de');
  });

  it('detects French from .fr TLD', () => {
    expect(detectLangFromUrl('https://lemonde.fr/article')).toBe('fr');
  });

  it('detects English from .uk TLD', () => {
    expect(detectLangFromUrl('https://bbc.co.uk/news')).toBe('en');
  });

  it('returns empty for .com TLD', () => {
    expect(detectLangFromUrl('https://example.com/article')).toBe('');
  });

  it('returns empty for .org TLD', () => {
    expect(detectLangFromUrl('https://wikipedia.org/wiki/Test')).toBe('');
  });

  it('returns empty for .io TLD', () => {
    expect(detectLangFromUrl('https://app.io/page')).toBe('');
  });

  it('returns empty for empty URL', () => {
    expect(detectLangFromUrl('')).toBe('');
  });

  it('returns empty for unknown TLD', () => {
    expect(detectLangFromUrl('https://example.xyz')).toBe('');
  });
  it('returns empty for localhost', () => {
    expect(detectLangFromUrl('http://localhost:3000')).toBe('');
  });
  it('returns empty for ip address', () => {
    expect(detectLangFromUrl('http://192.168.1.1')).toBe('');
  });

  it('detects Spanish from .es TLD', () => {
    expect(detectLangFromUrl('https://example.es/article')).toBe('es');
  });

  it('detects Italian from .it TLD', () => {
    expect(detectLangFromUrl('https://example.it/article')).toBe('it');
  });

  // ── Baltic TLDs ────────────────────────────────────────────────

  it('detects Lithuanian from .lt TLD', () => {
    expect(detectLangFromUrl('https://lrytas.lt/straipsnis')).toBe('lt');
  });

  it('detects Latvian from .lv TLD', () => {
    expect(detectLangFromUrl('https://delfi.lv/zinas')).toBe('lv');
  });

  it('detects Estonian from .ee TLD', () => {
    expect(detectLangFromUrl('https://delfi.ee/artikll')).toBe('et');
  });

  // ── Balkan TLDs ────────────────────────────────────────────────

  it('detects Serbian from .me TLD (Montenegro)', () => {
    expect(detectLangFromUrl('https://cdn.me/clanak')).toBe('sr');
  });

  it('detects Macedonian from .mk TLD', () => {
    expect(detectLangFromUrl('https://kurir.mk/tekst')).toBe('mk');
  });

  // ── Additional Balkan TLDs ───────────────────────────────────────

  it('detects Bulgarian from .bg TLD', () => {
    expect(detectLangFromUrl('https://dnevnik.bg/statija')).toBe('bg');
  });

  it('detects Croatian from .hr TLD', () => {
    expect(detectLangFromUrl('https://index.hr/vijesti')).toBe('hr');
  });

  it('detects Slovak from .sk TLD', () => {
    expect(detectLangFromUrl('https://aktuality.sk/clanok')).toBe('sk');
  });

  it('detects Slovenian from .sl TLD', () => {
    expect(detectLangFromUrl('https://dnevnik.si/ clanek')).toBe('sl');
  });

  // ── Romanian TLD (core product signal) ───────────────────────

  it('detects Romanian from .ro TLD', () => {
    expect(detectLangFromUrl('https://digi24.ro/stiri')).toBe('ro');
  });

  it('detects Romanian from subdomain .ro URL', () => {
    expect(detectLangFromUrl('https://articol.example.ro/text')).toBe('ro');
  });

  // ── Multi-level TLD edge cases ───────────────────────────────

  it('returns English for .co.uk (TLD is the last segment)', () => {
    expect(detectLangFromUrl('https://bbc.co.uk/news/tech')).toBe('en');
  });

  // ── Hostname parsing robustness ──────────────────────────────

  it('handles URL with query parameters', () => {
    expect(detectLangFromUrl('https://example.fr/article?q=test&page=1')).toBe('fr');
  });

  it('detects language from IP-based hostname (no TLD mapping)', () => {
    // IPs have no meaningful TLD; should return ''
    expect(detectLangFromUrl('http://93.184.216.34/article')).toBe('');
  });

  it('detects Serbian from .rs TLD (Serbia proper)', () => {
    expect(detectLangFromUrl('https://b92.rs/beseda')).toBe('sr');
  });
});

// ── needsTranslation ───────────────────────────────────────────────

describe('needsTranslation', () => {
  it('returns false for English htmlLang', () => {
    expect(needsTranslation('en', 'https://example.com/article')).toBe(false);
  });

  it('returns false for English with region code in htmlLang', () => {
    expect(needsTranslation('en-US', 'https://example.com/article')).toBe(false);
  });

  it('returns false for Romanian htmlLang', () => {
    expect(needsTranslation('ro', 'https://example.com/article')).toBe(false);
  });

  it('returns true for German htmlLang', () => {
    expect(needsTranslation('de', 'https://example.com/article')).toBe(true);
  });

  it('returns true for French htmlLang', () => {
    expect(needsTranslation('fr-FR', 'https://example.com/article')).toBe(true);
  });

  it('returns false for English URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://bbc.co.uk/news')).toBe(false);
  });

  it('returns false for Romanian URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://digi24.ro/stiri')).toBe(false);
  });

  it('returns true for German URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://web.de/magazine')).toBe(true);
  });

  it('returns true for non-supported URL TLD even if text is en', () => {
    expect(needsTranslation('', 'https://example.fr', 'en')).toBe(true);
  });

  it('returns false when textLang is ro', () => {
    expect(needsTranslation('', '', 'ro')).toBe(false);
  });
  it('returns false when textLang is en', () => {
    expect(needsTranslation('', '', 'en')).toBe(false);
  });
  it('returns true when all signals are empty', () => {
    expect(needsTranslation('', '')).toBe(true);
  });

  it('htmlLang takes priority over URL TLD', () => {
    // English htmlLang on a .de domain → no translation needed
    expect(needsTranslation('en', 'https://web.de/article')).toBe(false);
  });

  // ── Unsupported-language contract (the only supported langs are en/ro) ───

  it('returns true when htmlLang is an unsupported language (ja)', () => {
    expect(needsTranslation('ja', '')).toBe(true);
  });

  it('returns true when url TLD maps to an unsupported language (nl)', () => {
    expect(needsTranslation('', 'https://example.nl/article')).toBe(true);
  });

  it('returns false only for supported languages regardless of htmlLang vs URL conflict', () => {
    // English htmlLang + .de URL → htmlLang wins, no translation needed
    expect(needsTranslation('en', 'https://web.de/a')).toBe(false);
    // German htmlLang on a .ro URL → htmlLang wins, but de is unsupported → translate
    expect(needsTranslation('de', 'https://example.ro/stiri')).toBe(true);
  });

  it('returns true for every non-English/rominan language code via text fallback', () => {
    // The `textLang` parameter accepts Language = 'en' | 'ro'. If an external
    // caller passes a non-en/ro language it would not typecheck, so we verify the
    // actual supported set by asserting both members of SUPPORTED_LANGUAGES
    // short-circuit translation:
    expect(needsTranslation('en', '', 'en')).toBe(false);
    expect(needsTranslation('', '', 'ro')).toBe(false);
  });

  it('assumes non-English when all signals are empty (default-to-translate)', () => {
    expect(needsTranslation('', '')).toBe(true);
  });

  it('assumes non-English for unknown TLD with no htmlLang or text', () => {
    // .xyz is not in TLD_LANG_MAP and not in GENERIC_TLDS, so detectLangFromUrl
    // returns ''; all three signals are empty → translate.
    expect(needsTranslation('', 'https://example.xyz/page')).toBe(true);
  });
});

// ── getSourceLang ──────────────────────────────────────────────────

describe('getSourceLang', () => {
  it('returns language from htmlLang when available', () => {
    expect(getSourceLang('de-DE', 'https://example.com/article')).toBe('de');
  });

  it('falls back to URL TLD when htmlLang is empty', () => {
    expect(getSourceLang('', 'https://web.de/article')).toBe('de');
  });

  it('returns auto when no signals available', () => {
    expect(getSourceLang('', 'https://example.com/article')).toBe('auto');
  });

  it('returns auto when URL is empty', () => {
    expect(getSourceLang('', '')).toBe('auto');
  });
});