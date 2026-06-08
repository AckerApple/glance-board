import noble, { Characteristic, Peripheral, Service } from "@abandonware/noble";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AdvertisementSnapshot,
  byteView,
  bytesToHex,
  canNotify,
  canRead,
  canWrite,
  disconnectQuietly,
  discoverCharacteristics,
  discoverServices,
  normalizeUuid,
  readCharacteristic,
  snapshotAdvertisement,
  startScanning,
  stopScanning,
  subscribeCharacteristic,
  waitForPoweredOn,
  writeCharacteristic
} from "../ble-utils.js";
import { sessionStamp, timestamp } from "../logging.js";
import { assertMatrix16x96, PixelMatrix } from "../../matrix/core16x96.js";
import { buildMatrixProgramUpload, parseStreamFramesFromBuffer, splitBleWrites } from "./coolleduXProtocol.js";

export type DiscoveredDisplay = AdvertisementSnapshot & {
  matchReasons: string[];
};

export type CharacteristicInspection = {
  serviceUuid: string;
  uuid: string;
  name?: string;
  type?: string;
  properties: string[];
  read?: ReturnType<typeof byteView>;
  readError?: string;
  notifications: Array<{
    timestamp: string;
    isNotification: boolean;
    data: ReturnType<typeof byteView>;
  }>;
  subscribeError?: string;
};

export type InspectionResult = {
  deviceName: string;
  peripheral: {
    id: string;
    address?: string;
    addressType?: string;
    localName?: string;
    rssi: number;
  };
  services: Array<{
    uuid: string;
    name?: string;
    type?: string;
    characteristics: CharacteristicInspection[];
  }>;
  logPath?: string;
};

export type WritableCharacteristic = {
  service: Service;
  characteristic: Characteristic;
  score: number;
  reasons: string[];
};

export class CoolLedUxDisplay {
  private peripheral: Peripheral | undefined;
  private services: Service[] = [];
  intensity = 1;

  constructor(private readonly options: { deviceName: string; deviceId?: string; width: number; height: number }) {}

