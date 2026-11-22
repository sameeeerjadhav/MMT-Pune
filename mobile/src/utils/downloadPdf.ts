import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../api/client';
import * as storage from './secureStorage';

function ensureFileUri(uri: string) {
  if (!uri) return uri;
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

export async function downloadAndSharePdf(path: string, filename: string) {
  const token = await storage.getItem('accessToken');
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error('File cache is unavailable on this device');
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = ensureFileUri(`${dir}${safeName}`);

  const result = await FileSystem.downloadAsync(url, target, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`PDF download failed (${result.status})`);
  }

  if (Platform.OS === 'web') {
    throw new Error('Open PDF on a phone/tablet build — web download is limited in Expo Go');
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is unavailable on this device — PDF was downloaded to cache only');
  }

  // expo-sharing only accepts file:// (not content://).
  const fileUri = ensureFileUri(result.uri);
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/pdf',
    dialogTitle: filename,
    UTI: 'com.adobe.pdf',
  });
  return fileUri;
}
