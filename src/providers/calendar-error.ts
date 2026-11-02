// Only allowlisted descriptions leave the provider boundary. Never echo response bodies.
export function calendarFailure(error: unknown): { detail: string; lines: string[] } {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode);
  const message = error instanceof Error ? error.message : "";
  if (record.code === "api_disabled") return { detail: "Google Calendar API is disabled for this app’s Cloud project. Enable the API, then choose Refresh.", lines: ["API DISABLED", "ENABLE API"] };
  if (record.code === "insufficient_scope") return { detail: "Calendar permission is missing. Reconnect and approve read-only Calendar access.", lines: ["ALLOW ACCESS", "RECONNECT"] };
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
  readonly code?: string;
  constructor(public readonly status: number, code?: string, public readonly setupUrl?: string) {
    super(code === "invalid_grant" ? "invalid_grant" : `Calendar request failed: HTTP ${status}`);
    this.code = ["invalid_grant", "api_disabled", "insufficient_scope"].includes(code ?? "") ? code : undefined;
  }
}

// Inspect only known Google error codes and a numeric project identifier.
// Never return arbitrary error messages, payloads, or provider-supplied URLs.
export function googleCalendarRequestError(status: number, payload: unknown): CalendarRequestError {
  const data = payload as { error?: { errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string; metadata?: { consumer?: string } }> } } | undefined;
  const errors = Array.isArray(data?.error?.errors) ? data.error.errors : [];
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const reasons = [...errors, ...details].map(entry => entry?.reason);
  if (reasons.some(reason => reason === "accessNotConfigured" || reason === "SERVICE_DISABLED")) {
    const project = details.map(entry => {
      const consumer = entry?.metadata?.consumer;
      return typeof consumer === "string" ? consumer.match(/^projects\/(\d+)$/)?.[1] : undefined;
    }).find(Boolean);
    return new CalendarRequestError(status, "api_disabled", `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${project ? `?project=${project}` : ""}`);
  }
  if (reasons.some(reason => reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return new CalendarRequestError(status, "insufficient_scope");
  return new CalendarRequestError(status);
}
