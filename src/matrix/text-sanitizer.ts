export interface SanitizeDisplayTextOptions {
  preserveAmpersand?: boolean;
}

const REPLACEMENTS: Record<string, string> = {
  "@": " AT ",
  "&": " AND ",
  "+": " PLUS ",
  "’": "'",
  "`": "'",
  "‘": "'"
};

const SUPPORTED_DISPLAY_TEXT = /[^A-Z0-9 .:<>\-^%&']/g;

export function sanitizeDisplayText(value: string, fallback = " ", options: SanitizeDisplayTextOptions = {}): string {
  const replaced = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@&+’`‘]/g, (character) => options.preserveAmpersand && character === "&" ? " & " : REPLACEMENTS[character] ?? " ")
    .toUpperCase()
    .replace(SUPPORTED_DISPLAY_TEXT, " ")
    .replace(/\s+/g, " ")
    .trim();

  return replaced.length > 0 ? replaced : fallback;
}

export function sanitizeDisplayLines(lines: string[]): string[] {
  return lines.map((line) => sanitizeDisplayText(line));
}

export function fitDisplayLine(value: string, length = 10, options: SanitizeDisplayTextOptions = {}): string {
  return sanitizeDisplayText(value, " ", options).slice(0, length);
}
