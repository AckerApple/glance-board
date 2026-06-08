import noble, { Advertisement, Characteristic, Peripheral, Service } from "@abandonware/noble";
import { timestamp } from "./logging.js";

export interface ServiceDataSnapshot {
  uuid: string;
  dataHex: string;
}

export interface AdvertisementSnapshot {
  timestamp: string;
  id: string;
  address?: string;
  addressType?: string;
  connectable?: boolean;
  localName?: string;
  rssi: number;
  serviceUuids: string[];
  manufacturerDataHex?: string;
  serviceData: ServiceDataSnapshot[];
  fingerprint: string;
}

export interface SeenDevice {
  id: string;
  firstSeen: string;
  lastSeen: string;
  bestRssi: number;
  latest: AdvertisementSnapshot;
  changedCount: number;
  advertisements: AdvertisementSnapshot[];
}

export interface ByteView {
  hex: string;
  utf8?: string;
  decimal: number[];
  smallNumbers: number[];
  scoreHints: string[];
}

export function bytesToHex(data?: Buffer): string | undefined {
  return data && data.length > 0 ? data.toString("hex") : undefined;
}

export function printableUtf8(data: Buffer): string | undefined {
  const text = data.toString("utf8");
  if (!text) return undefined;
  return /^[\x09\x0a\x0d\x20-\x7e]+$/.test(text) ? text : undefined;
}

