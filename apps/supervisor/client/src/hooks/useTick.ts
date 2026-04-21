import { useEffect, useState } from "react";

/** Returns a counter that increments every `intervalMs`, used to force
 * periodic re-renders of time-derived values like the "online" badge. */
export const useTick = (intervalMs: number) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
};
