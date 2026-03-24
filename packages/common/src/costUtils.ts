/**
 * Calculate the current period boundaries based on a given number of hours.
 * Periods are fixed multiples of hours from midnight (server local time).
 * The reason we don't slide the window is that we don't want to the llm to get stuck sending off a query
 * only for the window to close again, and the llm cache to *expire* creating a cycle of constant cache misses
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
