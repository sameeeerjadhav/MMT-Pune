package expo.modules.savetodownloads

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class SaveToDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaveToDownloads")

    AsyncFunction("saveBase64Pdf") { fileName: String, base64: String ->
      val context = appContext.reactContext
        ?: throw Exception("React context unavailable")
      val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_").let {
        if (it.lowercase().endsWith(".pdf")) it else "$it.pdf"
      }
      val bytes = Base64.decode(base64, Base64.DEFAULT)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, safeName)
          put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val item = resolver.insert(collection, values)
          ?: throw Exception("Could not create Downloads entry")
        resolver.openOutputStream(item)?.use { it.write(bytes) }
          ?: throw Exception("Could not write PDF to Downloads")
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(item, values, null, null)
        return@AsyncFunction item.toString()
      }

      val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      if (!downloads.exists()) downloads.mkdirs()
      val outFile = File(downloads, safeName)
      FileOutputStream(outFile).use { it.write(bytes) }
      outFile.absolutePath
    }
  }
}
