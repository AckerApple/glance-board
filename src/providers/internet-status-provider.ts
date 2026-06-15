import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { DisplayItemConfig, InternetConnectionType } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

const execFileAsync = promisify(execFile);
const DEFAULT_LATENCY_URL = "https://speed.cloudflare.com/cdn-cgi/trace";
const DEFAULT_DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=1000000";
const DEFAULT_UPLOAD_URL = "https://speed.cloudflare.com/__up";
const DOWNLOAD_BYTES = 1_000_000;
const UPLOAD_BYTES = 512_000;
const REQUEST_TIMEOUT_MS = 12_000;

interface InternetStatusResolved {
  readableLines: string[];
  matrixLines: string[];
  internet: {
    online: boolean;
    connectionType: InternetConnectionType;
    interfaceName?: string;
    latencyMs?: number;
    downloadMbps?: number;
    uploadMbps?: number;
    checkedAt: string;
  };
  debug: Record<string, unknown>;
}

interface InterfaceDetails {
  connectionType: InternetConnectionType;
  interfaceName?: string;
}

export class InternetStatusProvider {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly detectInterface: () => Promise<InterfaceDetails> = detectActiveInterface
  ) {}

  async resolve(_config: DisplayItemConfig): Promise<InternetStatusResolved> {
    const checkedAt = new Date().toISOString();
    const interfaceDetails = await this.detectInterface();
    const latency = await measureLatency(this.fetchImpl, latencyUrl());

    if (!latency.ok) {
      const lines = sanitizeDisplayLines(["OFFLINE", "D-- U--"]);
      return {
        internet: {
          online: false,
          connectionType: interfaceDetails.connectionType,
          interfaceName: interfaceDetails.interfaceName,
          checkedAt
        },
        readableLines: lines,
        matrixLines: lines.map((line) => fitDisplayLine(line, 13)),
        debug: {
          ...interfaceDetails,
          latencyError: latency.error
        }
      };
    }

    const [download, upload] = await Promise.all([
      measureDownloadMbps(this.fetchImpl, downloadUrl()),
      measureUploadMbps(this.fetchImpl, uploadUrl())
    ]);
    const downloadMbps = download.mbps;
    const uploadMbps = upload.mbps;
    const lines = sanitizeDisplayLines([
      `${latency.latencyMs}MS ONLINE`,
      `D${formatMbps(downloadMbps)} U${formatMbps(uploadMbps)}`
    ]);

    return {
      internet: {
        online: true,
        connectionType: interfaceDetails.connectionType,
        interfaceName: interfaceDetails.interfaceName,
        latencyMs: latency.latencyMs,
        downloadMbps,
        uploadMbps,
        checkedAt
      },
      readableLines: lines,
      matrixLines: lines.map((line) => fitDisplayLine(line, 13)),
      debug: {
        ...interfaceDetails,
        latencyMs: latency.latencyMs,
        downloadMbps,
        uploadMbps,
        downloadError: download.error,
        uploadError: upload.error
      }
    };
  }
}

async function measureLatency(fetchImpl: typeof fetch, url: string): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const startedAt = performance.now();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { accept: "text/plain,application/json,*/*" }
    });
    await response.arrayBuffer();
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function measureDownloadMbps(fetchImpl: typeof fetch, url: string): Promise<{ mbps?: number; error?: string }> {
  const startedAt = performance.now();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { accept: "application/octet-stream,*/*" }
    });
    const body = await response.arrayBuffer();
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { mbps: calculateMbps(body.byteLength || DOWNLOAD_BYTES, performance.now() - startedAt) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function measureUploadMbps(fetchImpl: typeof fetch, url: string): Promise<{ mbps?: number; error?: string }> {
  const body = Buffer.alloc(UPLOAD_BYTES, 1);
  const startedAt = performance.now();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body
    });
    await response.arrayBuffer();
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { mbps: calculateMbps(body.byteLength, performance.now() - startedAt) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function calculateMbps(bytes: number, elapsedMs: number): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || bytes <= 0) return undefined;
  return roundTenths((bytes * 8) / (elapsedMs / 1000) / 1_000_000);
}

function roundTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatMbps(value: number | undefined): string {
  if (value === undefined) return "--";
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(1);
}

async function detectActiveInterface(): Promise<InterfaceDetails> {
  const interfaceName = await defaultRouteInterface();
  const activeName = interfaceName ?? firstActiveInterfaceName();
  return {
    connectionType: connectionTypeForInterface(activeName, await macHardwarePorts()),
    interfaceName: activeName
  };
}

async function defaultRouteInterface(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const { stdout } = await execFileAsync("route", ["get", "default"], { timeout: 1500 });
    return stdout.match(/interface:\s*(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function macHardwarePorts(): Promise<Map<string, InternetConnectionType>> {
  const ports = new Map<string, InternetConnectionType>();
  if (process.platform !== "darwin") return ports;

  try {
    const { stdout } = await execFileAsync("networksetup", ["-listallhardwareports"], { timeout: 1500 });
    const blocks = stdout.split(/\n\s*\n/);
    for (const block of blocks) {
      const port = block.match(/Hardware Port:\s*(.+)/)?.[1]?.toLowerCase();
      const device = block.match(/Device:\s*(\S+)/)?.[1];
      if (!port || !device) continue;
      if (port.includes("wi-fi") || port.includes("airport")) ports.set(device, "wifi");
      else if (port.includes("ethernet") || port.includes("thunderbolt") || port.includes("usb")) ports.set(device, "ethernet");
    }
  } catch {
    return ports;
  }

  return ports;
}

function firstActiveInterfaceName(): string | undefined {
  const interfaces = networkInterfaces();
  return Object.entries(interfaces).find(([, addresses]) =>
    addresses?.some((address) => address.family === "IPv4" && !address.internal)
  )?.[0];
}

function connectionTypeForInterface(interfaceName: string | undefined, macPorts: Map<string, InternetConnectionType>): InternetConnectionType {
  if (!interfaceName) return "unknown";
  const macPort = macPorts.get(interfaceName);
  if (macPort) return macPort;

  const normalized = interfaceName.toLowerCase();
  if (normalized.startsWith("wl") || normalized.includes("wifi") || normalized.includes("wlan") || normalized.includes("airport")) return "wifi";
  if (normalized.startsWith("en") || normalized.startsWith("eth") || normalized.includes("ethernet")) return "ethernet";
  return "unknown";
}

function latencyUrl(): string {
  return process.env.INTERNET_STATUS_LATENCY_URL ?? DEFAULT_LATENCY_URL;
}

function downloadUrl(): string {
  return process.env.INTERNET_STATUS_DOWNLOAD_URL ?? DEFAULT_DOWNLOAD_URL;
}

function uploadUrl(): string {
  return process.env.INTERNET_STATUS_UPLOAD_URL ?? DEFAULT_UPLOAD_URL;
}
