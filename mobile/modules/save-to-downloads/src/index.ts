import { requireOptionalNativeModule } from 'expo-modules-core';

type SaveToDownloadsNative = {
  saveBase64Pdf(fileName: string, base64: string): Promise<string>;
};

const native = requireOptionalNativeModule<SaveToDownloadsNative>('SaveToDownloads');

export function isSaveToDownloadsAvailable() {
  return Boolean(native?.saveBase64Pdf);
}

/** Silent save into the public Downloads collection (MediaStore). Needs a dev/production build. */
export async function saveBase64PdfToDownloads(fileName: string, base64: string) {
  if (!native?.saveBase64Pdf) {
    throw new Error('SAVE_TO_DOWNLOADS_UNAVAILABLE');
  }
  return native.saveBase64Pdf(fileName, base64);
}
