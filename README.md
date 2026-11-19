# Glanceboard

A private local-first rotating display for sports, weather, calendar, fuel, astronomy, and other glanceable information on a 16x96 LED matrix.

## Quick Start

Requires Node.js 20 or newer.

```sh
npm install
cp config/display-items.example.json config/display-items.json
npm run dev
```

Open `http://localhost:3010`. Use **🏠 Home** for the rotating display and device controls, and **🗓️ Calendars** for Google and iCloud setup, calendar selection, event previews, and installing calendar rotation items. The Calendars page can be bookmarked at `http://localhost:3010/#/calendars`; refresh and browser Back/Forward preserve the selected page.

## Commands

```sh
npm run dev
npm run typecheck
npm test
npm run build
npm start
npm run check
```

`npm run dev` runs the TypeScript server with Vite middleware. `npm run build` compiles the server and builds the TaggedJS client into `dist/public`. `npm start` runs the compiled server.

## Configuration

Rotation is controlled by `config/display-items.json`. The example configuration includes a 10-second rotation for NBA, NHL, NFL, MLB, local weather, current date/time, moon phase, fuel averages, and internet status.

Each item has an `enabled` flag. Disabled items stay in the file but are not resolved or displayed.

Supported display item types:

- `sports-live-score`
- `sports-next-game`
- `weather-current`
- `date-time`
- `moon-phase`
- `fuel-average`
- `internet-status`
- `google-calendar-next-event`
- `icloud-calendar-next-event`

The active configuration is local and ignored by Git. Commit changes to `config/display-items.example.json` when defaults should change.

## Google Calendar

The normal Calendars flow is **Connect Google Calendar → approve read-only access on Google → choose a calendar → Show on Glance Board**. Calendar selection saves and previews automatically. **Hide from Glance Board** disables Google display items while keeping the account connected; it leaves iCloud and other displays alone. Application credentials belong to the board owner and are kept under the collapsed **Board owner settings** section, never a regular-user setup wizard. If the owner has not configured them, users see a clear unavailable message instead of being sent to Google Cloud. Google sign-in generates the access and refresh tokens automatically; do not paste tokens into the app. Tokens remain on the server and refresh automatically while Google permits access.

Create a Cloud project, enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), configure [Google Auth Platform](https://console.cloud.google.com/auth/overview) (including your email as a test user for a personal external Testing app), then create a **Web application** [OAuth client](https://console.cloud.google.com/auth/clients). Authorize the exact redirect URI shown in Board owner settings, normally:

```text
http://localhost:3010/api/google-calendar/auth/callback
```

Paste the client ID and client secret into the browser setup form. Credentials and tokens remain server-side in ignored files:

```text
config/google-calendar-credentials.json
config/google-calendar-token.json
```

You may instead use `.env.local`:

```sh
GOOGLE_CALENDAR_CLIENT_ID=your-client-id
GOOGLE_CALENDAR_CLIENT_SECRET=your-client-secret
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3010/api/google-calendar/auth/callback
```

Select one or more calendars (Ctrl/Command-click to select multiple); selection changes save automatically. **Show on Glance Board** installs `google-calendar-next-1` through `google-calendar-next-3`. Changing the selection updates the preview and any installed Google items without changing whether they are enabled. Events from selected calendars are merged chronologically and retain each source calendar’s color. **Clear selection** removes all calendars; calendar cards return to the setup state until calendars are selected again. Existing single-calendar settings continue to work.

After consent, Google returns you directly to Calendars. Cancelling or an expired sign-in shows a safe explanation with a link back. Sign-in attempts expire after ten minutes and are invalidated by Disconnect. Disconnect clears local tokens; to revoke the permission at Google too, use [Google account connections](https://myaccount.google.com/connections). External OAuth apps in Testing can require reconnection after seven days; see [Google’s token-expiration guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

For a `redirect_uri_mismatch`, make the Google client’s Authorized redirect URI match Board owner settings exactly. A localhost callback must be opened on the computer running this server. If Calendar access is blocked, check the API, test-user list, and any Workspace administrator policy.

## iCloud Calendar

Create an Apple app-specific password at [account.apple.com](https://account.apple.com/). Do not enter your normal Apple password into Glanceboard.

In the browser:

1. Open the **iCloud Calendar** panel.
2. Enter your Apple ID email and app-specific password.
3. Click **Connect** to discover available calendars.
4. Select one or more calendars (Ctrl/Command-click for multiple) and click **Save Calendars**. The preview and installed cards use one chronological list, retaining each source calendar’s color. Use **Clear selection** to remove all calendars.
5. Review the next three events, then click **Install Rotation Items**.

iCloud installs `icloud-calendar-next-1` through `icloud-calendar-next-3`, so Google and iCloud cards can rotate together. Credentials and selected-calendar settings remain server-side in ignored files:

```text
config/icloud-calendar-credentials.json
config/icloud-calendar.json
```

Upcoming iCloud events are cached for 60 seconds. Common daily, weekly, monthly, and yearly recurrence rules are expanded locally. Complex recurrence exceptions such as `EXDATE` and overridden `RECURRENCE-ID` instances are not fully reconciled yet.

### Removed calendar sources

Glanceboard automatically removes installer-owned calendar rotation slots whose saved source or connection no longer exists. Cleanup runs on startup and calendar selection/disconnect; every rotation config load also excludes these orphaned slots, so a cached slide cannot keep rotating. Remaining sources, manually named calendar slots, and non-calendar displays are preserved. An unreadable or malformed source file is treated as unknown, not deleted.

Before changing the saved display list, cleanup saves the complete previous JSON beside it as `display-items.json.calendar-cleanup-*.bak`. No events are deleted from Google or iCloud. After updating an already-running server, restart it normally to activate startup reconciliation, then reload the browser. The physical display must reconnect and receive a new frame to replace an old uploaded program.

## Architecture

- `src/providers`: external and calculated data providers.
- `src/rotation`: display item configuration, normalization, and rotation.
- `src/matrix`: generic matrix primitives, font, sanitizer, icons, and card rendering.
- `src/hardware/coolleduX`: CoolLEDUX BLE transport and upload protocol.
- `src/server`: local API, hardware controller, and process entrypoint.
- `client`: TaggedJS browser controls, state, API actions, and 16x96 preview.

Glanceboard owns its matrix and hardware code. It does not import files from BigScoring and does not use a submodule or shared npm package.

## Hardware

The default device name is `CoolLEDUX-01DF`. Override discovery with:

```sh
LED_DEVICE_NAME=CoolLEDUX-01DF npm run dev
LED_DEVICE_ID=your-device-id npm run dev
```

The browser can connect, send the visible card, control intensity, and resend the current screen every second while auto-send is enabled.

For transition animation protocol notes, timing constraints, fast BLE transport settings, and the working mixed-delay recipe, see [docs/animation.md](docs/animation.md).

## Secret Safety

The following are ignored:

- `.env.local`
- active display configuration
- Google selected-calendar settings
- Google OAuth client credentials
- Google OAuth tokens
- iCloud app-specific credentials and selected-calendar settings
- browser form settings
- logs and build output

Secrets are never returned by status APIs or included in browser debug output.
