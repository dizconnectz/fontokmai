/** Reference scorer for the review plan, not production code or a claim of forecast skill.
 * The caller must align station/area, accumulation interval, units and observation QC first.
 */
export type Pair = {
  key: string; // one location, target interval, lead bin and frozen forecast version
  publishedAt: number;
  availableAt: number; // latest input availability, including model availability
  targetStart: number;
  forecastMm: number | null;
  observedMm: number | null; // null means no verified truth, never a dry observation
};

export function scoreRain(pairs: Pair[], thresholdMm: number) {
  if (!Number.isFinite(thresholdMm) || thresholdMm <= 0)
    throw new Error("invalid threshold");
  const seen = new Set<string>();
  let hits = 0,
    misses = 0,
    falseAlarms = 0,
    correctNegatives = 0;
  let unknownTruth = 0,
    unknownForecast = 0,
    leakage = 0,
    absoluteError = 0,
    bias = 0;
  for (const pair of pairs) {
    if (seen.has(pair.key)) throw new Error("duplicate evaluation pair");
    seen.add(pair.key);
    if (
      ![pair.publishedAt, pair.availableAt, pair.targetStart].every(
        Number.isFinite,
      )
    )
      throw new Error("invalid timestamp");
    if (
      pair.availableAt > pair.publishedAt ||
      pair.publishedAt > pair.targetStart
    ) {
      leakage++;
      continue;
    }
    if (pair.observedMm === null) {
      unknownTruth++;
      continue;
    }
    if (pair.forecastMm === null) {
      unknownForecast++;
      continue;
    }
    if (
      ![pair.forecastMm, pair.observedMm].every(
        (v) => Number.isFinite(v) && v >= 0,
      )
    )
      throw new Error("invalid rain");
    const wet = pair.observedMm >= thresholdMm,
      predicted = pair.forecastMm >= thresholdMm;
    if (wet && predicted) hits++;
    else if (wet) misses++;
    else if (predicted) falseAlarms++;
    else correctNegatives++;
    const error = pair.forecastMm - pair.observedMm;
    absoluteError += Math.abs(error);
    bias += error;
  }
  const n = hits + misses + falseAlarms + correctNegatives;
  const divide = (a: number, b: number) => (b ? a / b : null);
  return {
    n,
    hits,
    misses,
    falseAlarms,
    correctNegatives,
    unknownTruth,
    unknownForecast,
    leakage,
    maeMm: divide(absoluteError, n),
    biasMm: divide(bias, n),
    pod: divide(hits, hits + misses),
    far: divide(falseAlarms, hits + falseAlarms),
    csi: divide(hits, hits + misses + falseAlarms),
  };
}
