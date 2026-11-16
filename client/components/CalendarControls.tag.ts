import { a, button, details, div, form, h2, h3, li, ol, input, label, option, p, pre, section, select, span, strong, subscribe, summary, tag } from "taggedjs";
import { actions } from "../controller.js";
import { calendar$, type CalendarState } from "../state.js";
import type { CalendarEvent } from "../types.js";

export const CalendarControls = tag(() =>
  subscribe(calendar$, ([state]) => GoogleCalendarPanel(state))
);

export const GoogleCalendarPanel = tag((state: CalendarState) => {
    let status = state.status;
    let selectedIds = status.selectedCalendarIds ?? (status.selectedCalendarId ? [status.selectedCalendarId] : []);
    GoogleCalendarPanel.inputs(([nextState]) => {
      state = nextState;
      status = state.status;
      selectedIds = status.selectedCalendarIds ?? (status.selectedCalendarId ? [status.selectedCalendarId] : []);
    });

    return section.class`calendar-provider-card`.attr("aria-labelledby", "googleCalendarTitle")(
      h2.id("googleCalendarTitle")("📅 Google Calendar"),
      p("Connect your Google account, allow read-only access, then choose the calendars to show. Glanceboard cannot edit or delete your Google events."),
      p.class`google-setup-status`(() => status.credentialsConfigured ? "✓ Google setup saved on this board. Your keys stay private; blank credential fields do not mean they were lost." : "Google app setup has not been saved on this board yet."),
      p.class`google-account-status`(() => status.authenticated
        ? status.accountEmail ? `Signed in as ${status.accountEmail}` : "Google sign-in saved. Reconnect once to display your account email."
        : "Not signed in to Google."),
      p.class`muted`.attr("role", "status")(() => state.message),
      p.class`google-calendar-notice`.attr("hidden", () => status.credentialsConfigured !== false)("Google sign-in isn’t enabled on this board yet. Ask the board owner to enable it; you don’t need to create a Google Cloud project."),
      div.class`display-actions`(
        button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.credentialsConfigured)).onClick(actions.signInCalendar)(() => status.authenticated ? "Change account / reconnect" : "Connect Google Calendar"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.refreshCalendar)("Refresh"),
        button.type("button").attr("hidden", () => !status.authenticated && !state.busy && !state.disconnecting).disabled((_: unknown) => Boolean(state?.disconnecting)).onClick(actions.disconnectCalendar)("Disconnect from Glanceboard"),
        button.type("button").attr("hidden", () => !state.busy).disabled(() => !state.busy || Boolean(state.disconnecting)).onClick(actions.cancelCalendarRequest)("Cancel Request")
      ),
      p.class`muted`(() => status.authenticated
        ? "Disconnect removes the saved tokens from this Glanceboard server. To revoke Google’s permission as well, use your Google account’s connections page below."
        : "Choose your account on Google and allow Calendar access. You never need to enter your Google password or tokens here."),
      div.attr("hidden", () => !status.authenticated)(
        h3("Choose what to show"),
        div.class`google-calendar-discovery-error`.attr("role", "alert").attr("hidden", () => state.discoveryState !== "error")(
          p(() => state.discoveryError ?? "Calendar discovery failed. Try Refresh."),
          a.href(() => state.setupUrl ?? "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com").target("_blank").attr("rel", "noopener noreferrer").attr("hidden", () => !state.setupUrl)("Enable Google Calendar API for this project"),
          p("After fixing the problem, choose Refresh. Your saved keys and sign-in do not need to be entered again for an API-enable fix.")
        ),
        div.class`calendar-setup`(
          label.attr("for", "calendarSelect")("Selected calendars"),
          select.id("calendarSelect").name("calendarIds").attr("multiple", true).attr("size", 5).onChange((event: Event) => {
            const control = event.target as HTMLSelectElement;
            selectedIds = Array.from(control.selectedOptions).map(option => option.value).filter(Boolean);
            void actions.selectCalendar(selectedIds);
          }).disabled((_: unknown) => Boolean(state?.busy || !status.authenticated || !state.calendars.length))(
            option.value("").disabled(true).selected(() => !selectedIds.length)(() =>
              state.discoveryState === "loading" ? "Loading calendars…" : state.discoveryState === "error" ? "Calendar list unavailable — see error below" : !state.calendars.length ? "No calendars available" : "Choose a calendar…"),
            () => state.calendars.map((calendar) =>
              option.value((_: unknown) => calendar.id).selected(() => selectedIds.includes(calendar.id))(() => `${calendar.summary}${calendar.primary ? " (primary)" : ""}`).key(calendar.id)
            )
          ),
          button.type("button").disabled((_: unknown) => Boolean(state?.busy || !status.authenticated || !selectedIds.length)).onClick(() => {
            const control = document.getElementById("calendarSelect");
            if (control instanceof HTMLSelectElement) void actions.installCalendarItems();
          })("Show on Glance Board"),
          button.type("button").disabled(() => Boolean(state.busy || !status.authenticated || !selectedIds.length)).onClick(() => actions.selectCalendar([]))("Clear selection"),
          button.type("button").disabled(() => Boolean(state.busy || !status.displayEnabled)).onClick(actions.hideGoogleCalendarItems)("Hide from Glance Board")
        ),
        p.class`muted`("Select multiple calendars with Ctrl/Command-click. Clear selection removes all calendars from the event list."),
        p.class`muted`(() => !selectedIds.length ? "Choose calendars to show upcoming events on your board." : status.displayEnabled ? "Google Calendar is showing on your board. Up to three upcoming events rotate automatically." : "Google Calendar is hidden from your board. Choose Show on Glance Board to enable it."),
        h3("Upcoming events preview"),
        div.class`calendar-events`(
          () => state.events.length
            ? state.events.map((event, index) => calendarEvent(event).key(JSON.stringify([event.calendarId, event.id ?? index, event.startTime])))
            : div(strong("EMPTY"), span(() => status.authenticated ? status.selectedCalendarId ? "No upcoming events in the selected calendars." : "Choose calendars to preview upcoming events." : "Connect Google Calendar to preview events."))
        ),
      ),
      details.class`google-calendar-help`(
        summary("Connection help & Google account settings"),
        p("Sign-in expired? Reconnect your account. A Google app in external Testing mode can require reconnecting after seven days."),
        p("If your account is managed by work or school, your administrator may need to allow Calendar access."),
        p("Most connection problems can be fixed with Change account / reconnect. If Google says this app is blocked, contact the board owner."),
        p("If Google reports a redirect-address error or the calendar list cannot load, ask the board owner to check the Google connection settings. For a localhost connection, sign in on the computer running Glanceboard."),
        googleLink("https://myaccount.google.com/connections", "Manage Glanceboard’s access in your Google account"),
        googleLink("https://developers.google.com/identity/protocols/oauth2", "Google’s OAuth and token-expiration guide")
      ),
      details.class`google-calendar-config`(
        summary("Board owner settings · Google connection setup"),
        setupHelp(() => status.redirectUri),
        p.class`muted`(() => status.credentialsSource === "env"
          ? "Google app credentials are configured in the server environment. Update those server settings to change them."
          : status.credentialsConfigured ? "Google app setup is saved. You only need this form when changing your OAuth client." : "Complete this setup once, then use Connect Google Calendar below."),
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
          input.id("calendarClientId").name("clientId").type("text").attr("required", true).attr("autocomplete", "off").attr("placeholder", "...apps.googleusercontent.com")(),
          label.attr("for", "calendarClientSecret")("Client Secret"),
          input.id("calendarClientSecret").name("clientSecret").type("password").attr("required", true).attr("autocomplete", "off").attr("placeholder", "GOCSPX-...")(),
          label.attr("for", "calendarRedirectUri")("Redirect URI"),
          input.id("calendarRedirectUri").name("redirectUri").type("text").value((_: unknown) => status.redirectUri ?? "")(),
          button.type("submit").disabled((_: unknown) => Boolean(state?.busy || status.credentialsSource === "env"))("Save Google app setup")
        )
      ),
    );
});

