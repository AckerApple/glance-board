import { button, div, h1, header, p, span, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { statusText, visibleCard } from "../display-utils.js";
import { rotation$ } from "../state.js";

export const Header = tag(() =>
  subscribe(rotation$, ([state]) => {
    const card = visibleCard(state?.payload, state?.currentCardId);
    return header(
      p.class`eyebrow`("Glanceboard"),
      h1("Rotating Display"),
      p.class`status`(state?.error ? "Error" : statusText(card?.status)),
      div.class`mode-row`(
        span.id("modeIndicator")(`Showing: ${card?.title ?? card?.id ?? "Loading"}`),
        button.type("button").onClick(actions.showNextItem)("Next Item")
      )
    );
  })
);
