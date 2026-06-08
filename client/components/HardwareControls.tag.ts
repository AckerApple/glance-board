import { button, div, h2, input, label, p, section, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { hardware$ } from "../state.js";

export const HardwareControls = tag(() =>
  subscribe(hardware$, ([state]) => {
    const status = state?.status;
    const sent = status?.lastSentAt ? ` Last sent: ${new Date(status.lastSentAt).toLocaleTimeString()}.` : "";
    const message = status
      ? `Display: ${status.status}. Device: ${status.deviceName}. ${status.lastMessage ?? ""}.${sent}`
      : "Display: checking...";

    return section.attr("aria-labelledby", "displayTitle")(
      h2.id("displayTitle")("💡 Dot Matrix Hardware"),
      div.class`display-actions`(
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.connectDisplay)("Connect"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.sendCurrent)("Send Showing Item"),
        button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.disconnectDisplay)("Disconnect"),
        label.class`checkbox`(
          input
            .type("checkbox")
            .checked((_: unknown) => Boolean(state?.autoSend))
            .disabled((_: unknown) => Boolean(state?.busy))
            .onChange((event: Event) => actions.setAutoSend((event.target as HTMLInputElement).checked))(),
          "Auto-send rotation"
        )
      ),
      label.class`intensity-control`(
        span("Intensity ", strong(`${Math.round((state?.intensity ?? 1) * 100)}%`)),
        input
          .type("range")
          .attr("min", "10")
          .attr("max", "100")
          .attr("step", "5")
          .value((_: unknown) => String(Math.round((state?.intensity ?? 1) * 100)))
          .disabled((_: unknown) => Boolean(state?.busy))
          .onInput((event: Event) => actions.setIntensity(Number((event.target as HTMLInputElement).value) / 100))
          .onChange((event: Event) => actions.setIntensity(Number((event.target as HTMLInputElement).value) / 100, true))()
      ),
      p.class`muted`(message)
    );
  })
);