export function byteView(data: Buffer): ByteView {
  const decimal = [...data.values()];
  const smallNumbers = decimal.filter((value) => value >= 0 && value <= 15);
  const utf8 = printableUtf8(data);
  const scoreHints: string[] = [];

  if (smallNumbers.length > 0) {
    scoreHints.push(`contains small score-like byte(s): ${[...new Set(smallNumbers)].join(", ")}`);
  }

  if (utf8) {
    const scorePattern = /\b(?:[0-1]?\d)-(?:[0-1]?\d)(?:-[12])?\b/.exec(utf8);
    if (scorePattern) scoreHints.push(`contains delimited score-like text: ${scorePattern[0]}`);
    if (/^\s*[{[]/.test(utf8)) scoreHints.push("looks like JSON or structured ASCII");
    if (/[,:|/ -]/.test(utf8)) scoreHints.push("contains delimiters commonly used in score strings");
  }

  return {
    hex: data.toString("hex"),
    utf8,
    decimal,
    smallNumbers,
    scoreHints
  };
}

export function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replaceAll("-", "");
}

export function isLikelyStandardBleUuid(uuid: string): boolean {
  const short = normalizeUuid(uuid);
  return short.length === 4 || short.startsWith("0000");
}

export function hasCustomServiceUuid(serviceUuids: string[]): boolean {
  return serviceUuids.some((uuid) => !isLikelyStandardBleUuid(uuid));
}

export function snapshotAdvertisement(peripheral: Peripheral): AdvertisementSnapshot {
  const advertisement: Advertisement = peripheral.advertisement ?? {};
  const serviceUuids = [...(advertisement.serviceUuids ?? [])].map(normalizeUuid).sort();
  const manufacturerDataHex = bytesToHex(advertisement.manufacturerData);
  const serviceData = [...(advertisement.serviceData ?? [])]
    .map((entry) => ({ uuid: normalizeUuid(entry.uuid), dataHex: entry.data.toString("hex") }))
    .sort((a, b) => a.uuid.localeCompare(b.uuid));
  const fingerprint = JSON.stringify({
    localName: advertisement.localName,
    serviceUuids,
    manufacturerDataHex,
    serviceData
  });

  return {
    timestamp: timestamp(),
    id: peripheral.id,
    address: peripheral.address,
    addressType: peripheral.addressType,
    connectable: peripheral.connectable,
    localName: advertisement.localName,
    rssi: peripheral.rssi,
    serviceUuids,
    manufacturerDataHex,
    serviceData,
    fingerprint
  };
}

export function updateSeenDevice(map: Map<string, SeenDevice>, snapshot: AdvertisementSnapshot): { device: SeenDevice; isNew: boolean; changed: boolean } {
  const existing = map.get(snapshot.id);
  if (!existing) {
    const device: SeenDevice = {
      id: snapshot.id,
      firstSeen: snapshot.timestamp,
      lastSeen: snapshot.timestamp,
      bestRssi: snapshot.rssi,
      latest: snapshot,
      changedCount: 0,
      advertisements: [snapshot]
    };
    map.set(snapshot.id, device);
    return { device, isNew: true, changed: false };
  }

  const changed = existing.latest.fingerprint !== snapshot.fingerprint;
  existing.lastSeen = snapshot.timestamp;
  existing.bestRssi = Math.max(existing.bestRssi, snapshot.rssi);
  existing.latest = snapshot;
  if (changed) existing.changedCount += 1;
  existing.advertisements.push(snapshot);
  return { device: existing, isNew: false, changed };
}

export function formatDeviceLine(device: SeenDevice, marker = " "): string {
  const latest = device.latest;
  const parts = [
    marker,
    latest.rssi.toString().padStart(4, " "),
    `best=${device.bestRssi.toString().padStart(4, " ")}`,
    latest.id,
    latest.address ? `addr=${latest.address}` : "addr=n/a",
    latest.localName ? `name="${latest.localName}"` : "name=n/a",
    latest.serviceUuids.length ? `svc=${latest.serviceUuids.join(",")}` : "svc=none",
    latest.manufacturerDataHex ? `mfg=${latest.manufacturerDataHex}` : "mfg=none",
    latest.serviceData.length ? `sdata=${latest.serviceData.map((s) => `${s.uuid}:${s.dataHex}`).join(",")}` : "sdata=none",
    `last=${latest.timestamp}`
  ];
  return parts.join(" ");
}

export function printSeenDevices(map: Map<string, SeenDevice>): void {
  console.clear();
  console.log(`BLE advertisements (${map.size} seen). Strongest RSSI first. Ctrl+C to stop.`);
  console.log("mark RSSI best id address name services manufacturer serviceData lastSeen");
  [...map.values()]
    .sort((a, b) => b.latest.rssi - a.latest.rssi)
    .slice(0, 50)
    .forEach((device) => console.log(formatDeviceLine(device)));
}

export async function waitForPoweredOn(): Promise<void> {
  if (noble.state === "poweredOn") return;

  console.log(`Bluetooth adapter state is "${noble.state}". Waiting for poweredOn...`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for noble state poweredOn")), 30000);
    noble.on("stateChange", (state) => {
      console.log(`Bluetooth adapter state changed to "${state}"`);
      if (state === "poweredOn") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

export async function startScanning(): Promise<void> {
  await waitForPoweredOn();
  await new Promise<void>((resolve, reject) => {
    noble.startScanning([], true, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function stopScanning(): Promise<void> {
  await new Promise<void>((resolve) => noble.stopScanning(resolve));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scanForDuration(seconds: number, label: string): Promise<AdvertisementSnapshot[]> {
  const events: AdvertisementSnapshot[] = [];
  const onDiscover = (peripheral: Peripheral) => events.push(snapshotAdvertisement(peripheral));
  noble.on("discover", onDiscover);
  await startScanning();
  console.log(`Recording ${label} for ${seconds}s...`);
  await sleep(seconds * 1000);
  await stopScanning();
  noble.removeListener("discover", onDiscover);
  console.log(`Captured ${events.length} advertisement event(s) for ${label}.`);
  return events;
}

export async function connectPeripheral(peripheralId: string, timeoutMs = 30000): Promise<Peripheral> {
  await waitForPoweredOn();
  return new Promise((resolve, reject) => {
    let found = false;
    const timeout = setTimeout(async () => {
      noble.removeListener("discover", onDiscover);
      await stopScanning().catch(() => undefined);
      reject(new Error(`Timed out looking for peripheral ${peripheralId}`));
    }, timeoutMs);

    const onDiscover = (peripheral: Peripheral) => {
      if (peripheral.id !== peripheralId) return;
      found = true;
      clearTimeout(timeout);
      noble.removeListener("discover", onDiscover);
      stopScanning()
        .then(
          () =>
            new Promise<void>((resolveConnect, rejectConnect) => {
              peripheral.connect((error) => (error ? rejectConnect(new Error(error)) : resolveConnect()));
            })
        )
        .then(() => resolve(peripheral))
        .catch(reject);
    };

    noble.on("discover", onDiscover);
    startScanning().catch((error) => {
      clearTimeout(timeout);
      noble.removeListener("discover", onDiscover);
      if (!found) reject(error);
    });
  });
}

export function discoverServices(peripheral: Peripheral): Promise<Service[]> {
  return new Promise((resolve, reject) => {
    peripheral.discoverServices([], (error, services) => (error ? reject(new Error(error)) : resolve(services)));
  });
}

export function discoverCharacteristics(service: Service): Promise<Characteristic[]> {
  return new Promise((resolve, reject) => {
    service.discoverCharacteristics([], (error, characteristics) => (error ? reject(new Error(error)) : resolve(characteristics)));
  });
}

export function readCharacteristic(characteristic: Characteristic): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    characteristic.read((error, data) => (error ? reject(new Error(error)) : resolve(data)));
  });
}

export function subscribeCharacteristic(characteristic: Characteristic): Promise<void> {
  return new Promise((resolve, reject) => {
    characteristic.subscribe((error) => (error ? reject(new Error(error)) : resolve()));
  });
}

export function writeCharacteristic(characteristic: Characteristic, data: Buffer, withoutResponse: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    characteristic.write(data, withoutResponse, (error) => (error ? reject(new Error(error)) : resolve()));
  });
}

export function canRead(characteristic: Characteristic): boolean {
  return characteristic.properties.includes("read");
}

export function canWrite(characteristic: Characteristic): boolean {
  return characteristic.properties.includes("write") || characteristic.properties.includes("writeWithoutResponse");
}

export function canNotify(characteristic: Characteristic): boolean {
  return characteristic.properties.includes("notify") || characteristic.properties.includes("indicate");
}

export async function disconnectQuietly(peripheral: Peripheral): Promise<void> {
  await new Promise<void>((resolve) => peripheral.disconnect(() => resolve()));
}
