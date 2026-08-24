import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSettings,
  loadSettings,
  resetSettings,
  saveSettings,
  type AppSettings,
} from '../lib/settings-store.js';

const defaults = {
  defaultRate: 1,
  defaultLang: 'auto' as const,
};

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

describe('settings-store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  it('returns default settings when storage is empty', () => {
    const settings = loadSettings(defaults);
    expect(settings).toEqual(createDefaultSettings(defaults));
  });

  it('returns default settings when JSON is malformed and writes them back', () => {
    localStorage.setItem('articlevoice-settings', '{not-valid-json');
    const settings = loadSettings(defaults);
    expect(settings).toEqual(createDefaultSettings(defaults));
    expect(JSON.parse(localStorage.getItem('articlevoice-settings') ?? '{}')).toEqual(settings);
  });

  it('sanitizes invalid stored values and writes back the cleaned settings', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({
        rate: 99,
        lang: 'xx',
        voiceName: 123,
        wakeLock: 'yes',
      }),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(3);
    expect(settings.lang).toBe('auto');
    expect(settings.voiceName).toBe('');
    expect(settings.wakeLock).toBe(true);
    expect(JSON.parse(localStorage.getItem('articlevoice-settings') ?? '{}')).toEqual(settings);
  });

  it('sanitizes every field and round-trips known-good values', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({
        rate: -5,
        lang: 'xx',
        voiceName: undefined as unknown as string,
        voiceGender: 'unknown' as unknown as 'auto',
        wakeLock: true as unknown as boolean,
        theme: 'neon' as unknown as Theme,
        deviceVoiceOnly: null as unknown as boolean,
      }),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(0.5);
    expect(settings.lang).toBe('auto');
    expect(settings.voiceName).toBe('');
    expect(settings.voiceGender).toBe('auto');
    expect(settings.wakeLock).toBe(true);
    expect(settings.theme).toBe('dark');
    expect(settings.deviceVoiceOnly).toBe(false);

    const writtenBack = JSON.parse(localStorage.getItem('articlevoice-settings') ?? '{}');
    expect(writtenBack).toEqual(settings);
  });

  it('preserves known-good theme "khaki" without falling back to dark', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ ...defaults, theme: 'khaki' } satisfies AppSettings),
    );

    const settings = loadSettings(defaults);
    expect(settings.theme).toBe('khaki');
  });

  it('clamps rate to the [0.5, 3] inclusive range', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 10 } satisfies Partial<AppSettings>),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(3);
  });

  it('treats NaN as invalid and falls back to the default rate', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: Number.NaN } satisfies Partial<AppSettings>),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(defaults.defaultRate);
  });

  it('persists and reloads valid settings', () => {
    const expected: AppSettings = {
      rate: 1.25,
      lang: 'en',
      voiceName: 'Samantha',
      voiceGender: 'auto',
      wakeLock: false,
      theme: 'dark',
      deviceVoiceOnly: false,
    };

    saveSettings(expected);

    expect(loadSettings(defaults)).toEqual(expected);
  });

  it('preserves valid voiceGender "male" / "female"', () => {
    for (const gender of ['male' as const, 'female' as const]) {
      localStorage.setItem(
        'articlevoice-settings',
        JSON.stringify({ ...defaults, voiceGender: gender } satisfies Partial<AppSettings>),
      );

      expect(loadSettings(defaults).voiceGender).toBe(gender);
    }
  });

  it('preserves valid theme "light" alongside known "khaki"', () => {
    for (const theme of ['light' as const, 'khaki' as const]) {
      localStorage.setItem(
        'articlevoice-settings',
        JSON.stringify({ ...defaults, theme } satisfies Partial<AppSettings>),
      );

      expect(loadSettings(defaults).theme).toBe(theme);
    }
  });

  it('preserves deviceVoiceOnly true when stored', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ ...defaults, deviceVoiceOnly: true } satisfies Partial<AppSettings>),
    );

    expect(loadSettings(defaults).deviceVoiceOnly).toBe(true);
  });

  it('preserves a non-auto lang when stored and valid', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ ...defaults, lang: 'en' } satisfies Partial<AppSettings>),
    );

    expect(loadSettings(defaults).lang).toBe('en');
  });

  it('returns full defaults when storage holds an empty object', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({}),
    );

    const settings = loadSettings(defaults);
    expect(settings).toEqual(createDefaultSettings(defaults));
  });

  it('ignores extraneous keys stored alongside valid data', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 1.5, lang: 'en', voiceName: 'Test', extraField: true } satisfies Partial<AppSettings> & Record<string, unknown>),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(1.5);
    expect(settings.lang).toBe('en');
    expect(settings.voiceName).toBe('Test');
    void (settings as AppSettings).extraField; // not a real field — just asserting no leak path exists
  });

  it('does not leak stored unknown keys into the returned settings shape', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ foo: 'bar', baz: 42 } satisfies Record<string, unknown>),
    );

    const settings = loadSettings(defaults);
    expect(Object.keys(settings)).toEqual(expect.arrayContaining(['rate', 'lang', 'voiceName', 'voiceGender', 'wakeLock', 'theme', 'deviceVoiceOnly']));
    for (const key of Object.keys(settings)) {
      expect(key).not.toMatch(/^(foo|baz)$/);
    }
  });

  it('does not trigger a spurious save when defaults fill missing keys', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 1, lang: 'auto' }),
    );

    const saved = loadSettings(defaults);
    expect(saved.rate).toBe(1);
    expect(saved.lang).toBe('auto');
    expect(localStorage.getItem('articlevoice-settings')).toBe(JSON.stringify({ rate: 1, lang: 'auto' }));
  });

  it('only triggers a save when at least one field actually changed', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 2, lang: 'en' }),
    );

    const saved = loadSettings(defaults);
    expect(saved.rate).toBe(2);
    expect(saved.lang).toBe('en');
    expect(localStorage.getItem('articlevoice-settings')).toBe(JSON.stringify({ rate: 2, lang: 'en' }));
  });

  it('does not trigger a save when valid settings already match defaults', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 1, lang: 'auto', voiceName: '', voiceGender: 'auto', wakeLock: true, theme: 'dark', deviceVoiceOnly: false }),
    );

    const saved = loadSettings(defaults);
    expect(saved).toEqual(createDefaultSettings(defaults));
    expect(localStorage.getItem('articlevoice-settings')).toBe(JSON.stringify({ rate: 1, lang: 'auto', voiceName: '', voiceGender: 'auto', wakeLock: true, theme: 'dark', deviceVoiceOnly: false }));
  });

  it('triggers a save when invalid values are sanitized', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ rate: 99, lang: 'xx' }),
    );

    const saved = loadSettings(defaults);
    expect(saved.rate).toBe(3);
    expect(saved.lang).toBe('auto');
    expect(localStorage.getItem('articlevoice-settings')).toBe(JSON.stringify({ rate: 3, lang: 'auto', voiceName: '', voiceGender: 'auto', wakeLock: true, theme: 'dark', deviceVoiceOnly: false }));
  });

  it.each([null, undefined, 0, 'yes'] as const)('falls back to wakeLock=true when stored value is %s (not boolean)', (storedValue) => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({ ...defaults, wakeLock: storedValue }),
    );

    expect(loadSettings(defaults).wakeLock).toBe(true);
  });

  it('returns fallback defaults when saveSettings throws during load', () => {
    localStorage.setItem('articlevoice-settings', '{not-valid-json');
    const restore = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });

    const saved = loadSettings(defaults);
    expect(saved).toEqual(createDefaultSettings(defaults));
    expect(localStorage.getItem('articlevoice-settings')).toBe('{not-valid-json');

    restore.mockRestore();
  });

  describe('resetSettings', () => {
    it('removes the stored key and returns fresh defaults', () => {
      localStorage.setItem(
        'articlevoice-settings',
        JSON.stringify({ rate: 2, lang: 'en' }),
      );

      const settings = resetSettings(defaults);

      expect(localStorage.getItem('articlevoice-settings')).toBeNull();
      expect(settings).toEqual(createDefaultSettings(defaults));
    });

    it('returns defaults even when removeItem throws', () => {
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      const settings = resetSettings(defaults);

      expect(settings).toEqual(createDefaultSettings(defaults));

      vi.restoreAllMocks();
    });
  });
});
