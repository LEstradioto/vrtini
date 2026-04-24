/**
 * Structured logger for CLI and library code.
 *
 * Log levels: debug < info < warn < error < silent
 *
 * Set VRT_LOG_LEVEL env var to control verbosity (default: "info").
 * All log output goes to stderr so it doesn't interfere with piped stdout.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function parseLevel(raw: string | undefined): LogLevel {
  const normalized = raw?.toLowerCase().trim();
  if (normalized && normalized in LEVEL_PRIORITY) return normalized as LogLevel;
  return 'info';
}

const currentLevel: LogLevel = parseLevel(process.env.VRT_LOG_LEVEL);
// Note: logger is loaded by env.ts itself, so we read process.env directly
// here to avoid a circular import. All other modules must go through env.ts.

function isEnabled(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

export const log = {
  debug(...args: unknown[]): void {
    if (isEnabled('debug')) console.error('[debug]', ...args);
  },
  info(...args: unknown[]): void {
    if (isEnabled('info')) console.error(...args);
  },
  warn(...args: unknown[]): void {
    if (isEnabled('warn')) console.error(...args);
  },
  error(...args: unknown[]): void {
    if (isEnabled('error')) console.error(...args);
  },
};
