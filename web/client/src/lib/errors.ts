/**
 * Standardized error message extraction for client-side code.
 * Mirror of src/core/errors.ts for use in Svelte components.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
