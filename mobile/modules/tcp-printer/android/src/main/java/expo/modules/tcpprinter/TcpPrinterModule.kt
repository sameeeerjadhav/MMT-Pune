package expo.modules.tcpprinter

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Sends raw printer-language bytes (ZPL / TSPL) to a network label printer over TCP.
 * Typical Zebra / TSC / Godex Wi-Fi printers listen on port 9100.
 */
class TcpPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TcpPrinter")

    AsyncFunction("sendRaw") { host: String, port: Int, data: String, timeoutMs: Int ->
      if (host.isBlank()) throw Exception("Printer host is empty")
      if (port !in 1..65535) throw Exception("Invalid printer port: $port")
      val bytes = data.toByteArray(Charsets.UTF_8)
      Socket().use { socket ->
        socket.soTimeout = timeoutMs
        socket.connect(InetSocketAddress(host, port), timeoutMs)
        val out = socket.getOutputStream()
        out.write(bytes)
        out.flush()
      }
      true
    }
  }
}
