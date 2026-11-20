/**
 * Hardware abstraction for barcode scanners.
 * Demo: camera / manual / simulated.
 * Future: Zebra DataWedge via Android intents — not claimed complete without device testing.
 */

export type ScannerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ScanResult {
  rawValue: string;
  symbology?: string;
  scannedAt: Date;
  source: 'camera' | 'manual' | 'simulated' | 'datawedge';
}

export interface ScannerService {
  getStatus(): Promise<ScannerConnectionStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export class CameraScannerService implements ScannerService {
  async getStatus() {
    return 'connected' as const;
  }
  async connect() {}
  async disconnect() {}
}

export class ZebraDataWedgeStub implements ScannerService {
  async getStatus() {
    return 'disconnected' as const;
  }
  async connect() {
    throw new Error('Zebra DataWedge not tested on physical device yet.');
  }
  async disconnect() {}
}

export const activeScanner: ScannerService = new CameraScannerService();
