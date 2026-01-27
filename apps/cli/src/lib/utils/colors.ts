/**
 * ANSI escape codes for terminal text styling.
 */

/**
 * Wrap text in ANSI dim escape codes for muted/secondary text.
 */
export const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;

/**
 * Wrap text in ANSI green escape codes for success/connected status.
 */
export const green = (text: string): string => `\x1b[32m${text}\x1b[39m`;

/**
 * Wrap text in ANSI yellow escape codes for warnings.
 */
export const yellow = (text: string): string => `\x1b[33m${text}\x1b[39m`;

/**
 * Wrap text in ANSI red escape codes for errors.
 */
export const red = (text: string): string => `\x1b[31m${text}\x1b[39m`;

/**
 * Wrap text in ANSI bold escape codes.
 */
export const bold = (text: string): string => `\x1b[1m${text}\x1b[22m`;
