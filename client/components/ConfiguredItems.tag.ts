import { button, div, h2, input, label, option, section, select, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { rotation$ } from "../state.js";

export const ConfiguredItems = tag(() =>
  subscribe(rotation$, ([state]) => {
    const items = state?.payload?.rotation?.items ?? [];
    const categories = state?.payload?.rotation?.categories ?? [];
    return section.attr("aria-label", "Configured display items")(
      h2("⚙️ Configured Items"),
      div.class`item-list`(
        items.map((item) => {
          const active = state?.currentCardId === item.id;
          const status = item.enabled ? item.error ? "ERROR" : item.resolved ? "Enabled" : "Pending" : "Disabled";
          const statusControl = item.error
            ? button
                .class`item-status item-status-error`
                .type("button")
                .onClick(() => {
                  window.alert(item.error ?? "Unknown display item error");
                })(status)
            : span.class`item-status`(status);
          return div.class((_: unknown) => `item-row ${active ? "active" : ""}`)(
            label.class`checkbox item-toggle`(
              input
                .type("checkbox")
                .checked((_: unknown) => Boolean(item.enabled))
                .onChange((event: Event) => {
                  void actions.setDisplayItemEnabled(item.id, (event.target as HTMLInputElement).checked);
                })(),
              strong(item.id)
            ),
            statusControl,
            button
              .class((_: unknown) => `item-chip ${active ? "active" : ""}`)
              .type("button")
              .disabled((_: unknown) => !item.resolved)
              .onClick(() => actions.selectCard(item.id))("Show"),
            label.class`item-category`(
              span("Category"),
              select
                .value((_: unknown) => item.categoryId ?? "")
                .onChange((event: Event) => {
                  void actions.setDisplayItemCategory(item.id, (event.target as HTMLSelectElement).value);
                })(
                  categories.map((category) => option.value(category.id)(category.label))
                )
            ),
            div.class`item-freshness`(freshnessText(item))
          );
        })
      )
    );
  })
);

function freshnessText(item: { enabled: boolean; lastUpdated?: string; refreshIntervalSeconds?: number }): string {
  if (!item.enabled) return "Not updating while disabled";
  const ageMinutes = minutesSince(item.lastUpdated);
  const updatedText = ageMinutes === undefined
    ? "Last updated: pending"
    : `Last updated: ${ageMinutes < 1 ? "just now" : `${ageMinutes} min ago`}`;
  const intervalText = item.refreshIntervalSeconds
    ? `updates every ${formatInterval(item.refreshIntervalSeconds)}`
    : "update interval unknown";
  return `${updatedText} · ${intervalText}`;
}

function minutesSince(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}
