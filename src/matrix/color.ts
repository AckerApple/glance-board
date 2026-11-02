/** Calendar RGB/RGBA hex; CalDAV alpha is discarded for the opaque LED display. */
export function normalizeCalendarColor(value: unknown): `#${string}` | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${[...hex.slice(1)].map(c => c + c).join("").toLowerCase()}`;
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return undefined;
  const rgb = hex.slice(0, 7).toLowerCase() as `#${string}`;
  // Black would make event text invisible; retain the standard display colors.
  return rgb === "#000000" ? undefined : rgb;
}
