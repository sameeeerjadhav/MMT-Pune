/**
 * Wi-Fi label printer transport. The backend builds ZPL/TSPL commands; the phone opens a TCP
 * socket to the printer (usually port 9100) on the same Wi-Fi and writes them.
 *
 * Needs the tcp-printer native module, so it only works in a build made after it was added
 * (not Expo Go). Not yet verified on a physical printer.
 */
import { isTcpPrinterAvailable, sendRawToPrinter } from '../../../modules/tcp-printer/src';

export type NetworkPrinterTarget = {
  name?: string;
  host: string;
  port: number;
};

export function printerTargetLabel(target: NetworkPrinterTarget) {
  return `${target.name ? `${target.name} · ` : ''}${target.host}:${target.port}`;
}

function friendlyPrintError(target: NetworkPrinterTarget, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const where = printerTargetLabel(target);
  const lower = raw.toLowerCase();
  if (raw === 'PRINTER_NOT_AVAILABLE') {
    return new Error('Wi-Fi printing needs the newest app build. Install the latest APK, then try again.');
  }
  if (lower.includes('refused')) {
    return new Error(`${where} refused the connection. Check the port (usually 9100) and that the printer is on.`);
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new Error(`${where} did not respond. Check that the phone and printer are on the same Wi-Fi.`);
  }
  if (lower.includes('unreachable') || lower.includes('no route') || lower.includes('network is')) {
    return new Error(`${where} is not reachable on this Wi-Fi network.`);
  }
  return new Error(`Could not send to ${where}${raw ? `: ${raw}` : '.'}`);
}

/** Writes printer-language commands to the printer. Throws a readable Error on failure. */
export async function sendLabelToPrinter(target: NetworkPrinterTarget, commands: string) {
  if (!isTcpPrinterAvailable()) {
    throw friendlyPrintError(target, new Error('PRINTER_NOT_AVAILABLE'));
  }
  try {
    await sendRawToPrinter(target.host, target.port, commands, 6000);
  } catch (error) {
    throw friendlyPrintError(target, error);
  }
}

export { isTcpPrinterAvailable };
