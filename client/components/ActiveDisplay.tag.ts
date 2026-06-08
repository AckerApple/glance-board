import { button, canvas, div, h2, p, pre, section, span, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { formatGameDetails, visibleCard } from "../display-utils.js";
import { scheduleMatrixDraw } from "../matrix-canvas.js";
import { hardware$, rotation$ } from "../state.js";

const MATRIX_ID = "matrixCanvas";

export const ActiveDisplay = tag(() =>
  subscribe(hardware$, ([hardware]) =>
    subscribe(rotation$, ([state]) => {
      const card = visibleCard(state?.payload, state?.currentCardId);
      const matrix = card?.dotMatrix ?? state?.payload?.dotMatrix ?? [];
      const progress = Math.round((state?.progress ?? 1) * 100);
      scheduleMatrixDraw(MATRIX_ID, matrix, hardware?.intensity ?? 1);

      return [
        section.class`panels`.attr("aria-label", "Readable display output")(
          div.class`readable-panel active`(
            div.class`panel-header`(
              h2(`👀 ${card?.title ?? "Active Item"}`),
              div.class`panel-actions`(
                span(state?.paused ? "Paused" : card?.status ?? "Matrix"),
                button.type("button").onClick(actions.toggleRotationPause)(state?.paused ? "▶️ Resume" : "⏸️ Pause")
              )
            ),
            pre.class`readable`((card?.readableLines ?? []).join("\n") || "No output"),
            p.class`game-details`(card ? formatGameDetails(card) : "Loading...")
          )
        ),
        section.attr("aria-labelledby", "matrixTitle")(
          h2.id("matrixTitle")("16x96 Dot Matrix Preview"),
          canvas.id(MATRIX_ID).attr("aria-label", "16 by 96 dot matrix preview")(),
          div.class`rotation-progress`.attr("aria-label", "Time until next screen")(
            div.class`rotation-progress-fill`.attr("style", (_: unknown) => `width: ${progress}%`)()
          )
        )
      ];
    })
  )
);
