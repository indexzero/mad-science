const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

export function unixMillisToIso(millis) {
  if (millis == null) return null;
  return new Date(Number(millis)).toISOString();
}

export function windowsMicrosToIso(micros) {
  if (micros == null) return null;
  return unixMillisToIso((BigInt(micros) - WINDOWS_EPOCH_OFFSET_MICROS) / 1000n);
}
