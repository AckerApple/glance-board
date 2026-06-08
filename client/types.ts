export type PixelColor = "off" | "green" | "blue" | "white" | "orange" | "red" | "yellow" | "purple" | "gray";
export type PixelMatrix = PixelColor[][];

export interface DisplayItem {
  id: string;
  enabled: boolean;
  resolved?: boolean;
  error?: string;
}

export interface DisplayCard {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  league?: string;
  readableLines?: string[];
  dotMatrix?: PixelMatrix;
  game?: {
    status?: string;
    period?: number;
    clock?: string;
    scheduledTime?: string;
  };
}

export interface RotationPayload {
  fetchedAt: string;
  dotMatrix: PixelMatrix;
  game: {
    status: string;
    displayLines: string[];
  };
  state: {
    error?: string;
    debug?: Record<string, unknown>;
  };
  rotation?: {
    rotationSeconds?: number;
    paused?: boolean;
    items?: DisplayItem[];
    cards?: DisplayCard[];
    activeCard?: DisplayCard;
  };
}

export interface DisplayStatus {
  status: string;
  deviceName: string;
  autoSend: boolean;
  intensity: number;
  lastMessage?: string;
  lastSentAt?: string;
}

export interface LocationData {
  zip?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}

export interface CalendarStatus {
  authenticated?: boolean;
  credentialsConfigured?: boolean;
  credentialsSource?: string;
  missingCredentials?: string[];
  redirectUri?: string;
  selectedCalendarId?: string;
  selectedCalendarName?: string;
}

export interface CalendarOption {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface CalendarEvent {
  title?: string;
  startTime?: string;
  isAllDay?: boolean;
}

export interface ICloudCalendarStatus {
  credentialsConfigured?: boolean;
  connected?: boolean;
  selectedCalendarId?: string;
  selectedCalendarName?: string;
  eventShowCount?: number;
  provider?: "icloud";
}

export interface ICloudCalendarOption {
  id: string;
  summary: string;
  color?: string;
}

export interface BrowserFormSettings {
  autoSendRotation: boolean;
  displayIntensity: number;
}
