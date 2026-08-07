/**
 * Structured logger — lightweight console wrapper with levels and module tags.
 *
 * In production (no ?debug query param) only warn and error are output.
 * In development (?debug in URL) all levels are active.
 */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

let isVerbose =
  typeof location !== 'undefined' && (location.search.includes('debug') || location.search.includes('trace'));

export function setMinLevel(level: LogLevel): void {
  const priority = LEVEL_PRIORITY[level];
  if (priority === undefined || priority === null) {
    throw new Error(`setMinLevel: invalid log level "${level}". Expected one of: trace, debug, info, warn, error`);
  }
  minLevelRef.current = level;
  isVerbose = true;
}

let minLevelRef = { current: ('warn' as unknown) as LogLevel };

// Initialize after DOM is ready so location.search is populated.
if (typeof document !== 'undefined') {
  const parsed = new URLSearchParams(location.search);
  if (parsed.has('debug') || parsed.has('trace')) {
    minLevelRef.current = 'trace';
    isVerbose = true;
  }
}

function getMinLevel(): LogLevel {
  return minLevelRef.current;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function formatPrefix(module: string): string {
  return `[${module}]`;
}

export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
  const getPrefix = () => {
    const base = `[${module}]`;
    if (isVerbose) {
      const now = new Date();
      const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      return `${base} ${ts}`;
    }
    return base;
  };

  return {
    trace(msg, ...args) {
      if (shouldLog('trace')) console.debug(getPrefix(), msg, ...args);
    },
    debug(msg, ...args) {
      if (shouldLog('debug')) console.debug(getPrefix(), msg, ...args);
    },
    info(msg, ...args) {
      if (shouldLog('info')) console.info(getPrefix(), msg, ...args);
    },
    warn(msg, ...args) {
      if (shouldLog('warn')) console.warn(getPrefix(), msg, ...args);
    },
    error(msg, ...args) {
      if (shouldLog('error')) console.error(getPrefix(), msg, ...args);
    },
  };
}
