import { button, div, h1, hr, main, nav, p, subscribe, tag } from "taggedjs";
import { destinations, navigation$, type PageId } from "../navigation.js";
import { ActiveDisplay } from "./ActiveDisplay.tag.js";
import { CalendarControls } from "./CalendarControls.tag.js";
import { ConfiguredItems } from "./ConfiguredItems.tag.js";
import { DebugPanel } from "./DebugPanel.tag.js";
import { HardwareControls } from "./HardwareControls.tag.js";
import { Header } from "./Header.tag.js";
import { LocationControls } from "./LocationControls.tag.js";
import { ICloudCalendarControls } from "./ICloudCalendarControls.tag.js";

export const App = tag(() =>
  subscribe(navigation$, ([page]) => NavigationLayout(page))
);

export const NavigationLayout = tag((page: PageId) => {
  // TaggedJS attribute change detection retains initial callbacks. Keep their
  // captured input mutable instead of creating a new page snapshot each update.
  NavigationLayout.inputs(([nextPage]) => { page = nextPage; });
  return main(
    nav.class`app-navigation`.attr("aria-label", "Main navigation")(
      destinations.map(destination => button
        .type("button")
        .onClick(() => { window.location.hash = destination.href; })
        .attr("aria-current", () => page === destination.id ? "page" : undefined)
        (destination.label).key(destination.id))
    ),
    // Keep page contents mounted so navigation preserves forms and subscriptions.
    div.id("homePage").attr("hidden", () => page !== "home")(
      Header(),
      hr(),
      ActiveDisplay(),
      hr(),
      ConfiguredItems(),
      hr(),
      LocationControls(),
      hr(),
      HardwareControls(),
      hr(),
      DebugPanel()
    ),
    div.id("calendarsPage").attr("hidden", () => page !== "calendars")(
      h1("Calendars"),
      p.class`muted`("Connect calendars, choose upcoming events, and add them to your display rotation."),
      hr(),
      CalendarControls(),
      ICloudCalendarControls()
    )
  );
});
