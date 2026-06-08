# Glanceboard

A private local-first rotating display for sports, weather, calendar, fuel, astronomy, and other glanceable information on a 16x96 LED matrix.

## Quick Start

Requires Node.js 20 or newer.

```sh
npm install
cp config/display-items.example.json config/display-items.json
npm run dev
```

Open `http://localhost:3010`.

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

Rotation is controlled by `config/display-items.json`. The example configuration includes a 10-second rotation for NBA, NHL, NFL, local weather, current date/time, moon phase, and fuel averages.

Each item has an `enabled` flag. Disabled items stay in the file but are not resolved or displayed.

Supported display item types:

- `sports-live-score`
- `sports-next-game`
- `weather-current`
- `date-time`
- `moon-phase`
- `fuel-average`
- `google-calendar-next-event`
- `icloud-calendar-next-event`

The active configuration is local and ignored by Git. Commit changes to `config/display-items.example.json` when defaults should change.

## Google Calendar

Create a Google OAuth Web application client, enable the Google Calendar API, and authorize:

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

Google installs `google-calendar-next-1` through `google-calendar-next-3`.

## iCloud Calendar

Create an Apple app-specific password at [account.apple.com](https://account.apple.com/). Do not enter your normal Apple password into Glanceboard.

In the browser:

1. Open the **iCloud Calendar** panel.
2. Enter your Apple ID email and app-specific password.
3. Click **Connect** to discover available calendars.
4. Select a calendar and click **Save Calendar**.
5. Review the next three events, then click **Install Rotation Items**.

iCloud installs `icloud-calendar-next-1` through `icloud-calendar-next-3`, so Google and iCloud cards can rotate together. Credentials and selected-calendar settings remain server-side in ignored files:

```text
config/icloud-calendar-credentials.json
config/icloud-calendar.json
```

Upcoming iCloud events are cached for 60 seconds. Common daily, weekly, monthly, and yearly recurrence rules are expanded locally. Complex recurrence exceptions such as `EXDATE` and overridden `RECURRENCE-ID` instances are not fully reconciled yet.

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
