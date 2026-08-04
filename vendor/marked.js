/*
 * Minimal marked-compatible adapter used by Listen to Articles.
 * Derived from marked (https://github.com/markedjs/marked).
 * Exposes `window.marked.parse(markdown)`.
 *
 * Original work Copyright (c) 2011-2018 Christopher Jeffrey
 * Original work Copyright (c) 2018+ MarkedJS contributors
 * Licensed under the MIT License.
 * See THIRD-PARTY-LICENSES.md for the full license text.
 */
(function (global) {
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return '';
    if (/^javascript:/i.test(trimmed)) return '';
    return trimmed;
  }

  function parseInline(text) {
    let out = escapeHtml(text);

    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_m, alt, src) {
      const safe = sanitizeUrl(src);
      if (!safe) return '';
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}">`;
    });

    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, label, href) {
      const safe = sanitizeUrl(href);
      if (!safe) return escapeHtml(label);
      return `<a href="${escapeHtml(safe)}">${escapeHtml(label)}</a>`;
    });

    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return out;
  }

  function parse(markdown) {
    const lines = String(markdown || '').replace(/\r/g, '').split('\n');
    const html = [];

    let i = 0;
    let inCode = false;
    let codeBuffer = [];

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        if (!inCode) {
          inCode = true;
          codeBuffer = [];
        } else {
          html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
          inCode = false;
        }
        i += 1;
        continue;
      }

      if (inCode) {
        codeBuffer.push(line);
        i += 1;
        continue;
      }

      if (!trimmed) {
        i += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html.push(`<h${level}>${parseInline(headingMatch[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
        html.push('<hr>');
        i += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const parts = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          parts.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        html.push(`<blockquote><p>${parseInline(parts.join(' '))}</p></blockquote>`);
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
          i += 1;
        }
        html.push(`<ul>${items.map((item) => `<li>${parseInline(item)}</li>`).join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i += 1;
        }
        html.push(`<ol>${items.map((item) => `<li>${parseInline(item)}</li>`).join('')}</ol>`);
        continue;
      }

      const paragraph = [trimmed];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) {
          i += 1;
          break;
        }
        if (/^(#{1,6})\s+/.test(next)) break;
        if (/^```/.test(next)) break;
        if (/^>\s?/.test(next)) break;
        if (/^[-*+]\s+/.test(next)) break;
        if (/^\d+\.\s+/.test(next)) break;
        if (/^---+$/.test(next) || /^\*\*\*+$/.test(next)) break;
        paragraph.push(next);
        i += 1;
      }

      html.push(`<p>${parseInline(paragraph.join(' '))}</p>`);
    }

    if (inCode && codeBuffer.length > 0) {
      html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    }

    return html.join('\n');
  }

  global.marked = { parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
