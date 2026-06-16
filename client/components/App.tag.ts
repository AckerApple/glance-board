import { hr, main, tag } from "taggedjs";
import { ActiveDisplay } from "./ActiveDisplay.tag.js";
import { CalendarControls } from "./CalendarControls.tag.js";
import { ConfiguredItems } from "./ConfiguredItems.tag.js";
import { DebugPanel } from "./DebugPanel.tag.js";
import { HardwareControls } from "./HardwareControls.tag.js";
import { Header } from "./Header.tag.js";
import { LocationControls } from "./LocationControls.tag.js";
import { ICloudCalendarControls } from "./ICloudCalendarControls.tag.js";

export const App = tag(() =>
  main(
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
    CalendarControls(),
    hr(),
    ICloudCalendarControls(),
    hr(),
    DebugPanel()
  )
);
