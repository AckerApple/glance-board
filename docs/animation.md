# CoolLEDUX Animation Notes

These notes capture the working animation behavior for the 16x96 CoolLEDUX display used by Glanceboard.

## Working Pattern

Use an animation program content block (`0x03`) for the transition frames. The animation program should include enough final-frame delay that the destination screen remains stable, then a delayed static graffiti frame (`0x02`) should latch the destination screen after the visible animation has had time to finish.

The important details are:

- Animation frames do not all need the same delay.
- Transition uploads must use the fast BLE transport path.
- Final-frame delays must include both the intended display time and the expected BLE upload time for the next command.

The reliable transition recipe is:

1. Render the current and next cards as 16x96 matrices.
2. Generate scroll-down transition frames.
3. Send motion frames with a short delay.
4. Append repeated copies of the final frame.
5. Give those final-frame copies a longer delay so the destination screen visibly settles.
6. Wait briefly after upload so the device can play the visible motion.
7. Upload the destination screen as a static graffiti program a couple of times.

The longer final-frame delays were the first key. The second key was removing conservative BLE write pacing for animation-related static uploads while keeping light pacing for multi-frame animation uploads. Static confirms should happen after the animation has had time to play; sending them immediately can interrupt the animation before the device has rendered it.

## Fast Transport Path

The slow/default upload path is intentionally conservative:

- `50ms` delay between 20-byte BLE writes
- `300ms` delay between packets
- `3000ms` settle delay after upload
- optional notification subscription

That is useful for protocol probing, but it is far too slow for rotation animation. Multi-frame programs can take 15-20 seconds with those delays.

Static animation-related uploads use `ANIMATION_UPLOAD_OPTIONS` in `src/hardware/coolleduX/CoolLedUxDisplay.ts`:

```ts
const ANIMATION_UPLOAD_OPTIONS = {
  packetDelayMs: 0,
  quiet: true,
  settleMs: 0,
  subscribe: false,
  writeDelayMs: 0
};
```

Use that fully fast path for:

- first-screen quick sends
- final static confirms
- sequence-mode frame uploads

Multi-frame animation program uploads need light pacing. The fully fast path can write larger animation payloads too aggressively for the device to play reliably. Use `MULTIFRAME_UPLOAD_OPTIONS` for `sendMatrices()` and program+static transition uploads:

```ts
const MULTIFRAME_UPLOAD_OPTIONS = {
  packetDelayMs: 120,
  quiet: true,
  settleMs: 300,
  subscribe: false,
  writeDelayMs: 12
};
```

This is the middle ground between the original slow path, which could take roughly `18s`, and the fully fast path, which could upload in about `150ms` but caused animations to stop playing.

The normal `📤 sent "..." Nms` log means the BLE write calls completed locally. It is not a device-render acknowledgement. This display primarily accepts `writeWithoutResponse`, so the OS/BLE stack can report successful writes even when the device later drops, ignores, or fails to render the program. Use audit mode when chasing that distinction:

```sh
GLANCEBOARD_BLE_AUDIT=true npm run dev
```

Audit mode subscribes to notification-capable characteristics, logs any notification frames received during uploads, and logs the exact packet/write index if a BLE write throws.

All device writes are serialized and generation-checked:

- `DotMatrixController` queues full display operations, including startup probes, sleeps, rotation transitions, and manual sends.
- `CoolLedUxDisplay` queues raw BLE uploads and logs how many milliseconds each upload took.
- Unexpected disconnects increment a connection generation. Any operation that began on an older generation is cancelled and must not report success or advance rotation.

This keeps manual API sends, startup animation probes, static confirms, and backend rotation from writing to the display at the same time.

## Current Rotation Timing

`src/server/display.ts` currently uses:

- Normal motion frame delay: `70ms`
- Fast-pass motion frame delay: `45ms`
- Final-frame tail count: `2`
- Normal final-frame settle delay: `500ms`
- Fast final-frame settle delay: `350ms`
- Final-frame window: current slide duration plus a `5000ms` upload budget and `1500ms` safety margin
- Transition static confirms: two quick destination-frame uploads, delayed `1500ms` after animation upload completes

For a typical fast-pass transition, the first animation loop is roughly:

- `0.36s` of visible motion
- `0.35s` settling on the destination screen
- `9.5s` final-frame window before the animation can loop

Normal transitions avoid sending static-confirm commands immediately while the animation program is starting. After upload completes, the backend waits `1500ms`, then sends the destination static frame twice. This gives the visible motion time to play, then replaces the looping animation program with a stable static screen before repeated animation loops can appear on the display.

Startup always sends a static `LOADING...` screen before the first real card, then runs a short loading-dot animation so program animation playback can be verified at boot. A louder full-matrix probe can optionally run between the loading dots and the first card:

```sh
GLANCEBOARD_STARTUP_ANIMATION_PROBE=true npm run dev
```

Startup sequence:

1. Send a static `LOADING...` screen.
2. Repeat that static send three times with `100ms` between sends, so a fresh BLE connection has multiple chances to latch the first screen.
3. Hold it for `3000ms`.
4. Send an obvious three-dot loading animation for `3000ms`.
5. If `GLANCEBOARD_STARTUP_ANIMATION_PROBE=true`, send an obvious full-matrix yellow/white wipe animation for `3000ms`.
6. Send the first real card as a static screen, also repeated three times.

This isolates program-animation behavior from transition rendering and static-confirm timing. If the loading dots or optional wipe do not animate, the issue is in multi-frame program playback, encoding, or transport rather than card-to-card transition composition.

## Important Constraints

Each 96x16 RGB444 frame is about `3 KB` before protocol overhead:

```text
96 columns * 16 rows * 2 bytes = 3072 bytes
```

Large animation programs can silently wedge or fail to advance the display. A 56-frame animation was too large and caused the backend send to stall. The protocol builder now rejects raw programs larger than `65,536` bytes.

## Things That Did Not Work

- Sending each frame as a separate static matrix upload worked, but looked jarring on slower machines or BLE conditions.
- Sending multiple graffiti/static content blocks in one program uploaded successfully but did not animate.
- Sending animation content followed by static content in the same program resulted in no visible animation on this device.
- Adding many repeated final frames with the same short delay made the animation loop several times before the static screen arrived.

## Useful Environment Flags

Use sequence mode as a fallback if program animation regresses:

```sh
GLANCEBOARD_TRANSITION_UPLOAD=sequence npm run dev
```

Enable detailed BLE upload logs only when debugging protocol writes:

```sh
GLANCEBOARD_DISPLAY_VERBOSE=true npm run dev
```

## Code Pointers

- Frame generation: `src/matrix/animation.ts`
- Rotation transition timing: `src/server/display.ts`
- BLE display sender: `src/hardware/coolleduX/CoolLedUxDisplay.ts`
- Protocol encoding: `src/hardware/coolleduX/coolleduXProtocol.ts`
- Protocol tests: `test/coolleduX-protocol.test.ts`
