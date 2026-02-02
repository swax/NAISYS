// Aggregate costs within this time window (in milliseconds)
export const COST_AGGREGATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Calculate the current period boundaries based on a given number of hours.
 * Periods are fixed multiples of hours from midnight (server local time).
 */
export function calculatePeriodBoundaries(hours: number): {
  periodStart: Date;
  periodEnd: Date;
} {
  const now = new Date();

  // Get midnight of current day in local time
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  // Calculate milliseconds since midnight
  const msSinceMidnight = now.getTime() - midnight.getTime();
  const hoursSinceMidnight = msSinceMidnight / (1000 * 60 * 60);

  // Calculate which period we're in (0, 1, 2, ...)
  const periodIndex = Math.floor(hoursSinceMidnight / hours);

  // Calculate period start and end
  const periodStartHours = periodIndex * hours;
  const periodEndHours = (periodIndex + 1) * hours;

  const periodStart = new Date(
    midnight.getTime() + periodStartHours * 60 * 60 * 1000,
  );
  const periodEnd = new Date(
    midnight.getTime() + periodEndHours * 60 * 60 * 1000,
  );

  return { periodStart, periodEnd };
}
