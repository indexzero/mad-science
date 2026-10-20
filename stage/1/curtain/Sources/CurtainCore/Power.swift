/// Arguments for pmset. The executable runs the process. Design section 5.3.
public enum Power {
    /// "07:00" -> ["repeat", "wakeorpoweron", "MTWRFSU", "07:00:00"].
    /// "7:30" -> [..., "07:30:00"]. "07:00:00" passes through.
    /// Any other shape yields the raw text plus ":00" so pmset reports the error.
    public static func pmsetArgs(wake: String) -> [String] {
        ["repeat", "wakeorpoweron", "MTWRFSU", wakeTime(wake)]
    }

    /// ["displaysleepnow"]
    public static var displaySleepArgs: [String] { ["displaysleepnow"] }

    /// The "HH:MM:SS" text for `pmsetArgs`. Shape only, no range check.
    static func wakeTime(_ wake: String) -> String {
        let parts = wake.split(separator: ":", omittingEmptySubsequences: false)
        let allDigits = parts.allSatisfy { !$0.isEmpty && $0.allSatisfy(Schedule.isASCIIDigit) }
        guard allDigits else { return wake + ":00" }
        switch parts.count {
        case 2 where (1...2).contains(parts[0].count) && parts[1].count == 2:
            let hour = parts[0].count == 1 ? "0" + parts[0] : String(parts[0])
            return "\(hour):\(parts[1]):00"
        case 3 where parts[0].count == 2 && parts[1].count == 2 && parts[2].count == 2:
            return wake
        default:
            return wake + ":00"
        }
    }
}
