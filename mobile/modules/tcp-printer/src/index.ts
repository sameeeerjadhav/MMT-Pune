import { requireOptionalNativeModule } from 'expo-modules-core';

type TcpPrinterNative = {
  sendRaw(host: string, port: number, data: string, timeoutMs: number): Promise<boolean>;
};

const native = requireOptionalNativeModule<TcpPrinterNative>('TcpPrinter');

/** False in Expo Go or any build that predates this module (needs a new APK build). */
export function isTcpPrinterAvailable() {
  return Boolean(native?.sendRaw);
}

/** Opens a TCP connection to the printer, writes the commands, and closes. */
export async function sendRawToPrinter(host: string, port: number, data: string, timeoutMs = 6000) {
  if (!native?.sendRaw) {
    throw new Error('PRINTER_NOT_AVAILABLE');
  }
  return native.sendRaw(host, port, data, timeoutMs);
}
