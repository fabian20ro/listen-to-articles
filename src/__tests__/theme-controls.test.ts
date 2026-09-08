import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import appHtml from '../../index.html?raw';
import { bindThemeControls } from '../lib/theme-controls.js';
import { loadSettings, saveSettings } from '../lib/settings-store.js';

describe('shipped theme controls', () => {
  const defaults = { defaultRate: 1, defaultLang: 'auto' as const };
  let media: MediaQueryList;
  let dark = false;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    document.body.innerHTML = appHtml;
    dark = false;
    media = Object.assign(new EventTarget(), {
      media: '(prefers-color-scheme: dark)',
    }) as MediaQueryList;
    Object.defineProperty(media, 'matches', { get: () => dark });
    vi.stubGlobal('matchMedia', vi.fn(() => media));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function button(value: string): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>(`#theme-selector button[data-value="${value}"]`);
    expect(element).not.toBeNull();
    return element!;
  }

  function bind(): void {
    cleanup = bindThemeControls(
      document.querySelectorAll<HTMLButtonElement>('#theme-selector .segment-btn'),
      loadSettings(defaults),
    );
  }

  it('offers System as a labeled keyboard-native button and persists selection', () => {
    bind();
    expect(document.getElementById('theme-selector')?.getAttribute('aria-label')).toBe('Theme');
    const system = button('system');
    expect(system.textContent?.trim()).toBe('System');
    expect(system.disabled).toBe(false);
    system.click();
    expect(loadSettings(defaults).theme).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(system.getAttribute('aria-pressed')).toBe('true');
    expect(button('dark').getAttribute('aria-pressed')).toBe('false');
  });

  it('restores System and follows OS changes without replacing the persisted preference', () => {
    saveSettings({ ...loadSettings(defaults), theme: 'system' });
    dark = true;
    bind();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(button('system').classList.contains('active')).toBe(true);
    dark = false;
    media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(loadSettings(defaults).theme).toBe('system');
  });

  it('keeps fixed themes independent of later OS changes and cleans up the listener', () => {
    bind();
    button('system').click();
    button('khaki').click();
    dark = true;
    media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('khaki');
    expect(loadSettings(defaults).theme).toBe('khaki');
    button('system').click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    cleanup?.();
    dark = false;
    media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
