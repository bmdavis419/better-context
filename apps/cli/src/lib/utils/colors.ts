/**
 * ANSI escape codes for terminal text styling.
 */

/**
 * Wrap text in ANSI dim escape codes for muted/secondary text.
 */
export const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
