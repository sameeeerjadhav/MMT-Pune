/**
 * Printer HAL. Demo uses on-screen label preview + print-log API.
 * Future: Zebra Link-OS SDK — not claimed complete without hardware testing.
 */

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PrintJob {
  barcodeValue: string;
  labelLines: string[];
  copies?: number;
}

export interface PrinterService {
  getStatus(): Promise<PrinterStatus>;
  connect(): Promise<void>;
  print(job: PrintJob): Promise<{ success: boolean; message?: string }>;
}

export class PreviewPrinterService implements PrinterService {
  async getStatus() {
    return 'connected' as const;
  }
  async connect() {}
  async print(job: PrintJob) {
    return { success: true, message: `Preview only for ${job.barcodeValue}` };
  }
}

export class ZebraLinkOsStub implements PrinterService {
  async getStatus() {
    return 'disconnected' as const;
  }
  async connect() {
    throw new Error('Zebra Link-OS not tested on physical printer yet.');
  }
  async print() {
    return { success: false, message: 'Hardware printer not connected' };
  }
}

export const activePrinter: PrinterService = new PreviewPrinterService();
