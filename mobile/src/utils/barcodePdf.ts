import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { barcodeApi } from '../api/endpoints';
import { API_BASE_URL } from '../api/client';
import * as storage from './secureStorage';

function stripDataUrl(base64OrDataUrl: string) {
  const idx = base64OrDataUrl.indexOf('base64,');
  return idx >= 0 ? base64OrDataUrl.slice(idx + 7) : base64OrDataUrl;
}

function safePdfName(filename: string) {
  const base = (filename || 'label.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function ensureFileUri(uri: string) {
  if (!uri) return uri;
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

function pdfDir() {
  return FileSystem.documentDirectory || FileSystem.cacheDirectory;
}

/** Write PDF bytes into app storage and open the native share sheet (file:// only). */
async function writeAndSharePdfBase64(pdfBase64: string, filename: string) {
  if (Platform.OS === 'web') {
    throw new Error('Open PDF on a phone/tablet — web share is limited in Expo Go');
  }

  const dir = pdfDir();
  if (!dir) throw new Error('File storage unavailable on this device');

  const name = safePdfName(filename);
  const dest = ensureFileUri(`${dir}barcode-${Date.now()}-${name}`);
  const b64 = stripDataUrl(pdfBase64);

  await FileSystem.writeAsStringAsync(dest, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists || (typeof info.size === 'number' && info.size < 64)) {
    throw new Error('PDF file was not written correctly');
  }

  if (!(await Sharing.isAvailableAsync())) {
    // Last resort: system print dialog (user can Save as PDF).
    await Print.printAsync({ uri: dest });
    return dest;
  }

  // expo-sharing requires file:// — content:// is rejected on current SDK.
  await Sharing.shareAsync(dest, {
    mimeType: 'application/pdf',
    dialogTitle: name,
    UTI: 'com.adobe.pdf',
  });
  return dest;
}

async function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

/** Build a PDF from a label PNG (works without the server PDF route). */
export async function shareLabelPdfFromPng(
  pngBase64OrDataUrl: string,
  filename: string
) {
  const pngB64 = stripDataUrl(pngBase64OrDataUrl);
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      .wrap { padding: 24px; display: flex; justify-content: center; align-items: center; }
      img { width: 100%; max-width: 420px; height: auto; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <img src="data:image/png;base64,${pngB64}" alt="Barcode label" />
    </div>
  </body>
</html>`;

  // Get PDF bytes via base64 — never share/copy expo-print's Print/ temp path.
  const printed = await Print.printToFileAsync({ html, base64: true });
  if (!printed?.base64) {
    // Absolute fallback: open print UI so user can Save as PDF.
    await Print.printAsync({ html });
    return 'printed';
  }
  try {
    return await writeAndSharePdfBase64(printed.base64, filename);
  } catch (shareErr) {
    // If share sheet fails, still give a working path via system print/save.
    try {
      await Print.printAsync({ html });
      return 'printed';
    } catch {
      throw shareErr;
    }
  }
}

/**
 * Prefer server PDF when available; otherwise build PDF from the on-screen label PNG.
 */
export async function downloadOrBuildBarcodePdf(opts: {
  barcodeValue: string;
  labelPngDataUrl?: string | null;
  filename?: string;
}) {
  const filename = opts.filename || `${opts.barcodeValue}-label.pdf`;

  // 1) Try server PDF (after backend deploy).
  try {
    const token = await storage.getItem('accessToken');
    const url = `${API_BASE_URL}${barcodeApi.labelPdfPath(opts.barcodeValue)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && contentType.includes('pdf')) {
      const b64 = await arrayBufferToBase64(await res.arrayBuffer());
      return writeAndSharePdfBase64(b64, filename);
    }
  } catch {
    // Fall through to client PDF.
  }

  // 2) Client PDF from label preview PNG (works on current production API).
  if (opts.labelPngDataUrl) {
    return shareLabelPdfFromPng(opts.labelPngDataUrl, filename);
  }

  // 3) Fetch PNG from API, then convert.
  const detail = await barcodeApi.get(opts.barcodeValue);
  const png = detail.data?.label_image_base64;
  if (!png) {
    throw new Error('Barcode label image is unavailable for PDF');
  }
  return shareLabelPdfFromPng(png, filename);
}