function googleLink(url: string, text: string) {
  return a.href(url).target("_blank").attr("rel", "noopener noreferrer")(text);
}

function setupHelp(redirectUri: () => string | undefined) {
  return div.class`google-calendar-guide`(
    p("This private, self-hosted app needs a Google OAuth client once. It identifies Glanceboard to Google; it is separate from your Google account login. You do not need to paste access tokens or refresh tokens."),
    ol(
      li("Create or choose a Cloud project. ", googleLink("https://console.cloud.google.com/projectselector2/home/dashboard", "Open Google Cloud")),
      li("Enable the Google Calendar API in that project. ", googleLink("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", "Enable Calendar API")),
      li("Configure Google Auth Platform’s Branding and Audience. For a personal external app in Testing, add your own Google email as a test user. ", googleLink("https://console.cloud.google.com/auth/overview", "Open Google Auth Platform")),
      li("Create an OAuth client with application type Web application. Add the exact address below to Authorized redirect URIs. ", googleLink("https://console.cloud.google.com/auth/clients", "Open OAuth clients")),
      li("Copy that client’s ID and secret into the form below and save. Then continue with Connect Google Calendar.")
    ),
    strong("Authorized redirect URI — copy this exact address"),
    pre(() => redirectUri() ?? "Loading redirect address…"),
    p("Use the same Cloud project for the API, consent screen, and OAuth client. Keep the client secret private; it is saved on this server and never sent back to the browser."),
    googleLink("https://developers.google.com/identity/protocols/oauth2/web-server", "Google’s official web-server setup guide")
  );
}

function calendarEvent(event: CalendarEvent) {
  return div(
    strong(() => formatEventStart(event)),
    span(() => `${isBirthdayEvent(event.title) ? "🎂 " : ""}${event.title ?? "Untitled"}`)
  );
}

function formatEventStart(event: CalendarEvent): string {
  if (!event.startTime) return "TIME";
  if (event.isAllDay) return `${formatEventDate(event.startTime)} ALLDAY`;
  return new Date(event.startTime).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatEventDate(startTime: string): string {
  return new Date(startTime).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function isBirthdayEvent(title: string | undefined): boolean {
  return /\b(bday|birth)/i.test(title ?? "");
}
