import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function timestamp(): string {
  return new Date().toISOString();
}

export function clockStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMinutes())}:${pad(date.getSeconds())}.${Math.floor(date.getMilliseconds() / 100)}`;
}

let clockedConsoleInstalled = false;

function hasClockStamp(value: string): boolean {
  return /^\d{2}:\d{2}(?:\.\d)?\s/.test(value);
}

function withClockStamp(message: string): string {
  if (hasClockStamp(message)) return message;
  return `${clockStamp()} ${message}`;
}

function clockConsoleArgs(args: unknown[]): unknown[] {
  if (typeof args[0] === "string") return [withClockStamp(args[0]), ...args.slice(1)];
  return [clockStamp(), ...args];
}

export function installClockedConsole(): void {
  if (clockedConsoleInstalled) return;
  clockedConsoleInstalled = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => originalLog(...clockConsoleArgs(args));
  console.warn = (...args: unknown[]) => originalWarn(...clockConsoleArgs(args));
  console.error = (...args: unknown[]) => originalError(...clockConsoleArgs(args));
}

export function logWithClock(message: string): void {
  console.log(withClockStamp(message));
}

export function warnWithClock(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(withClockStamp(message));
  else console.warn(withClockStamp(message), detail);
}

export function errorWithClock(message: string | unknown): void {
  console.error(withClockStamp(message instanceof Error ? message.message : String(message)));
}

export function sessionStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export async function ensureLogsDir(): Promise<void> {
  await mkdir("logs", { recursive: true });
}

export function logPath(prefix: string, extension = "json"): string {
  return path.join("logs", `${prefix}-${sessionStamp()}.${extension}`);
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureLogsDir();
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export class JsonLog {
  public readonly events: unknown[] = [];

  constructor(public readonly filePath: string, private readonly metadata: unknown = {}) {}

  add(event: unknown): void {
    this.events.push(event);
  }

  async save(): Promise<void> {
    await writeJsonFile(this.filePath, {
      metadata: this.metadata,
      savedAt: timestamp(),
      events: this.events
    });
  }
}
