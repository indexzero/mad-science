import Foundation

/// Write one log line to stderr: an ISO8601 UTC timestamp, a space, the
/// message, a newline. Every state change in the executable logs one
/// line through this function. launchd routes stderr to
/// `~/Library/Logs/family.curtain/curtain.err.log` (design section 11).
func log(_ message: String) {
    let stamp = Date().formatted(.iso8601)
    let line = "\(stamp) \(message)\n"
    FileHandle.standardError.write(Data(line.utf8))
}
