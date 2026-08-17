// Replaced in CI to a concrete release identifier.
export const APP_RELEASE = '__APP_RELEASE__';

/**
 * Returns a human-readable release identifier.
 *
 * Empty strings and the build-time marker `'__APP_RELEASE__'` collapse to `'dev'`;
 * real identifiers pass through unchanged.
 */
export function shortRelease(release: string): string {
  if (!release || !release.trim() || release === '__APP_RELEASE__') return 'dev';
  return release;
}
