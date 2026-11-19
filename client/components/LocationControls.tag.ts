import { uiLabel } from "../presentation.js";
import { button, div, form, h2, input, label, p, section, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { location$, type LocationState } from "../state.js";

export const LocationControls = tag(() =>
  subscribe(location$, ([state]) => LocationPanel(state))
);

export const LocationPanel = tag((state: LocationState) => {
  LocationPanel.inputs(([next]) => { state = next; });
  return section.attr("aria-labelledby", "locationTitle")(
      h2.id("locationTitle")(uiLabel("weatherGas", "Weather & Gas Location")),
      form.class`location-form`.onSubmit((event: Event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void actions.saveLocation(String(data.get("zip") ?? ""));
      })(
        label.attr("for", "zipCodeInput")("U.S. ZIP code"),
        div.class`location-actions`(
          input
            .id("zipCodeInput")
            .name("zip")
            .type("text")
            .value((_: unknown) => state?.location.zip ?? "")
            .attr("inputmode", "numeric")
            .attr("autocomplete", "postal-code")
            .attr("maxlength", "5")
            .attr("pattern", "[0-9]{5}")
            .attr("placeholder", "33066")
            .disabled((_: unknown) => Boolean(state?.busy))
            .attr("required", true)(),
          button.type("submit").disabled((_: unknown) => Boolean(state?.busy))(uiLabel("save", "Save ZIP")),
          button.type("button").disabled((_: unknown) => Boolean(state?.busy)).onClick(actions.detectLocation)(uiLabel("location", "Use My Location"))
        )
      ),
      p.class`muted`.attr("role", "status")(() => state?.message ?? "Location: loading...")
    );
});
