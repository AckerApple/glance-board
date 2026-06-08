import { button, div, h2, input, label, section, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { rotation$ } from "../state.js";

export const ConfiguredItems = tag(() =>
  subscribe(rotation$, ([state]) => {
    const items = state?.payload?.rotation?.items ?? [];
    return section.attr("aria-label", "Configured display items")(
      h2("⚙️ Configured Items"),
      div.class`item-list`(
        items.map((item) => {
          const active = state?.currentCardId === item.id;
          const status = item.enabled ? item.error ? "Error" : item.resolved ? "Enabled" : "Pending" : "Disabled";
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
            span.class`item-status`(status),
            button
              .class((_: unknown) => `item-chip ${active ? "active" : ""}`)
              .type("button")
              .disabled((_: unknown) => !item.resolved)
              .onClick(() => actions.selectCard(item.id))("Show")
          );
        })
      )
    );
  })
);
