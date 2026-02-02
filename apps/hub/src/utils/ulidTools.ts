import { decodeTime } from "@naisys/database";

// Crockford's Base32 alphabet used by ULID
const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Encode a timestamp as a ULID prefix (first 10 characters)
// This creates the minimum ULID for a given timestamp
function encodeTimestampAsUlidPrefix(timestamp: number): string {
  let encoded = "";
  let time = timestamp;
  for (let i = 0; i < 10; i++) {
    encoded = ULID_ENCODING[time % 32] + encoded;
    time = Math.floor(time / 32);
  }
  return encoded;
}

// Generate a minimum ULID for a given timestamp (all zeros in random part)
export function minUlidForTime(date: Date): string {
  return encodeTimestampAsUlidPrefix(date.getTime()) + "0000000000000000";
}

// Check if a ULID was created within a given time window (in milliseconds)
export function isUlidWithinWindow(ulidId: string, windowMs: number): boolean {
  const recordTime = decodeTime(ulidId);
  const now = Date.now();
  return now - recordTime < windowMs;
}
