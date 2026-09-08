// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  collectDistFiles,
  renderServiceWorker,
  renderStableManifest,
  rewriteIndexHtmlForStableAssets,
} from '../scripts/update-precache.mjs';

// The script resolves its repository relative to import.meta.url. Import a fresh
// copy under each fixture so sync tests never read or mutate the real dist/.
async function fixtureRuntime(tempRoot) {
  const scriptPath = join(tempRoot, 'scripts', 'update-precache.mjs');
  mkdirSync(join(tempRoot, 'scripts'), { recursive: true });
  copyFileSync(new URL('./update-precache.mjs', import.meta.url), scriptPath);
  return import(/* @vite-ignore */ pathToFileURL(scriptPath).href);
}

function writeRuntimeSources(tempRoot) {
  mkdirSync(join(tempRoot, 'icons'), { recursive: true });
  mkdirSync(join(tempRoot, 'vendor', 'pdfjs'), { recursive: true });
  writeFileSync(join(tempRoot, 'sw.js'), 'const PRECACHE = [\n];\n');
  writeFileSync(join(tempRoot, 'manifest.json'), '{"name":"App","icons":[]}');
  writeFileSync(join(tempRoot, 'icons', 'icon-192.png'), 'PNG_192');
  writeFileSync(join(tempRoot, 'icons', 'icon-512.png'), 'PNG_512');
  writeFileSync(join(tempRoot, 'vendor', 'pdfjs', 'pdf.worker.min.mjs'), '// pdf worker');
  mkdirSync(join(tempRoot, 'dist'), { recursive: true });
  writeFileSync(join(tempRoot, 'dist', 'index.html'), '<!doctype html>');
}

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

      expect(rendered).toContain("'./',");
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

    // Verify parsed values, not another hand-escaped version of the renderer.
    expect(runInNewContext(`${rendered}\nPRECACHE`)).toEqual(entries);
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

  it('writes stable assets and removes stale hashed entries from dist/assets/', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-precache-sync-'));

    try {
      writeRuntimeSources(tempRoot);
      const distDir = join(tempRoot, 'dist');
      const assetsDir = join(distDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(join(assetsDir, 'manifest-abc123.json'), '{}');
      writeFileSync(join(assetsDir, 'icon-192-xyz.png'), 'PNG_192_STALE');
      writeFileSync(join(assetsDir, 'main-v1.js'), '// chunk');
      const html = '<link rel="manifest" href="./assets/old-manifest.json"><link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-192.png">';
      writeFileSync(join(distDir, 'index.html'), html);

      const { syncStableRuntimeAssets } = await fixtureRuntime(tempRoot);
      syncStableRuntimeAssets();

      const renderedManifest = readFileSync(join(distDir, 'manifest.webmanifest'), 'utf8');
      expect(renderedManifest).toContain('"src": "./icons/icon-192.png"');
      expect(renderedManifest).toContain('"src": "./icons/icon-512.png"');
      expect(readFileSync(join(distDir, 'icons', 'icon-192.png'), 'utf8')).toBe('PNG_192');
      expect(readFileSync(join(distDir, 'icons', 'icon-512.png'), 'utf8')).toBe('PNG_512');
      expect(readFileSync(join(distDir, 'vendor', 'pdfjs', 'pdf.worker.min.mjs'), 'utf8')).toBe('// pdf worker');
      const rewritten = readFileSync(join(distDir, 'index.html'), 'utf8');
      expect(rewritten).toContain('href="./manifest.webmanifest"');
      expect(rewritten).not.toContain('./assets/old-manifest.json');
      const remaining = readdirSync(assetsDir);
      expect(remaining).toEqual(['main-v1.js']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when dist/ does not exist', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-no-dist-'));

    try {
      const { syncDistServiceWorker } = await fixtureRuntime(tempRoot);
      expect(() => syncDistServiceWorker()).toThrow(/dist\/ does not exist/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns outputSwPath and sorted precache entries with "./" first', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-dist-'));

    try {
      writeRuntimeSources(tempRoot);

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

      const { syncDistServiceWorker } = await fixtureRuntime(tempRoot);
      const result = syncDistServiceWorker();

      expect(result.outputSwPath).toBe(outputSwPath);
      expect(result.precacheEntries[0]).toBe('./');
      // "./" first, then sorted dist files (excluding ./sw.js itself)
      expect(result.precacheEntries.slice(1)).toEqual(collectDistFiles(distDir).sort());
      expect(result.precacheEntries).not.toContain('./sw.js');
      // Check the rendered sw.js contains precached entries and is valid JS.
      const written = readFileSync(outputSwPath, 'utf8');
      expect(written).toContain('const PRECACHE = [');
      expect(runInNewContext(`${written}\nPRECACHE`)).toEqual(result.precacheEntries);
      // Entry for index.html should be present
      expect(written).toContain("./index.html");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('deletes stale hashed icon and manifest files from dist/assets/ with multiple icons', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-stale-cleanup-'));

    try {
      writeRuntimeSources(tempRoot);
      const assetsDir = join(tempRoot, 'dist', 'assets');
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(join(assetsDir, 'manifest-abc123.json'), '{}');
      writeFileSync(join(assetsDir, 'icon-192-xyz.png'), 'PNG_192_STALE');
      writeFileSync(join(assetsDir, 'icon-512-abc.png'), 'PNG_512_STALE');
      writeFileSync(join(assetsDir, 'main-v1.js'), '// chunk');

      const { syncStableRuntimeAssets } = await fixtureRuntime(tempRoot);
      syncStableRuntimeAssets();

      const remaining = readdirSync(assetsDir);
      expect(remaining).toEqual(['main-v1.js']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('collects no files from an empty dist directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-collect-empty-'));

    try {
      // Create a completely empty directory — no sw.js, no assets/, nothing.
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
      mkdirSync(join(tempRoot, 'assets'));
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

  it('precaches a nested sw.js — only root-level sw.js is excluded from entries', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-collect-nested-sw-'));

    try {
      mkdirSync(join(tempRoot, 'assets'), { recursive: true });
      writeFileSync(join(tempRoot, 'sw.js'), '// service worker');
      writeFileSync(join(tempRoot, 'index.html'), '<!doctype html>');
      writeFileSync(join(tempRoot, 'assets', 'sw.js'), '// nested file that happens to be named sw.js');
      writeFileSync(join(tempRoot, 'assets', 'main.js'), '// code');

      const entries = collectDistFiles(tempRoot).sort();

      // The skip is exact on the relative path, so a nested file named sw.js
      // is collected and would be precached.
      expect(entries).toEqual([
        './assets/main.js',
        './assets/sw.js',
        './index.html',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when source icon file is missing in syncStableRuntimeAssets', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'listen-to-articles-sync-missing-icon-'));

    try {
      writeRuntimeSources(tempRoot);
      unlinkSync(join(tempRoot, 'icons', 'icon-192.png'));
      const { syncStableRuntimeAssets } = await fixtureRuntime(tempRoot);
      expect(() => syncStableRuntimeAssets()).toThrow(/ENOENT|no such file/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves rich manifest metadata while replacing icons with stable paths', () => {
    const source = JSON.stringify({
      name: 'Pixel Reader',
      short_name: 'PixelReader',
      description: 'Read articles pixel by pixel',
      start_url: '/reader/',
      theme_color: '#ffffff',
      background_color: '#fafafa',
      display: 'standalone',
      icons: [{ src: './icons/old.png' }, { src: './icons/legacy.svg' }],
    });

    const manifest = renderStableManifest(source);
    const parsed = JSON.parse(manifest);

    // Rich metadata preserved verbatim.
    expect(parsed.name).toBe('Pixel Reader');
    expect(parsed.short_name).toBe('PixelReader');
    expect(parsed.description).toBe('Read articles pixel by pixel');
    expect(parsed.start_url).toBe('/reader/');
    expect(parsed.theme_color).toBe('#ffffff');
    expect(parsed.background_color).toBe('#fafafa');
    expect(parsed.display).toBe('standalone');

    // Icons replaced with stable paths.
    expect(parsed.icons).toHaveLength(2);
    expect(parsed.icons[0].src).toBe('./icons/icon-192.png');
    expect(parsed.icons[0].sizes).toBe('192x192');
    expect(parsed.icons[1].src).toBe('./icons/icon-512.png');
    expect(parsed.icons[1].type).toBe('image/png');

    // Old icon references are gone.
    const raw = renderStableManifest(source);
    expect(raw).not.toContain('./icons/old.png');
    expect(raw).not.toContain('./icons/legacy.svg');
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

    expect(rewritten).toContain('href="./manifest.webmanifest"');
    expect(rewritten).not.toContain('./assets/manifest-abc.json');
    // apple-touch-icon points at the stable icon path, not old path
    expect(rewritten).toContain('./icons/icon-192.png');
    expect(rewritten).not.toContain('./assets/old-icon.png');
  });

  it('returns input unchanged when rewriteIndexHtmlForStableAssets finds no matching links', () => {
    const html = '<head><title>No PWA links here</title></head>';
    const rewritten = rewriteIndexHtmlForStableAssets(html);
    expect(rewritten).toBe(html);

    // And an empty string stays empty.
    expect(rewriteIndexHtmlForStableAssets('')).toBe('');
  });

  it('replaces all three PWA link types in a single html pass', () => {
    const html = `<html>
<head>
<link rel="manifest" href="./assets/manifest-xyz.json">
<link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-abc.png">
<link rel="apple-touch-icon" href="./assets/apple-old.png">
</head></html>`;

    const rewritten = rewriteIndexHtmlForStableAssets(html);

    expect(rewritten).toContain('href="./manifest.webmanifest"');
    expect(rewritten).not.toContain('./assets/manifest-xyz.json');
    expect(rewritten).toContain('href="./icons/icon-192.png"');
    expect(rewritten).not.toContain('./assets/icon-abc.png');
    // apple-touch-icon rewritten to the same stable icon path
    expect(rewritten).toMatch(/apple-touch-icon.*href="\.\/icons\/icon-192\.png"/);
    expect(rewritten).not.toContain('./assets/apple-old.png');
  });

  it('replaces icons wholesale in renderStableManifest — old refs gone from parsed manifest', () => {
    const source = JSON.stringify({
      name: 'Pixel Reader',
      short_name: 'PR',
      start_url: '/reader/',
      display: 'standalone',
      theme_color: '#fff',
      background_color: '#fafafa',
      icons: [
        { src: './icons/legacy-256.png', sizes: '256x256' },
        { src: './icons/safari-pinned.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    });

    const manifest = renderStableManifest(source);
    const parsed = JSON.parse(manifest);

    // Icons are replaced entirely — exactly 2, the stable ones.
    expect(parsed.icons).toHaveLength(2);
    expect(parsed.icons[0]).toEqual({ src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' });
    expect(parsed.icons[1]).toEqual({ src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' });

    // Old icon references are gone from the parsed result.
    const raw = renderStableManifest(source);
    expect(raw).not.toContain('./icons/legacy-256.png');
    expect(raw).not.toContain('./icons/safari-pinned.svg');

    // Unrelated metadata is preserved verbatim.
    expect(parsed.short_name).toBe('PR');
    expect(parsed.start_url).toBe('/reader/');
  });
});
