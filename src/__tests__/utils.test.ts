import { describe, it, expect } from 'vitest';
import { 
  isSpeakableText, 
  stripNonTextContent, 
  stripMarkdownSyntax, 
  filterReadableParagraphs, 
  markdownToParagraphs, 
  extractTitleFromMarkdown, 
  splitSentences, 
  splitTextBySentences, 
  countWords, 
  splitPlainTextParagraphs 
} from '../lib/extractors/utils.js';

describe('utils.ts', () => {
  describe('isSpeakableText', () => {
    it('returns false for very short text', () => {
      expect(isSpeakableText('a')).toBe(false);
      expect(isSpeakableText('ab')).toBe(false);
    });

    it('returns true for sufficient word count', () => {
      expect(isSpeakableText('The quick brown fox jumps over the lazy dog.')).toBe(true);
    });

    it('falls back to char count for low word count (non-latin)', () => {
      expect(isSpeakableText('你好世界')).toBe(true); // 4 chars
      expect(isSpeakableText('你好')).toBe(false); // 2 chars
    });
  });

  describe('stripNonTextContent', () => {
    it('strips HTML tags', () => {
      const input = '<p>Hello <b class="foo">world</b>!</p>';
      const result = stripNonTextContent(input);
      expect(result).toMatch(/Hello\s+world\s*!/);
    });

    it('strips data URIs', () => {
      expect(stripNonTextContent('Text with data:image/png;base64,abc')).toBe('Text with');
    });

    it('strips image markdown', () => {
      expect(stripNonTextContent('Text with ![alt](url)')).toBe('Text with');
    });

    it('strips image URLs even if followed by a period', () => {
      expect(stripNonTextContent('Text with https://example.com/image.png.')).toBe('Text with');
    });
    it('strips image URLs', () => {
      expect(stripNonTextContent('Text with https://example.com/image.png')).toBe('Text with');
    });
  });

  describe('stripMarkdownSyntax', () => {
    it('strips headers, lists, and quotes', () => {
      const input = '# Title\n\n> Quote\n\n* Item 1\n* Item 2\n\n`code`';
      const output = stripMarkdownSyntax(input);
      expect(output).not.toContain('#');
      expect(output).not.toContain('>');
      expect(output).not.toContain('*');
      expect(output).not.toContain('`');
    });

    it('strips fenced code blocks entirely', () => {
      const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
      expect(stripMarkdownSyntax(input)).toBe('Before After');
    });

    it('handles nested inline code with no content after stripping', () => {
      const result = stripMarkdownSyntax('` `');
      // Inline backticks stripped to their content (empty), then stripNonTextContent trims.
      expect(result).toBe('');
    });
  });

  describe('filterReadableParagraphs', () => {
    it('filters by MIN_PARAGRAPH_LENGTH and speakability', () => {
      const paragraphs = ['This is a long enough paragraph that is speakable.', 'Short.', 'Bad'];
      const result = filterReadableParagraphs(paragraphs);
      expect(result.length).toBe(1);
      expect(result[0]).toBe('This is a long enough paragraph that is speakable.');
    });
  });

  describe('markdownToParagraphs', () => {
    it('converts markdown to paragraphs', () => {
      const markdown = '# Title\n\nPara 1 content is here.\n\nPara 2 content is here.';
      const result = markdownToParagraphs(markdown);
      expect(result.length).toBe(2);
      expect(result[0]).toBe('Para 1 content is here.');
    });

    it('collapses consecutive blank lines into a single paragraph separator', () => {
      // Production code splits on /\\n\\s*\\n+/ so any number of blank lines should act as one.
      const markdown = '# Title\n\n\nPara 1 content is here.\n\n\n\nPara 2 content is here.';
      const result = markdownToParagraphs(markdown);
      expect(result.length).toBe(2);
    });

    it('filters out leading-whitespace-only blocks that strip to empty', () => {
      // A block of spaces/tabs should not produce a phantom empty paragraph.
      const markdown = '\n\n   \t\t  \n\nPara 1 content is here.\n\nPara 2 content is here.';
      const result = markdownToParagraphs(markdown);
      expect(result.length).toBe(2);
    });
  });

  describe('extractTitleFromMarkdown', () => {
    it('extracts H1 title', () => {
      expect(extractTitleFromMarkdown('# My Title\nContent')).toBe('My Title');
      expect(extractTitleFromMarkdown('#NoSpaceTitle\nContent')).toBe('NoSpaceTitle');
    });

    it('falls back to first line if no H1', () => {
      expect(extractTitleFromMarkdown('First line\nSecond line')).toBe('First line');
    });

    it('handles mixed header levels and finds the correct H1', () => {
      expect(extractTitleFromMarkdown('## Subtitle\n# Real Title\nContent')).toBe('Real Title');
      expect(extractTitleFromMarkdown('### Not an H1\n# Title')).toBe('Title');
    });

    it('returns empty string when markdown is only a bare H1', () => {
      // Bare H1 has no body content — nothing to read aloud.
      expect(extractTitleFromMarkdown('# Just A Title')).toBe('');
    });

    it('strips markdown syntax from first-line fallback', () => {
      expect(extractTitleFromMarkdown('*emphasized title*\nContent')).toBe('emphasized title');
    });
  });

  describe('splitSentences', () => {
    it('splits by punctuation', () => {
      expect(splitSentences('One. Two. Three. Four. Five. Six. Seven. Eight.')).toEqual(['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.', 'Eight.']);
    });
    it('handles sentences without terminal punctuation at the end of text', () => {
      expect(splitSentences('Hello. World')).toEqual(['Hello.', 'World']);
    });
    it('handles ellipsis', () => {
      expect(splitSentences('Hello... World')).toEqual(['Hello...', 'World']);
    });

    it('treats Mr. as part of the preceding word (abbreviation in list)', () => {
      const result = splitSentences('Mr. Smith went home.');
      // The regex lists "Mr" in the lookbehind so it should NOT split after "Mr."
      expect(result).not.toEqual(['Mr.', 'Smith went home.']);
    });

    it('returns non-empty array for text with abbreviations', () => {
      const result = splitSentences('Dr. Jones said hello.');
      expect(result.length).toBeGreaterThan(0);
    });

    it('treats Dr. as part of the preceding word (abbreviation in list)', () => {
      const result = splitSentences('Dr. Smith walked into the room.');
      // "Dr." should not split — result should be one sentence
      expect(result).toEqual(['Dr. Smith walked into the room.']);
    });

    it('handles consecutive abbreviations without splitting', () => {
      const result = splitSentences('The e.g. and i.e. examples are confusing.');
      // Both "e.g." and "i.e." should not trigger splits
      expect(result).toEqual(['The e.g. and i.e. examples are confusing.']);
    });

    it('splits after abbreviation at sentence boundary', () => {
      const result = splitSentences('Dr. Smith went home. He was tired.');
      // "Dr." is an abbreviation (no split), period ends first sentence, second starts fresh
      expect(result).toEqual(['Dr. Smith went home.', 'He was tired.']);
    });

    it('treats Mr., Mrs., Ms. as abbreviations in list', () => {
      const result1 = splitSentences('Mr. Jones said hello.');
      expect(result1).toEqual(['Mr. Jones said hello.']);
      const result2 = splitSentences('Mrs. Smith walked away.');
      expect(result2).toEqual(['Mrs. Smith walked away.']);
      const result3 = splitSentences('Ms. Davis nodded.');
      expect(result3).toEqual(['Ms. Davis nodded.']);
    });

    it('handles Prof. as abbreviation', () => {
      const result = splitSentences('Prof. Adams lectured for hours.');
      // "Prof." should not trigger a sentence boundary
      expect(result).toEqual(['Prof. Adams lectured for hours.']);
    });
  });

  describe('splitTextBySentences', () => {
    it('splits into chunks of N sentences', () => {
      const text = 'One. Two. Three. Four. Five. Six. Seven. Eight.';
      expect(splitTextBySentences(text, 2, 0)).toEqual(['One. Two.', 'Three. Four.', 'Five. Six.', 'Seven. Eight.']);
    });
  });

  describe('countWords', () => {
    it('counts words correctly', () => {
      expect(countWords('Hello world')).toBe(2);
      expect(countWords('')).toBe(0);
    });

    // `split(/\s+/)` after `.trim()` still splits the remaining string — so leading/trailing whitespace never inflates the count, but:
    it('treats trimmed-empty input as zero', () => {
      expect(countWords('   ')).toBe(0);
      expect(countWords('\n\t')).toBe(0);
    });

    // Regression guard: current implementation does `text.trim().split(/\s+/)` which gives 2 for this input. Lock it in.
    it('does not inflate word count on leading/trailing whitespace', () => {
      expect(countWords('  hello world  ')).toBe(2);
    });
  });

  describe('splitPlainTextParagraphs', () => {
    it('splits by blank lines', () => {
      const text = 'This is a long enough paragraph one.\n\nThis is a long enough paragraph two.';
      expect(splitPlainTextParagraphs(text)).toEqual(['This is a long enough paragraph one.', 'This is a long enough paragraph two.']);
    });

    it('falls back to line breaks if no blank lines', () => {
      const text = 'This is a long enough paragraph one.\nThis is a long enough paragraph two.';
      expect(splitPlainTextParagraphs(text)).toEqual(['This is a long enough paragraph one.', 'This is a long enough paragraph two.']);
    });

    it('falls back to sentence splitting if needed', () => {
      const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
      expect(splitPlainTextParagraphs(text, 2)).toEqual(['Sentence one. Sentence two.', 'Sentence three. Sentence four.']);
    });
  });
});
