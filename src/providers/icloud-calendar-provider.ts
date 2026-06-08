import { DisplayItemConfig } from "../rotation/types.js";
import { CalendarEventService, resolveCalendarDisplay } from "./calendar-display-provider.js";

export class ICloudCalendarProvider {
  constructor(private readonly service: CalendarEventService) {}

  async resolve(config: DisplayItemConfig) {
    return resolveCalendarDisplay("icloud-calendar", this.service, config);
  }
}
