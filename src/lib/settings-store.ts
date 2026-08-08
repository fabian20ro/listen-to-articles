import { isLanguage, type Language } from './language-config.js';

/** Add new themes here — CSS must define matching [data-theme="<name>"] variables */
const THEMES = ['dark', 'light', 'khaki'] as const;
export type Theme = (typeof THEMES)[number];

export type VoiceGender = 'auto' | 'male' | 'female';

export interface AppSettings {
  rate: number;
  lang: 'auto' | Language;
  voiceName: string;
  voiceGender: VoiceGender;
  wakeLock: boolean;
  theme: Theme;
  deviceVoiceOnly: boolean;
}

export interface SettingsDefaults {
  defaultRate: number;
  defaultLang: 'auto' | Language;
}

const STORAGE_KEY = 'articlevoice-settings';

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

function clampRate(rate: unknown, fallback: number): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return fallback;
  return Math.max(0.5, Math.min(3.0, rate));
}

function toLang(value: unknown, fallback: 'auto' | Language): 'auto' | Language {
  if (value === 'auto' || isLanguage(value)) return value;
  return fallback;
}

function isVoiceGender(value: unknown): value is VoiceGender {
  return value === 'auto' || value === 'male' || value === 'female';
}

export function createDefaultSettings(defaults: SettingsDefaults): AppSettings {
  return {
    rate: defaults.defaultRate,
    lang: defaults.defaultLang,
    voiceName: '',
    voiceGender: 'auto',
    wakeLock: true,
    theme: 'dark',
    deviceVoiceOnly: false,
  };
}

export function loadSettings(defaults: SettingsDefaults): AppSettings {
  const fallback = createDefaultSettings(defaults);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const cleaned: AppSettings = {
      rate: clampRate(parsed.rate, fallback.rate),
      lang: toLang(parsed.lang, fallback.lang),
      voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : '',
      voiceGender: isVoiceGender(parsed.voiceGender) ? parsed.voiceGender : 'auto',
      wakeLock: typeof parsed.wakeLock === 'boolean' ? parsed.wakeLock : true,
      theme: isTheme(parsed.theme) ? parsed.theme : 'dark',
      deviceVoiceOnly: typeof parsed.deviceVoiceOnly === 'boolean' ? parsed.deviceVoiceOnly : false,
    };

    const defaultsMatch = (a: unknown, b: unknown): boolean => a === b;

    let needsWriteback = false;
    const parsedAny: Record<string, unknown> = { ...parsed };
    const cleanedAny: Record<string, unknown> = { ...cleaned };
    for (const key of Object.keys(parsed)) {
      if (parsedAny[key] !== cleanedAny[key]) {
        needsWriteback = true;
        break;
      }
    }

    if (needsWriteback) {
      saveSettings(cleaned);
    }

    return cleaned;
  } catch {
    try {
      saveSettings(fallback);
    } catch {
      // Ignore writeback failures; returning the default keeps the app usable.
    }
    return fallback;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Reset all settings to their default values by clearing custom storage.
 * Returns the newly created default settings object so callers can immediately use it.
 */
export function resetSettings(defaults: SettingsDefaults): AppSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to remove; fallback below keeps behavior safe.
  }
  return createDefaultSettings(defaults);
}