  async scan(): Promise<DiscoveredDisplay[]> {
    await waitForPoweredOn();
    const matches = new Map<string, DiscoveredDisplay>();

    const onDiscover = (peripheral: Peripheral) => {
      const snapshot = snapshotAdvertisement(peripheral);
      const matchReasons = matchDisplayAdvertisement(snapshot, this.options.deviceName);
      if (matchReasons.length === 0) return;
      matches.set(snapshot.id, { ...snapshot, matchReasons });
      printDisplayMatch(matches.get(snapshot.id)!);
    };

    noble.on("discover", onDiscover);
    await startScanning();
    console.log(`Scanning for ${this.options.deviceName}, CoolLED, LED, UX. Ctrl+C to stop.`);

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
    });

    noble.removeListener("discover", onDiscover);
    await stopScanning().catch(() => undefined);
    return [...matches.values()];
  }

  async connect(): Promise<void> {
    if (this.peripheral?.state === "connected") return;
    const peripheral = await findPeripheral(this.options);
    console.log(`Connecting to id=${peripheral.id} name=${peripheral.advertisement.localName ?? "n/a"} rssi=${peripheral.rssi}`);
    await connectDiscoveredPeripheral(peripheral);
    this.peripheral = peripheral;
    console.log(`Connected peripheral id=${this.peripheral.id} name=${this.peripheral.advertisement.localName ?? "n/a"}`);
  }

  async disconnect(): Promise<void> {
    if (!this.peripheral) return;
    await disconnectQuietly(this.peripheral);
    this.peripheral = undefined;
    this.services = [];
  }

  async inspect(): Promise<InspectionResult> {
    await this.connect();
    const peripheral = this.requirePeripheral();
    this.services = await discoverServices(peripheral);
    const result: InspectionResult = {
      deviceName: this.options.deviceName,
      peripheral: {
        id: peripheral.id,
        address: peripheral.address,
        addressType: peripheral.addressType,
        localName: peripheral.advertisement.localName,
        rssi: peripheral.rssi
      },
      services: []
    };

    console.log(`Discovered ${this.services.length} service(s).`);
    for (const service of this.services) {
      console.log(`service ${service.uuid} ${service.name ?? ""}`);
      const characteristics = await discoverCharacteristics(service);
      const serviceInspection = {
        uuid: service.uuid,
        name: service.name,
        type: service.type,
        characteristics: [] as CharacteristicInspection[]
      };

      for (const characteristic of characteristics) {
        serviceInspection.characteristics.push(await this.inspectCharacteristic(service.uuid, characteristic));
      }

      result.services.push(serviceInspection);
    }

    if (result.services.some((service) => service.characteristics.some((char) => char.notifications.length > 0 || canNotifyLike(char.properties)))) {
      console.log("Listening for notifications for 30s...");
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }

    result.logPath = await saveInspectionResult(this.options.deviceName, result);
    console.log(`Saved inspection log to ${result.logPath}`);
    return result;
  }

  async sendMatrix(matrix: PixelMatrix, label = "matrix frame"): Promise<void> {
    assertMatrix16x96(matrix);
    await this.connect();
    const writable = await this.getWritableCharacteristics();
    if (writable.length === 0) throw new Error("No writable BLE characteristics were discovered on the display.");

    const candidate = writable[0];
    console.log(`Likely write characteristic service=${candidate.service.uuid} char=${candidate.characteristic.uuid}`);
    console.log(`Reason: ${candidate.reasons.join("; ")}`);

    const notifications: Buffer<ArrayBufferLike>[] = [];
    let notificationBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    if (canNotify(candidate.characteristic)) {
      candidate.characteristic.on("data", (data) => {
        notificationBuffer = Buffer.concat([notificationBuffer, data]);
        const parsed = parseStreamFramesFromBuffer(notificationBuffer);
        notificationBuffer = parsed.remaining;
        for (const frame of parsed.frames) {
          notifications.push(frame);
          const view = byteView(frame);
          console.log(`Protocol notification len=${frame.length} utf8=${view.utf8 ?? "n/a"} dec=[${view.decimal.join(",")}]`);
        }
      });
      await subscribeCharacteristic(candidate.characteristic);
    }

    const upload = buildMatrixProgramUpload(matrix, this.intensity);
    console.log(
      `CoolLEDUX upload: raw=${upload.rawProgramLength} compressed=${upload.compressedLength} compressed=${upload.compressed} packets=${upload.packets.length}`
    );
    for (let packetIndex = 0; packetIndex < upload.packets.length; packetIndex += 1) {
      const packet = upload.packets[packetIndex];
      const bleWrites = splitBleWrites(packet, 20);
      console.log(`Protocol packet ${packetIndex + 1}/${upload.packets.length}: frameBytes=${packet.length} bleWrites=${bleWrites.length}`);
      for (const chunk of bleWrites) {
        await writeCharacteristic(candidate.characteristic, chunk, true);
        await sleepMs(50);
      }
      await sleepMs(300);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`Protocol upload completed for "${label}". Notification count after write: ${notifications.length}.`);
  }

  async probe(): Promise<WritableCharacteristic[]> {
    await this.connect();
    const writable = await this.getWritableCharacteristics();
    if (writable.length === 0) {
      console.log("No writable characteristics found.");
      return [];
    }

    for (const candidate of writable) {
      console.log(
        `candidate service=${candidate.service.uuid} char=${candidate.characteristic.uuid} props=${candidate.characteristic.properties.join(",")} score=${candidate.score}`
      );
      for (const reason of candidate.reasons) console.log(`  - ${reason}`);
    }

    console.log("No random probe bytes were sent. UX image/text commands remain unresolved from public references.");
    return writable;
  }

  private async getWritableCharacteristics(): Promise<WritableCharacteristic[]> {
    const peripheral = this.requirePeripheral();
    if (this.services.length === 0) this.services = await discoverServices(peripheral);

    const candidates: WritableCharacteristic[] = [];
    for (const service of this.services) {
      const characteristics = await discoverCharacteristics(service);
      for (const characteristic of characteristics) {
        if (!canWrite(characteristic)) continue;
        candidates.push(scoreWritableCharacteristic(service, characteristic));
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  private async inspectCharacteristic(serviceUuid: string, characteristic: Characteristic): Promise<CharacteristicInspection> {
    const record: CharacteristicInspection = {
      serviceUuid,
      uuid: characteristic.uuid,
      name: characteristic.name,
      type: characteristic.type,
      properties: characteristic.properties,
      notifications: []
    };

    console.log(`  char ${characteristic.uuid} props=${characteristic.properties.join(",") || "none"}`);

    if (canRead(characteristic)) {
      try {
        const data = await readCharacteristic(characteristic);
        record.read = byteView(data);
        console.log(`    read len=${record.read.decimal.length} utf8=${record.read.utf8 ?? "n/a"} dec=[${record.read.decimal.join(",")}]`);
      } catch (error) {
        record.readError = error instanceof Error ? error.message : String(error);
        console.log(`    read failed: ${record.readError}`);
      }
    }

    if (canNotify(characteristic)) {
      try {
        await subscribeCharacteristic(characteristic);
        console.log("    subscribed");
        characteristic.on("data", (data, isNotification) => {
          const event = {
            timestamp: timestamp(),
            isNotification,
            data: byteView(data)
          };
          record.notifications.push(event);
          console.log(`    notify ${event.timestamp} len=${event.data.decimal.length} utf8=${event.data.utf8 ?? "n/a"} dec=[${event.data.decimal.join(",")}]`);
        });
      } catch (error) {
        record.subscribeError = error instanceof Error ? error.message : String(error);
        console.log(`    subscribe failed: ${record.subscribeError}`);
      }
    }

    return record;
  }

  private requirePeripheral(): Peripheral {
    if (!this.peripheral) throw new Error("Display is not connected.");
    return this.peripheral;
  }
}

export function matchDisplayAdvertisement(snapshot: AdvertisementSnapshot, exactName: string): string[] {
  const reasons: string[] = [];
  const haystack = [snapshot.localName, snapshot.id, snapshot.address, ...snapshot.serviceUuids].filter(Boolean).join(" ").toLowerCase();
  const exact = exactName.toLowerCase();
  if (snapshot.localName?.toLowerCase() === exact) reasons.push(`exact name ${exactName}`);
  if (snapshot.localName?.toLowerCase() === "coolleduX".toLowerCase()) reasons.push("advertises as CoolLEDUX");
  if (snapshot.serviceUuids.includes("fff0")) reasons.push("advertises CoolLED-style service fff0");
  if (snapshot.manufacturerDataHex?.toLowerCase().startsWith("df01")) reasons.push("manufacturer data starts with df01");
  for (const token of ["coolledu", "coolled", "led", "ux", "led1248"]) {
    if (haystack.includes(token)) reasons.push(`contains ${token}`);
  }
  return [...new Set(reasons)];
}

async function findPeripheral(options: { deviceName: string; deviceId?: string }, timeoutMs = 30000): Promise<Peripheral> {
  await waitForPoweredOn();
  return new Promise((resolve, reject) => {
    let seenCount = 0;
    let lastTargetLike: AdvertisementSnapshot | undefined;
    const timeout = setTimeout(async () => {
      noble.removeListener("discover", onDiscover);
      await stopScanning().catch(() => undefined);
      const targetHint = options.deviceId ? `id ${options.deviceId}` : `device named ${options.deviceName}`;
      const lastHint = lastTargetLike
        ? ` Last target-like advertisement: name=${lastTargetLike.localName ?? "n/a"} id=${lastTargetLike.id} services=${lastTargetLike.serviceUuids.join(",") || "none"} manufacturer=${lastTargetLike.manufacturerDataHex ?? "none"} rssi=${lastTargetLike.rssi}.`
        : "";
      reject(new Error(`Timed out scanning for BLE ${targetHint} after seeing ${seenCount} advertisement event(s).${lastHint}`));
    }, timeoutMs);

    const onDiscover = (peripheral: Peripheral) => {
      const snapshot = snapshotAdvertisement(peripheral);
      seenCount += 1;
      if (isTargetLikeAdvertisement(snapshot, options.deviceName)) {
        lastTargetLike = snapshot;
        console.log(
          `Saw target-like advertisement name=${snapshot.localName ?? "n/a"} id=${snapshot.id} services=${snapshot.serviceUuids.join(",") || "none"} manufacturer=${snapshot.manufacturerDataHex ?? "none"} rssi=${snapshot.rssi}`
        );
      }
      if (!isTargetDisplayAdvertisement(snapshot, options)) return;
      clearTimeout(timeout);
      noble.removeListener("discover", onDiscover);
      stopScanning()
        .catch(() => undefined)
        .then(() => resolve(peripheral));
    };

    noble.on("discover", onDiscover);
    startScanning().catch((error) => {
      clearTimeout(timeout);
      noble.removeListener("discover", onDiscover);
      reject(error);
    });
  });
}

function connectDiscoveredPeripheral(peripheral: Peripheral): Promise<void> {
  return new Promise((resolve, reject) => {
    peripheral.connect((error) => (error ? reject(new Error(error)) : resolve()));
  });
}

function isTargetDisplayAdvertisement(snapshot: AdvertisementSnapshot, options: { deviceName: string; deviceId?: string }): boolean {
  if (options.deviceId && snapshot.id === options.deviceId) return true;
  if (snapshot.localName === options.deviceName) return true;
  return isTargetLikeAdvertisement(snapshot, options.deviceName);
}

function isTargetLikeAdvertisement(snapshot: AdvertisementSnapshot, deviceName: string): boolean {
  if (snapshot.localName !== "CoolLEDUX") return false;
  return snapshot.serviceUuids.includes("fff0") || snapshot.manufacturerDataHex?.toLowerCase().startsWith("df01") === true;
}

function scoreWritableCharacteristic(service: Service, characteristic: Characteristic): WritableCharacteristic {
  let score = 0;
  const reasons: string[] = [];
  const serviceUuid = normalizeUuid(service.uuid);
  const charUuid = normalizeUuid(characteristic.uuid);

  if (characteristic.properties.includes("writeWithoutResponse")) {
    score += 30;
    reasons.push("supports writeWithoutResponse, common for BLE display data streams");
  }
  if (characteristic.properties.includes("write")) {
    score += 20;
    reasons.push("supports acknowledged writes");
  }
  if (serviceUuid === "fff0" || serviceUuid === "fff1") {
    score += 25;
    reasons.push("matches public CoolLEDX/CoolLEDM service UUID references");
  }
  if (charUuid === "2aa6") {
    score += 25;
    reasons.push("matches public CoolLEDX/CoolLEDM write characteristic reference");
  }
  if (charUuid === "fff1") {
    score += 25;
    reasons.push("matches this display's discovered fff1 read/writeWithoutResponse/notify characteristic");
  }
  if (!service.name && serviceUuid.length <= 8) {
    score += 5;
    reasons.push("vendor-looking short service UUID");
  }

  if (reasons.length === 0) reasons.push("writable characteristic");
  return { service, characteristic, score, reasons };
}

function printDisplayMatch(display: DiscoveredDisplay): void {
  console.log(
    [
      `MATCH ${display.timestamp}`,
      `name=${display.localName ?? "n/a"}`,
      `id=${display.id}`,
      `address=${display.address ?? "n/a"}`,
      `rssi=${display.rssi}`,
      `services=${display.serviceUuids.join(",") || "none"}`,
      `manufacturer=${display.manufacturerDataHex ?? "none"}`,
      `serviceData=${display.serviceData.map((entry) => `${entry.uuid}:${entry.dataHex}`).join(",") || "none"}`,
      `reasons=${display.matchReasons.join(",")}`
    ].join(" ")
  );
}

function canNotifyLike(properties: string[]): boolean {
  return properties.includes("notify") || properties.includes("indicate");
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveInspectionResult(deviceName: string, result: InspectionResult): Promise<string> {
  await mkdir("logs", { recursive: true });
  const safeName = deviceName.replace(/[^a-z0-9_-]/gi, "_");
  const filePath = path.join("logs", `led-inspect-${safeName}-${sessionStamp()}.json`);
  await writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}
