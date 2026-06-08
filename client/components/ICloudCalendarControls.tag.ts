import { a, button, div, form, h2, input, label, option, p, section, select, small, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { icloudCalendar$ } from "../state.js";
import type { CalendarEvent } from "../types.js";

export const ICloudCalendarControls = tag(() =>
  subscribe(icloudCalendar$, ([state]) => {
    const status = state?.status ?? {};
    const selectedId = status.selectedCalendarId ?? "";
    const eventShowCount = status.eventShowCount ?? 3;

    return section.attr("aria-labelledby", "icloudCalendarTitle")(
      h2.id("icloudCalendarTitle")("🍎 🗓️ iCloud Calendar"),
      p.class`muted`(state?.message ?? "iCloud Calendar: checking setup..."),
      div.class`calendar-security-note`(
        strong("Use an Apple app-specific password, not your normal Apple password."),
        span(
          " Sign in at account.apple.com, then open Sign-In and Security → App-Specific Passwords. ",
          a
            .href("https://support.apple.com/102654")
            .target("_blank")
            .attr("rel", "noreferrer")(
              "How to create one"
            )
        )
      ),
      form.class`credentials-form`.onSubmit((event: Event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void actions.connectICloudCalendar({
          appleId: String(data.get("appleId") ?? ""),
          appSpecificPassword: String(data.get("appSpecificPassword") ?? "")
        });
      })(
        label.attr("for", "icloudAppleId")("Apple ID email"),
        input
          .id("icloudAppleId")
          .name("appleId")
          .type("email")
          .attr("autocomplete", "username")
          .attr("placeholder", "you@example.com")
          .value((_: unknown) => status.appleId ?? "")
          .disabled((_: unknown) => Boolean(state?.busy))(),
        label.attr("for", "icloudAppPassword")("App-specific password"),
        input
          .id("icloudAppPassword")
          .name("appSpecificPassword")
          .type("password")
          .attr("autocomplete", "current-password")
          .attr("placeholder", "xxxx-xxxx-xxxx-xxxx")
          .disabled((_: unknown) => Boolean(state?.busy))(),
        button.type("submit").disabled((_: unknown) => Boolean(state?.busy))("Connect")
      ),
      div.class`display-actions`(
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.refreshICloudCalendar)("Refresh"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.connected)).onClick(actions.disconnectICloudCalendar)("Disconnect")
      ),
      div.class`calendar-setup`(
        label.class`calendar-select-label`.attr("for", "icloudCalendarSelect")("Selected iCloud calendar"),
        label.class`event-count-label`.attr("for", "icloudEventShowCount")("Event Show Count"),
        select
          .id("icloudCalendarSelect")
          .class`calendar-select-control`
          .name("calendarId")
          .value((_: unknown) => selectedId)
          .disabled((_: unknown) => Boolean(state?.busy || !status.connected))(
            state?.calendars.map((calendar) => option.value((_: unknown) => calendar.id)(calendar.summary))
          ),
        input
          .id("icloudEventShowCount")
          .class`event-count-control`
          .name("eventShowCount")
          .type("number")
          .attr("min", "1")
          .attr("max", "10")
          .attr("step", "1")
          .value((_: unknown) => String(eventShowCount))
          .disabled((_: unknown) => Boolean(state?.busy || !status.connected))(),
        button.class`save-calendar-control`.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.connected)).onClick(() => {
          const control = document.getElementById("icloudCalendarSelect");
          const countControl = document.getElementById("icloudEventShowCount");
          if (!(control instanceof HTMLSelectElement)) return;
          const selected = control.selectedOptions[0];
          const count = countControl instanceof HTMLInputElement ? Number(countControl.value) : 3;
          if (selected) void actions.selectICloudCalendar(selected.value, selected.textContent ?? selected.value, count);
        })("Save Calendar"),
        button.class`install-calendar-control`.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.selectedCalendarId)).onClick(() => {
          const control = document.getElementById("icloudCalendarSelect");
          const countControl = document.getElementById("icloudEventShowCount");
          const count = countControl instanceof HTMLInputElement ? Number(countControl.value) : 3;
          if (control instanceof HTMLSelectElement) void actions.installICloudCalendarItems(control.value, count);
        })("Install Rotation Items")
      ),
      div.class`calendar-events`(
        state?.events.length
          ? state.events.map(calendarEvent)
          : div(strong("EMPTY"), span(status.selectedCalendarId ? "No upcoming events" : "Select a calendar to preview events."))
      ),
      small.class`muted`("Credentials and selected calendar settings remain on this Glanceboard server.")
    );
  })
);

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
