/*
 * Minimal Turndown-compatible adapter used by Listen to Articles.
 * Derived from Turndown (https://github.com/mixmark-io/turndown).
 * Exposes `window.TurndownService` with a `turndown(html)` method.
 *
 * Original work Copyright (c) 2017 Dom Christie
 * Licensed under the MIT License.
 * See THIRD-PARTY-LICENSES.md for the full license text.
 */
(function (global) {
  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function escapeInline(text) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/`/g, '\\`');
  }

  function toInline(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeInline(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(toInline).join('');

    if (tag === 'strong' || tag === 'b') return `**${children}**`;
    if (tag === 'em' || tag === 'i') return `*${children}*`;
    if (tag === 'code') return `\`${normalize(children)}\``;
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const text = normalize(children) || href;
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      if (!src) return alt;
      return `![${alt}](${src})`;
    }
    if (tag === 'br') return '\n';

    return children;
  }

  function toBlocks(root) {
    const blocks = [];

    function visit(node, depth) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalize(node.textContent || '');
        if (text) blocks.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node;
      const tag = el.tagName.toLowerCase();

      if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const text = normalize(Array.from(el.childNodes).map(toInline).join(''));
        if (text) blocks.push(`${'#'.repeat(level)} ${text}`);
        return;
      }

      if (tag === 'p') {
        const text = normalize(Array.from(el.childNodes).map(toInline).join(''));
        if (text) blocks.push(text);
        return;
      }

      if (tag === 'blockquote') {
        const text = normalize(Array.from(el.childNodes).map(toInline).join(''));
        if (text) blocks.push(`> ${text}`);
        return;
      }

      if (tag === 'pre') {
        const code = (el.textContent || '').trim();
        if (code) blocks.push(`\`\`\`\n${code}\n\`\`\``);
        return;
      }

      if (tag === 'hr') {
        blocks.push('---');
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        let index = 1;
        Array.from(el.children).forEach((li) => {
          if (li.tagName.toLowerCase() !== 'li') return;
          const text = normalize(Array.from(li.childNodes).map(toInline).join(''));
          if (!text) return;
          const marker = tag === 'ol' ? `${index}.` : '-';
          blocks.push(`${'  '.repeat(depth)}${marker} ${text}`);
          index += 1;
        });
        return;
      }

      if (tag === 'figure') {
        const figureParts = Array.from(el.childNodes).map(toInline).join('\n').trim();
        if (figureParts) blocks.push(figureParts);
        return;
      }

      Array.from(el.childNodes).forEach((child) => visit(child, depth + 1));
    }

    Array.from(root.childNodes).forEach((child) => visit(child, 0));
    return blocks;
  }

  function TurndownService(_options) {}

  TurndownService.prototype.turndown = function turndown(input) {
    const html = typeof input === 'string' ? input : '';
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild || doc.body;
    const blocks = toBlocks(root);
    return blocks.join('\n\n').trim();
  };

  global.TurndownService = TurndownService;
})(typeof window !== 'undefined' ? window : globalThis);
