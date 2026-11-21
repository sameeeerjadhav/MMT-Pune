import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../api/client';
import * as storage from './secureStorage';

export async function downloadAndSharePdf(path: string, filename: string) {
  const token = await storage.getItem('accessToken');
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error('File cache is unavailable on this device');
  }
  const target = `${dir}${filename}`;

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
  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/pdf',
    dialogTitle: filename,
    UTI: 'com.adobe.pdf',
  });
  return result.uri;
}
