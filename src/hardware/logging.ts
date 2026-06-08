import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function timestamp(): string {
  return new Date().toISOString();
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
