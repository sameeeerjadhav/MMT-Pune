import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL, refreshAccessTokenOnce } from '../api/client';
import * as storage from './secureStorage';

function ensureFileUri(uri: string) {
  if (!uri) return uri;
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

const TYPES = {
  csv: { mimeType: 'text/csv', uti: 'public.comma-separated-values-text' },
} as const;

/**
 * Downloads an authenticated API file (e.g. a CSV report) to the app cache and opens the
 * share sheet so the user can save it or send it to Excel / email / Drive.
 */
export async function downloadAndShareFile(path: string, filename: string, kind: keyof typeof TYPES = 'csv') {
  if (Platform.OS === 'web') {
    throw new Error('Exports need the phone app - web download is limited here');
  }
  const token = await storage.getItem('accessToken');
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!dir) throw new Error('File cache is unavailable on this device');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = ensureFileUri(`${dir}${safeName}`);

  const download = (bearer: string | null) =>
    FileSystem.downloadAsync(url, target, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
  let result = await download(token);
  if (result.status === 401) {
    const fresh = await refreshAccessTokenOnce();
    if (fresh) result = await download(fresh);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Export failed (${result.status})`);
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is unavailable on this device - the file was saved to app cache only');
  }
  const fileUri = ensureFileUri(result.uri);
  await Sharing.shareAsync(fileUri, {
    mimeType: TYPES[kind].mimeType,
    dialogTitle: filename,
    UTI: TYPES[kind].uti,
  });
  return fileUri;
}
