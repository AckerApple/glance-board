declare module "@abandonware/noble" {
  import { EventEmitter } from "node:events";

  export interface Advertisement {
    localName?: string;
    txPowerLevel?: number;
    serviceUuids?: string[];
    serviceSolicitationUuid?: string[];
    manufacturerData?: Buffer;
    serviceData?: Array<{ uuid: string; data: Buffer }>;
  }

  export interface Characteristic extends EventEmitter {
    uuid: string;
    name?: string;
    type?: string;
    properties: string[];
    read(callback: (error: string | null, data: Buffer) => void): void;
    write(data: Buffer, withoutResponse: boolean, callback?: (error: string | null) => void): void;
    subscribe(callback?: (error: string | null) => void): void;
    unsubscribe(callback?: (error: string | null) => void): void;
    on(event: "data", listener: (data: Buffer, isNotification: boolean) => void): this;
  }

  export interface Service {
    uuid: string;
    name?: string;
    type?: string;
    discoverCharacteristics(
      characteristicUuids: string[],
      callback: (error: string | null, characteristics: Characteristic[]) => void
    ): void;
  }

  export interface Peripheral extends EventEmitter {
    id: string;
    uuid?: string;
    address?: string;
    addressType?: string;
    connectable?: boolean;
    advertisement: Advertisement;
    rssi: number;
    state?: string;
    connect(callback?: (error: string | null) => void): void;
    disconnect(callback?: (error: string | null) => void): void;
    discoverServices(serviceUuids: string[], callback: (error: string | null, services: Service[]) => void): void;
  }

  export interface Noble extends EventEmitter {
    state: string;
    startScanning(serviceUuids?: string[], allowDuplicates?: boolean, callback?: (error?: Error) => void): void;
    stopScanning(callback?: () => void): void;
    on(event: "stateChange", listener: (state: string) => void): this;
    on(event: "discover", listener: (peripheral: Peripheral) => void): this;
    removeListener(event: "discover", listener: (peripheral: Peripheral) => void): this;
  }

  const noble: Noble;
  export default noble;
}
