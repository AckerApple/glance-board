import { button, canvas, details, div, h2, h3, p, pre, section, span, strong, subscribe, summary, tag } from "taggedjs";
import { actions } from "../controller.js";
import { formatGameDetails, visibleCard } from "../display-utils.js";
import { scheduleMatrixTransitionDraw } from "../matrix-canvas.js";
import { hardware$, rotation$ } from "../state.js";
import type { DisplayCard } from "../types.js";

const MATRIX_ID = "matrixCanvas";

export const ActiveDisplay = tag(() => {
  return subscribe.all([hardware$, rotation$], ([[hardware], [state]]) => {
    const card = visibleCard(state?.payload, state?.currentCardId);
    const matrix = card?.dotMatrix ?? state?.payload?.dotMatrix ?? [];
    const progress = Math.round((state?.progress ?? 1) * 100);
    scheduleMatrixTransitionDraw(MATRIX_ID, card?.id, matrix, hardware?.intensity ?? 1);

    return [
      section.attr("aria-labelledby", "matrixTitle")(
        h2.id("matrixTitle")("16x96 Dot Matrix Preview"),
        canvas.id(MATRIX_ID).attr("aria-label", "16 by 96 dot matrix preview")(),
        div.class`rotation-progress`.attr("aria-label", "Time until next screen")(
          div.class`rotation-progress-fill`.attr("style", (_: unknown) => `width: ${progress}%`)()
        )
      ),
      section.class`panels`.attr("aria-label", "Readable display output")(
        div.class`readable-panel active`(
          div.class`panel-header`(
            h2('👀 ', () => card?.title || "Active Item"),
            div.class`panel-actions`(
              span(state?.paused ? "Paused" : card?.status ?? "Matrix"),
              button
                .type("button")
                .onClick(actions.toggleRotationPause)(
                  (_: unknown) => state?.paused ? "▶️ Resume" : "⏸️ Pause"
                )
            )
          ),
          pre.class`readable`((card?.readableLines ?? []).join("\n") || "No output"),
          p.class`game-details`(card ? formatGameDetails(card) : "Loading..."),
          () => card ? screenDataPanel(card) : null
        )
      )
      ]
  })
})

const screenDataPanel = tag((card: DisplayCard) => {
  let parsed = parsedDataForCard(card)
  let summaryItems = dataSummaryItems(card, parsed)

  screenDataPanel.inputs(x => {
    [card] = x
    parsed = parsedDataForCard(card)
    summaryItems = dataSummaryItems(card, parsed)
  })

  return div.class`screen-data`(
    h3("Data Behind This Screen"),
    div.class`screen-data-grid`(
      (_: unknown) => {
        return summaryItems.map(([label, value]) =>
        div.class`screen-data-chip`(
          strong(label),
          span(value)
        ).key(label)
      )}
    ),
    details.attr("open", "")(
      summary("Parsed display data"),
      pre.class`data-json`((_: unknown) => formatJson(parsed))
    ),
    card.debug ? details(
      summary("Provider debug"),
      pre.class`data-json`((_: unknown) => formatJson(card.debug))
    ) : null,
    card.raw !== undefined ? details(
      summary("Raw source data"),
      pre.class`data-json`((_: unknown) => formatJson(card.raw))
    ) : null
  );
})

function parsedDataForCard(card: DisplayCard): Record<string, unknown> {
  return compactObject({
    id: card.id,
    type: card.type,
    title: card.title,
    status: card.status,
    league: card.league,
    readableLines: card.readableLines,
    matrixLines: card.matrixLines,
    game: card.game,
    weather: card.weather,
    internet: card.internet,
    moon: card.moon,
    dateTime: card.dateTime,
    calendar: card.calendar,
    error: card.error
  });
}

function dataSummaryItems(card: DisplayCard, parsed: Record<string, unknown>): Array<[string, string]> {
  return [
    ["Item", card.id ?? "unknown"],
    ["Type", card.type ?? "display"],
    ["Status", card.status ?? "unknown"],
    ["Parsed keys", String(Object.keys(parsed).length)],
    ["Raw data", card.raw === undefined ? "none" : dataKind(card.raw)]
  ];
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function dataKind(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item array`;
  if (value && typeof value === "object") return `${Object.keys(value).length} key object`;
  return typeof value;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
