import { details, div, p, pre, span, strong, subscribe, summary, tag } from "taggedjs";
import { rotation$ } from "../state.js";

export const DebugPanel = tag(() =>
  subscribe(rotation$, ([state]) => {
    const payload = state?.payload;
    const debug = payload?.state.debug ?? {};
    const cards: Array<[string, unknown]> = [
      ["Active Card", state?.currentCardId ?? "none"],
      ["Configured Items", payload?.rotation?.items?.length ?? "--"],
      ["Enabled Cards", payload?.rotation?.cards?.length ?? "--"],
      ["Today Events", debug.todayEvents ?? "--"],
      ["Schedule Events", debug.scheduleEvents ?? "--"],
      ["Finals Events", debug.finalsEvents ?? "--"],
      ["Dates Fetched", Array.isArray(debug.fetchedDates) ? debug.fetchedDates.length : "--"],
      ["Current Pick", debug.selectedCurrent ?? "none"],
      ["Next Pick", debug.selectedNext ?? "none"],
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
          )
        ),
        pre.class`debug`(payload ? JSON.stringify(payload, null, 2) : "")
      )
    ];
  })
);
