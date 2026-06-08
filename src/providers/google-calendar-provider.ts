import { GoogleCalendarService } from "./google-calendar-service.js";
import { DisplayItemConfig } from "../rotation/types.js";
import { resolveCalendarDisplay } from "./calendar-display-provider.js";

export class GoogleCalendarProvider {
  constructor(private readonly service: GoogleCalendarService) {}

  async resolve(config: DisplayItemConfig) {
    return resolveCalendarDisplay("google-calendar", this.service, config);
  }
}
