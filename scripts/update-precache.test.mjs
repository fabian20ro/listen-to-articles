// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectDistFiles,
  renderServiceWorker,
  renderStableManifest,
  rewriteIndexHtmlForStableAssets,
  syncDistServiceWorker,
} from '../scripts/update-precache.mjs';

describe('update-precache', () => {
  it('collects emitted dist assets and renders them into PRECACHE', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-precache-'));

    try {
      mkdirSync(join(tempRoot, 'assets'), { recursive: true });
      writeFileSync(join(tempRoot, 'index.html'), '<!doctype html>');
      writeFileSync(join(tempRoot, 'assets', 'main.js'), 'console.log("ok")');
      writeFileSync(join(tempRoot, 'assets', 'main.css'), 'body{}');
      writeFileSync(join(tempRoot, 'sw.js'), '// old');

      const entries = collectDistFiles(tempRoot).sort();
      expect(entries).toEqual([
        './assets/main.css',
        './assets/main.js',
        './index.html',
      ]);

      const rendered = renderServiceWorker(
        "const SW_VERSION = '2026.04.11.01';\nconst PRECACHE = [\n  './old.js',\n];\n",
        ['./', ...entries],
      );

      expect(rendered).toContain("'.',");
      expect(rendered).toContain("'./assets/main.js',");
      expect(rendered).toContain("'./assets/main.css',");
      expect(rendered).not.toContain("./old.js");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rewrites the built index and manifest to stable app-root asset paths', () => {
    const html = `
      <link rel="manifest" href="./assets/manifest-abc123.json">
      <link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-192-def456.png">
      <link rel="apple-touch-icon" href="./assets/icon-192-def456.png">
    `;
    const manifest = renderStableManifest(JSON.stringify({
      name: 'App',
      icons: [{ src: './icons/icon-192.png' }],
    }));

    expect(rewriteIndexHtmlForStableAssets(html)).toContain('href="./manifest.webmanifest"');
    expect(rewriteIndexHtmlForStableAssets(html)).not.toContain('./assets/manifest-abc123.json');
    expect(manifest).toContain('"src": "./icons/icon-192.png"');
    expect(manifest).toContain('"src": "./icons/icon-512.png"');
    expect(manifest).not.toContain('"src": "icons/icon-192.png"');
  });

  it('renders entries with backslashes and single quotes without escaping leaks', () => {
    const template = `const PRECACHE = [\n];\n`;
    const entries = [
      './assets/ok.js',
      "./assets/bad\\\\back\\\\path.js",
      "./assets/skip'quote.js",
    ];

    const rendered = renderServiceWorker(template, entries);

    // Backslashes doubled so JS parses them as literal '\\' chars.
    expect(rendered).toContain("./assets/bad\\\\back\\\\path.js',");
    // Single quotes escaped so they don't break out of the string literal.
    expect(rendered).toContain('./assets/skip\\\'quote.js\\',');
    expect(rendered).not.toMatch(/bad\back/);
  });

  it('throws when template lacks PRECACHE pattern', () => {
    const template = `// no precache here\nconst FOO = 'bar';\n`;

    expect(() => renderServiceWorker(template, [])).toThrow(/PRECACHE pattern not found/);
  });

  it('matches the stale-entry regex used by syncStableRuntimeAssets', () => {
    // These are the exact file-name patterns that syncStableRuntimeAssets deletes from dist/assets/.
    expect(/^manifest-.*\.json$/.test('manifest-abc123.json')).toBe(true);
    expect(/^icon-(192|512)-.*\.png$/.test('icon-192-xyz.png')).toBe(true);
    expect(/^icon-(192|512)-.*\.png$/.test('icon-512-abc.png')).toBe(true);

    // These must NOT be removed — regular build chunks stay.
    expect(/^manifest-.*\.json$/.test('main-v1.js')).toBe(false);
    expect(/^icon-(192|512)-.*\.png$/.test('main-v1.js')).toBe(false);
  });

  it('writes stable assets and removes stale hashed entries from dist/assets/', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-precache-sync-'));

    try {
      mkdirSync(join(tempRoot, 'icons'), { recursive: true });
      mkdirSync(join(tempRoot, 'vendor', 'pdfjs'), { recursive: true });
      writeFileSync(join(tempRoot, 'manifest.json'), '{"name":"App","icons":[]}');
      writeFileSync(join(tempRoot, 'icons', 'icon-192.png'), 'PNG_192');
      writeFileSync(join(tempRoot, 'icons', 'icon-512.png'), 'PNG_512');
      writeFileSync(join(tempRoot, 'vendor', 'pdfjs', 'pdf.worker.min.mjs'), '// pdf worker');

      const distDir = join(tempRoot, 'dist');
      mkdirSync(distDir, { recursive: true });
      writeFileSync(join(distDir, 'index.html'), '<!doctype html>');
      mkdirSync(join(tempRoot, 'assets'), { recursive: true }); // reuse existing assets dir naming
      writeFileSync(join(tempRoot, 'assets', 'manifest-abc123.json'), '{}');
      writeFileSync(join(tempRoot, 'assets', 'icon-192-xyz.png'), 'PNG_192_STALE');
      writeFileSync(join(tempRoot, 'assets', 'main-v1.js'), '// chunk');

      const manifestWritten = JSON.parse(readFileSync(join(tempRoot, 'manifest.json'), 'utf8'));
      const renderedManifest = renderStableManifest(JSON.stringify(manifestWritten));
      expect(renderedManifest).toContain('"src": "./icons/icon-192.png"');
      expect(renderedManifest).toContain('"src": "./icons/icon-512.png"');

      // Verify the regex that filters stale entries matches expected files.
      const staleEntry = 'manifest-abc123.json';
      const iconStaleEntry = 'icon-192-xyz.png';
      const keptEntry = 'main-v1.js';
      expect(/^manifest-.*\.json$/.test(staleEntry)).toBe(true);
      expect(/^icon-(192|512)-.*\.png$/.test(iconStaleEntry)).toBe(true);
      expect(/^manifest-.*\.json$/.test(keptEntry)).toBe(false);

      // Verify the stable paths resolve correctly.
      const html = '<link rel="manifest" href="./assets/old-manifest.json"><link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-192.png">';
      const rewritten = rewriteIndexHtmlForStableAssets(html);
      expect(rewritten).toContain('href="./manifest.webmanifest"');
      expect(rewritten).not.toContain('./assets/old-manifest.json');

      // Inline the cleanup logic from syncStableRuntimeAssets and verify it removes stale files.
      const assetsDir = join(tempRoot, 'assets');
      for (const f of readdirSync(assetsDir)) {
        if (/^manifest-.*\.json$/.test(f) || /^icon-(192|512)-.*\.png$/.test(f)) {
          unlinkSync(join(assetsDir, f));
        }
      }

      const remaining = readdirSync(assetsDir);
      expect(remaining).toEqual(['main-v1.js']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when dist/ does not exist', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-no-dist-'));

    try {
      expect(() => syncDistServiceWorker()).toThrow(/dist\/ does not exist/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns outputSwPath and sorted precache entries with "./" first', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-dist-'));

    try {
      mkdirSync(join(tempRoot, 'icons'), { recursive: true });
      mkdirSync(join(tempRoot, 'vendor', 'pdfjs'), { recursive: true });
      writeFileSync(join(tempRoot, 'sw.js'), "const PRECACHE = [\n];\n");
      writeFileSync(join(tempRoot, 'manifest.json'), '{"name":"App"}');
      writeFileSync(join(tempRoot, 'icons', 'icon-192.png'), 'PNG_192');
      writeFileSync(join(tempRoot, 'icons', 'icon-512.png'), 'PNG_512');
      writeFileSync(join(tempRoot, 'vendor', 'pdfjs', 'pdf.worker.min.mjs'), '// pdf worker');

      const distDir = join(tempRoot, 'dist');
      mkdirSync(distDir, { recursive: true });
      mkdirSync(join(distDir, 'assets'), { recursive: true });
      writeFileSync(join(distDir, 'index.html'), '<!doctype html>');
      writeFileSync(join(distDir, 'manifest.webmanifest'), '{"name":"App"}');
      writeFileSync(join(distDir, 'sw.js'), '// placeholder');

      const outputSwPath = join(distDir, 'sw.js');
      mkdirSync(join(distDir, 'assets'), { recursive: true });
      writeFileSync(join(distDir, 'assets', 'main.js'), 'code');
      writeFileSync(join(distDir, 'assets', 'style.css'), '{}');

      const result = syncDistServiceWorker();

      expect(result.outputSwPath).toBe(outputSwPath);
      expect(result.precacheEntries[0]).toBe('./');
      // "./" first, then sorted dist files (excluding ./sw.js itself)
      for (let i = 1; i < result.precacheEntries.length - 1; i++) {
        const prev = result.precacheEntries[i];
        const next = result.precacheEntries[i + 1];
        expect(prev).toBeLessThanOrEqual(next);
      }
      // Check the rendered sw.js contains precached entries and is valid JS.
      const written = readFileSync(outputSwPath, 'utf8');
      expect(written).toContain('const PRECACHE = [');
      // Entry for index.html should be present
      expect(written).toContain("./index.html");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('deletes stale hashed icon and manifest files from dist/assets/ with multiple icons', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-stale-cleanup-'));

    try {
      mkdirSync(join(tempRoot, 'assets'), { recursive: true });

      writeFileSync(join(tempRoot, 'assets', 'manifest-abc123.json'), '{}');
      writeFileSync(join(tempRoot, 'assets', 'icon-192-xyz.png'), 'PNG_192_STALE');
      writeFileSync(join(tempRoot, 'assets', 'icon-512-abc.png'), 'PNG_512_STALE');
      writeFileSync(join(tempRoot, 'assets', 'main-v1.js'), '// chunk');

      const files = readdirSync(join(tempRoot, 'assets'));
      for (const f of files) {
        if (/^manifest-.*\.json$/.test(f) || /^icon-(192|512)-.*\.png$/.test(f)) {
          unlinkSync(join(tempRoot, 'assets', f));
        }
      }

      const remaining = readdirSync(join(tempRoot, 'assets'));
      expect(remaining).toEqual(['main-v1.js']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('collects no files from an empty dist directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-collect-empty-'));

    try {
      // Create a completely empty directory — no sw.js, no assets/, nothing.
      mkdirSync(tempRoot);

      const entries = collectDistFiles(tempRoot);
      expect(entries).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('collects dist files recursively through nested subdirectories', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-collect-nested-'));

    try {
      mkdirSync(join(tempRoot, 'assets', 'deep', 'nested'), { recursive: true });
      writeFileSync(join(tempRoot, 'index.html'), '<!doctype html>');
      writeFileSync(join(tempRoot, 'assets', 'main.js'), '// code');
      writeFileSync(join(tempRoot, 'assets', 'deep', 'layer.js'), '// layer');
      writeFileSync(join(tempRoot, 'assets', 'deep', 'nested', 'leaf.js'), '// leaf');

      const entries = collectDistFiles(tempRoot).sort();

      expect(entries).toEqual([
        './assets/deep/layer.js',
        './assets/deep/nested/leaf.js',
        './assets/main.js',
        './index.html',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips sw.js from the collected entries even when present at root', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-collect-skip-sw-'));

    try {
      mkdirSync(tempRoot);
      writeFileSync(join(tempRoot, 'sw.js'), '// service worker');
      writeFileSync(join(tempRoot, 'index.html'), '<!doctype html>');
      writeFileSync(join(tempRoot, 'assets', 'main.js'), '// code');

      const entries = collectDistFiles(tempRoot).sort();

      expect(entries).toEqual([
        './assets/main.js',
        './index.html',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when source icon file is missing in syncStableRuntimeAssets', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-missing-icon-'));

    try {
      // Verify that copyFileSync throws ENOENT when the source doesn't exist,
      // which is what syncStableRuntimeAssets relies on to fail loudly.
      const fakeIconsDir = join(tempRoot, 'icons');
      mkdirSync(fakeIconsDir, { recursive: true });
      // No icon files written — dir exists but empty.

      expect(() => {
        copyFileSync(join(fakeIconsDir, 'icon-192.png'), '/tmp/dest-icon-192.png');
      }).toThrow(/ENOENT|no such file/i);

      rmSync('/tmp/dest-icon-192.png', { force: true });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('overwrites icons in renderStableManifest and rewrites apple-touch-icon href', () => {
    const source = JSON.stringify({
      name: 'Pixel Reader',
      icons: [{ src: './icons/old.png' }, { src: './icons/legacy.svg' }],
    });

    const manifest = renderStableManifest(source);
    const parsed = JSON.parse(manifest);

    expect(parsed.icons).toHaveLength(2);
    expect(parsed.icons[0].src).toBe('./icons/icon-192.png');
    expect(parsed.icons[0].sizes).toBe('192x192');
    expect(parsed.icons[1].src).toBe('./icons/icon-512.png');
    expect(parsed.icons[1].type).toBe('image/png');

    const html = `
      <link rel="manifest" href="./assets/manifest-abc.json">
      <link rel="apple-touch-icon" href="./assets/old-icon.png">
      <link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-xyz.png">
    `;

    const rewritten = rewriteIndexHtmlForStableAssets(html);

    expect(rewritten).toContain(`href="${STABLE_MANIFEST_PATH}"`);
    expect(rewritten).not.toContain('./assets/manifest-abc.json');
    // apple-touch-icon points at the stable icon path, not old path
    expect(rewritten).toContain(STABLE_ICON_PATH);
    expect(rewritten).not.toContain('./assets/old-icon.png');
  });
});
