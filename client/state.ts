import { array } from "taggedjs";
import type {
  CalendarEvent,
  CalendarOption,
  CalendarStatus,
  DisplayStatus,
  ICloudCalendarOption,
  ICloudCalendarStatus,
  LocationData,
  RotationPayload
} from "./types.js";

export interface RotationState {
  payload?: RotationPayload;
  currentCardId?: string;
  paused?: boolean;
  progress?: number;
  error?: string;
}

export interface HardwareState {
  status?: DisplayStatus;
  autoSend: boolean;
  intensity: number;
  busy: boolean;
}

export interface LocationState {
  location: LocationData;
  message: string;
  busy: boolean;
}

export interface CalendarState {
  status: CalendarStatus;
  calendars: CalendarOption[];
  events: CalendarEvent[];
  message: string;
  busy: boolean;
}

export interface ICloudCalendarState {
  status: ICloudCalendarStatus;
  calendars: ICloudCalendarOption[];
  events: CalendarEvent[];
  message: string;
  busy: boolean;
}

export const rotation$ = array<RotationState>([{}]);
export const hardware$ = array<HardwareState>([{
  autoSend: false,
  intensity: 1,
  busy: false
}]);
export const location$ = array<LocationState>([{
  location: {},
  message: "Location: loading...",
  busy: false
}]);
export const calendar$ = array<CalendarState>([{
  status: {},
  calendars: [],
  events: [],
  message: "Calendar: checking setup...",
  busy: false
}]);
export const icloudCalendar$ = array<ICloudCalendarState>([{
  status: {},
  calendars: [],
  events: [],
  message: "iCloud Calendar: checking setup...",
  busy: false
}]);

export function updateRotation(patch: Partial<RotationState>): void {
  rotation$[0] = { ...rotation$[0], ...patch };
}

export function updateHardware(patch: Partial<HardwareState>): void {
  hardware$[0] = { ...hardware$[0], ...patch };
}

export function updateLocation(patch: Partial<LocationState>): void {
  location$[0] = { ...location$[0], ...patch };
}

export function updateCalendar(patch: Partial<CalendarState>): void {
  calendar$[0] = { ...calendar$[0], ...patch };
}

export function updateICloudCalendar(patch: Partial<ICloudCalendarState>): void {
  icloudCalendar$[0] = { ...icloudCalendar$[0], ...patch };
  pruneStaleICloudSections();
}

function pruneStaleICloudSections(): void {
  if (typeof document === "undefined") return;
  const prune = () => {
    const sections = Array.from(document.querySelectorAll('[aria-labelledby="icloudCalendarTitle"]'));
    for (const section of sections.slice(0, -1)) section.remove();
  };
  window.requestAnimationFrame(prune);
  window.setTimeout(prune, 50);
  window.setTimeout(prune, 250);
}
