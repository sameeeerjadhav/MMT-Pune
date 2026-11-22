import ExpoModulesCore
import Foundation

public class SaveToDownloadsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SaveToDownloads")

    AsyncFunction("saveBase64Pdf") { (fileName: String, base64: String) -> String in
      let cleaned = fileName.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
      let name = cleaned.lowercased().hasSuffix(".pdf") ? cleaned : "\(cleaned).pdf"
      guard let data = Data(base64Encoded: base64) else {
        throw NSError(domain: "SaveToDownloads", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid PDF data"])
      }
      let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
      let url = docs.appendingPathComponent(name)
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    }
  }
}
