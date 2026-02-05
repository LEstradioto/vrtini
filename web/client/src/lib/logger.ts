/**
 * Client-side structured logger.
 * Provides consistent log interface matching the server-side logger.
 * All methods delegate to console but can be extended with remote logging.
 */
export const log = {
  debug(...args: unknown[]): void {
    console.debug(...args);
  },
  info(...args: unknown[]): void {
    console.log(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
