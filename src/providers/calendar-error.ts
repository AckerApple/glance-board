// Only allowlisted descriptions leave the provider boundary. Never echo response bodies.
export function calendarFailure(error: unknown): { detail: string; lines: string[] } {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode);
  const message = error instanceof Error ? error.message : "";
  if (status === 401 || /invalid_grant|expired.*(token|sign.?in)|unauthorized/i.test(message)) {
    return { detail: "Sign-in expired; reconnect calendar in the app", lines: ["SIGN IN AGAIN", "OPEN APP"] };
  }
  if (status === 403 || /access denied|forbidden|insufficient.*permission/i.test(message)) {
    return { detail: "Access denied; check calendar permissions", lines: ["ACCESS DENIED", "CHECK ACCESS"] };
  }
  if (record.isNotConfigured === true) {
    return { detail: "Calendar setup required; open the app", lines: ["CAL SETUP", "OPEN APP"] };
  }
  if (/fetch failed|network|enotfound|eai_again|etimedout|econn|socket|dns/i.test(message)) {
    return { detail: "Network unavailable; retrying automatically", lines: ["NETWORK ERROR", "WILL RETRY"] };
  }
  return { detail: "Calendar request failed; retrying automatically", lines: [] };
}

export class CalendarRequestError extends Error {
  constructor(public readonly status: number, code?: string) {
    super(code === "invalid_grant" ? "invalid_grant" : `Calendar request failed: HTTP ${status}`);
  }
}
