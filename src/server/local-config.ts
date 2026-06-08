import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

export const configDir = path.resolve(process.cwd(), "config");

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(configDir, fileName), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(fileName: string, value: unknown): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function removeJsonFile(fileName: string): Promise<void> {
  await rm(path.join(configDir, fileName), { force: true });
}

export async function loadLocalEnv(): Promise<Record<string, string>> {
  const roots = [path.resolve(process.cwd(), ".env.local")];
  const values: Record<string, string> = {};
  for (const filePath of roots) {
    try {
      const body = await readFile(filePath, "utf8");
      for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator < 0) continue;
        const key = trimmed.slice(0, separator).trim();
        const rawValue = trimmed.slice(separator + 1).trim();
        values[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    } catch {
      // Missing .env.local is normal.
    }
  }
  return values;
}
