import { PermissionsAndroid, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  isSaveToDownloadsAvailable,
  saveBase64PdfToDownloads,
} from '../../modules/save-to-downloads/src';

function stripDataUrl(base64OrDataUrl: string) {
  const idx = base64OrDataUrl.indexOf('base64,');
  return idx >= 0 ? base64OrDataUrl.slice(idx + 7) : base64OrDataUrl;
}

export function safePdfFileName(filename: string) {
  const base = (filename || 'file.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

async function tryDirectPublicDownloads(b64: string, name: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  if (typeof Platform.Version === 'number' && Platform.Version < 29) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;
    } catch {
      return null;
    }
  }

  for (const dest of [
    `file:///storage/emulated/0/Download/${name}`,
    `file:///sdcard/Download/${name}`,
  ]) {
    try {
      await FileSystem.writeAsStringAsync(dest, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists && (typeof info.size !== 'number' || info.size > 64)) {
        return dest;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/** Silent save into app storage (never shows Android folder-picker / privacy dialog). */
async function saveSilentlyToAppStorage(b64: string, name: string) {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!root) throw new Error('File storage unavailable on this device');

  const folder = `${root}Download/`;
  try {
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  } catch {
    /* may already exist */
  }

  const dest = `${folder}${name}`;
  await FileSystem.writeAsStringAsync(dest, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists || (typeof info.size === 'number' && info.size < 64)) {
    throw new Error('PDF file was not saved correctly');
  }
  return dest;
}

/**
 * Save PDF with no share sheet and no folder picker.
 *
 * Order:
 * 1) Native MediaStore → public Downloads (dev/production builds)
 * 2) Direct public Download path (older Android)
 * 3) App Download folder (Expo Go — silent, no privacy dialog)
 */
export async function savePdfBase64ToDownloads(pdfBase64: string, filename: string) {
  if (Platform.OS === 'web') {
    throw new Error('Save PDF on a phone/tablet — web download is limited in Expo Go');
  }

  const name = safePdfFileName(filename);
  const b64 = stripDataUrl(pdfBase64);

  if (Platform.OS === 'android' && isSaveToDownloadsAvailable()) {
    try {
      const uri = await saveBase64PdfToDownloads(name, b64);
      return { uri, location: 'Downloads' as const, public: true };
    } catch {
      /* fall through */
    }
  }

  if (Platform.OS === 'android') {
    const direct = await tryDirectPublicDownloads(b64, name);
    if (direct) return { uri: direct, location: 'Downloads' as const, public: true };
  }

  const uri = await saveSilentlyToAppStorage(b64, name);
  return { uri, location: 'Download' as const, public: false };
}
