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
    let status = document.querySelector<HTMLSpanElement>('[data-theme-status]');
    if (!status) {
      status = document.createElement('span');
      status.dataset.themeStatus = '';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.style.cssText =
        'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
      document.body.append(status);
    }
    status.textContent = `${resolved} theme active`;
  };

  const followSystem = () => {
    if (settings.theme === 'system') applyTheme();
  };
  darkScheme.addEventListener('change', followSystem);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== '`') return;
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
    document.querySelector('[data-theme-status]')?.remove();
  };
}
