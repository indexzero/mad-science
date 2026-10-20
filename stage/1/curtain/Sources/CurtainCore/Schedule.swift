import Foundation

/// Wall clock rules. All minutes are minutes past midnight in 0...1439.
/// Chat fragment, message [11], corrected for Swift 6 and testability.
public enum Schedule {
    /// All three values are minutes past midnight in 0...1439.
    /// `now` outside the range is wrapped with a positive modulo.
    /// `wake == bed` disables bedtime: the result is always true.
    public static func awake(now: Int, wake: Int, bed: Int) -> Bool {
        let m = ((now % 1440) + 1440) % 1440
        if wake == bed { return true }
        return wake < bed ? (wake..<bed).contains(m) : !(bed..<wake).contains(m)
    }

    /// Hour * 60 + minute of `date` in `calendar` (its time zone decides).
    public static func minutesPastMidnight(_ date: Date, calendar: Calendar) -> Int {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// "HH:MM" or "H:MM" to minutes past midnight. nil on any other shape or range.
    /// The hour part has one or two digits. The minute part has two digits.
    public static func parseHHMM(_ text: String) -> Int? {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let hourText = parts[0]
        let minuteText = parts[1]
        guard (1...2).contains(hourText.count), minuteText.count == 2 else { return nil }
        guard hourText.allSatisfy(isASCIIDigit), minuteText.allSatisfy(isASCIIDigit) else { return nil }
        guard let hour = Int(hourText), let minute = Int(minuteText) else { return nil }
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    /// true for "0" to "9" only. `Int(_:)` alone accepts "+" and other digit sets.
    static func isASCIIDigit(_ character: Character) -> Bool {
        character.isASCII && character.isNumber
    }
}
