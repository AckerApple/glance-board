# Changelog

## Unreleased

### Added

- Added `CHANGELOG.md` so completed TODO work is tracked in one place.
- Added display item category support in rotation config JSON, including default categories for Sports, Calendar, Local Info, Time, and Moon.
- Added a category dropdown to configured rotation items so items can be assigned to known categories.
- Added a shared 16x96 scroll-down animation frame generator for the requested 2-second transition between rotation screens.

### Changed

- Existing display item configs now load with inferred categories when `categoryId` is missing.
- The example display-items config now documents the category JSON shape.

### Previously Completed

- Moved the 16x96 Dot Matrix Preview section to the top of the browser display.
- Added raw/parsed data panels behind the active rotation screen in the browser.
- Fixed iCloud calendar setup so the saved Apple ID/email and event show count are reflected by the UI.
- Converted calendar event text `AND` to `&` for tighter dot matrix titles.
- Updated the birthday cake dot matrix icon with the requested white dot.
- Changed the NBA no-game fallback to show the upcoming NBA game screen instead of `NO NBA GAME`.
- Added item freshness and update interval display for configured rotation items.
- Added per-item refresh caching intervals for calendar, sports, moon, weather, date/time, and fuel displays.
- Updated weather display data to include current, low, high, humidity percent, and sunny/cloud icon selection.

### Remaining

- Wire generated transition frames into the hardware sender once the BLE program timing is confirmed for multi-frame uploads.
- Build category section display, drag/drop item assignment, and category title cards.
- Decide and implement websocket syncing for keeping the browser preview and backend hardware rotation in lockstep.
