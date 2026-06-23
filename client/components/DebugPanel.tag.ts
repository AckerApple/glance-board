import { details, div, input, label, p, pre, span, strong, subscribe, summary, tag } from "taggedjs";
import { actions } from "../controller.js";
import { visibleCard } from "../display-utils.js";
import { rotation$ } from "../state.js";

export const DebugPanel = tag(() =>
  subscribe(rotation$, ([state]) => {
    const payload = state?.payload;
    const activeCard = visibleCard(payload, state?.currentCardId);
    const debug = activeCard?.debug ?? payload?.rotation?.debug ?? payload?.state.debug ?? {};
    const debugPayload = payload ? {
      activeCardId: state?.currentCardId ?? payload.rotation?.activeCard?.id,
      activeCard,
      rotationDebug: payload.rotation?.debug,
      legacyNbaDebug: payload.state.debug,
      fetchedAt: payload.fetchedAt
    } : undefined;
    const cards: Array<[string, unknown]> = [
      ["Active Card", state?.currentCardId ?? "none"],
      ["Active Debug", activeCard?.debug ? "provider" : payload?.rotation?.debug ? "rotation" : "legacy"],
      ["Configured Items", payload?.rotation?.items?.length ?? "--"],
      ["Enabled Cards", payload?.rotation?.cards?.length ?? "--"],
      ["Today Events", debug.todayEvents ?? "--"],
      ["Schedule Events", debug.scheduleEvents ?? "--"],
      ["Finals Events", debug.finalsEvents ?? "--"],
      ["Dates Fetched", Array.isArray(debug.fetchedDates) ? debug.fetchedDates.length : "--"],
      ["Current Pick", debug.selectedCurrent ?? debug.selected ?? "none"],
      ["Next Pick", debug.selectedNext ?? "none"],
      ["Scoped Events", debug.scopedEvents ?? "--"],
      ["Rotate", `${payload?.rotation?.rotationSeconds ?? 10}s`],
      ["Error", state?.error ?? payload?.state.error ?? "none"]
    ];

    return [
      p.class`muted`(`Last updated: ${payload?.fetchedAt ? new Date(payload.fetchedAt).toLocaleTimeString() : "never"}`),
      state?.error ? p.class`error`(`${state.error}. Showing the last successful display while retrying.`) : null,
      details(
        summary("Debug Console"),
        div.class`debug-cards`(
          cards.map(([label, value]) =>
            div.class`debug-card`(
              strong(label),
              span(String(value))
            )
          ),
          label.class`debug-card`(
            strong("Display Seconds"),
            input
              .type("number")
              .attr("min", "3")
              .attr("step", "1")
              .value((_: unknown) => String(payload?.rotation?.rotationSeconds ?? 3))
              .onChange((event: Event) => {
                void actions.setDisplaySeconds(Number((event.target as HTMLInputElement).value));
              })()
          )
        ),
        pre.class`debug`(debugPayload ? JSON.stringify(debugPayload, null, 2) : "")
      )
    ];
  })
);
