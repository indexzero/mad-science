import ApplicationServices
import CoreGraphics

public struct DarwinPermissionState: Codable, Equatable, Sendable {
    public let accessibility: Bool
    public let screenRecording: Bool

    public init(
        accessibility: Bool = AXIsProcessTrusted(),
        screenRecording: Bool = CGPreflightScreenCaptureAccess())
    {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
    }
}
