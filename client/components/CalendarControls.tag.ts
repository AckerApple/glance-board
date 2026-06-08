import { button, div, form, h2, input, label, option, p, pre, section, select, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { calendar$ } from "../state.js";
import type { CalendarEvent } from "../types.js";

export const CalendarControls = tag(() =>
  subscribe(calendar$, ([state]) => {
    const status = state?.status ?? {};
    const selectedId = status.selectedCalendarId ?? state?.calendars.find((item) => item.primary)?.id ?? "";

    return section.attr("aria-labelledby", "googleCalendarTitle")(
      h2.id("googleCalendarTitle")("📅 Google Calendar"),
      p.class`muted`(state?.message ?? "Calendar: checking setup..."),
      div.class`display-actions`(
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.credentialsConfigured)).onClick(actions.signInCalendar)("Sign In"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.refreshCalendar)("Refresh"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.authenticated)).onClick(actions.disconnectCalendar)("Disconnect")
      ),
      form.class`credentials-form`.onSubmit((event: Event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void actions.saveCalendarCredentials({
          clientId: String(data.get("clientId") ?? ""),
          clientSecret: String(data.get("clientSecret") ?? ""),
          redirectUri: String(data.get("redirectUri") ?? "")
        });
      })(
        label.attr("for", "calendarClientId")("Client ID"),
        input.id("calendarClientId").name("clientId").type("text").attr("autocomplete", "off").attr("placeholder", "...apps.googleusercontent.com")(),
        label.attr("for", "calendarClientSecret")("Client Secret"),
        input.id("calendarClientSecret").name("clientSecret").type("password").attr("autocomplete", "off").attr("placeholder", "GOCSPX-...")(),
        label.attr("for", "calendarRedirectUri")("Redirect URI"),
        input.id("calendarRedirectUri").name("redirectUri").type("text").value((_: unknown) => status.redirectUri ?? "")(),
        button.type("submit").disabled((_: unknown) => Boolean(state?.busy))("Save Credentials")
      ),
      status.credentialsConfigured ? null : setupHelp(status.missingCredentials, status.redirectUri),
      div.class`calendar-setup`(
        label.attr("for", "calendarSelect")("Selected calendar"),
        select.id("calendarSelect").name("calendarId").value((_: unknown) => selectedId).disabled((_: unknown) => Boolean(state?.busy || !status.authenticated))(
          state?.calendars.map((calendar) =>
            option.value((_: unknown) => calendar.id)(`${calendar.summary}${calendar.primary ? " (primary)" : ""}`)
          )
        ),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.authenticated)).onClick(() => {
          const control = document.getElementById("calendarSelect");
          if (!(control instanceof HTMLSelectElement)) return;
          const selected = control.selectedOptions[0];
          if (selected) void actions.selectCalendar(selected.value, selected.textContent ?? selected.value);
        })("Save Calendar"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.authenticated)).onClick(() => {
          const control = document.getElementById("calendarSelect");
          if (control instanceof HTMLSelectElement) void actions.installCalendarItems(control.value);
        })("Install Rotation Items")
      ),
      div.class`calendar-events`(
        state?.events.length
          ? state.events.map(calendarEvent)
          : div(strong("EMPTY"), span(status.authenticated ? "No upcoming events" : "Sign in to preview events."))
      )
    );
  })
);

function setupHelp(missing: string[] | undefined, redirectUri: string | undefined) {
  return div.class`calendar-help`(
    strong(`Missing ${missing?.join(", ") ?? "Google Calendar credentials"}`),
    span("Create a Google OAuth Web application client, paste its values above, and save."),
    pre(`GOOGLE_CALENDAR_REDIRECT_URI=${redirectUri ?? "http://localhost:3010/api/google-calendar/auth/callback"}`)
  );
}

function calendarEvent(event: CalendarEvent) {
  return div(
    strong(formatEventStart(event)),
    span(`${isBirthdayEvent(event.title) ? "🎂 " : ""}${event.title ?? "Untitled"}`)
  );
}

function formatEventStart(event: CalendarEvent): string {
  if (!event.startTime) return "TIME";
  if (event.isAllDay) return "ALLDAY";
  return new Date(event.startTime).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function isBirthdayEvent(title: string | undefined): boolean {
  return /\b(bday|birth)/i.test(title ?? "");
}
