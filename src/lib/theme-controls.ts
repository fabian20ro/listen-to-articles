import { saveSettings, THEMES, type AppSettings, type Theme } from './settings-store.js';
import { updateSegmentButtons } from './ui-helpers.js';

/** Bind the theme preference separately from the resolved OS color scheme. */
export function bindThemeControls(
  buttons: NodeListOf<HTMLButtonElement>, settings: AppSettings,
): () => void {
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = () => {
    const resolved = settings.theme === 'system'
      ? (darkScheme.matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.setAttribute('data-theme', resolved);
    updateSegmentButtons(buttons, settings.theme);
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === settings.theme));
    });
  };

  const followSystem = () => {
    if (settings.theme === 'system') applyTheme();
  };
  darkScheme.addEventListener('change', followSystem);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Backquote') return;
    const index = THEMES.indexOf(settings.theme);
    settings.theme = THEMES[(index + 1) % THEMES.length];
    applyTheme();
    saveSettings(settings);
  };
  document.addEventListener('keydown', onKey);

  const handlers = Array.from(buttons, (button) => {
    const select = () => {
      settings.theme = button.dataset.value as Theme;
      applyTheme();
      saveSettings(settings);
    };
    button.addEventListener('click', select);
    return () => button.removeEventListener('click', select);
  });
  applyTheme();

  return () => {
    darkScheme.removeEventListener('change', followSystem);
    document.removeEventListener('keydown', onKey);
    handlers.forEach((remove) => remove());
  };
}
