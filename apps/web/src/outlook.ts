import type { RainOutlook } from '../../../contracts/v1/ts/outlook';

export type { RainOutlook };
export const OUTLOOK_STALE = 24 * 3_600_000;
export const MODEL_NAMES: Record<string, string> = { ecmwf_ifs025: 'ECMWF', gfs05: 'GFS' };
export type OutlookPoint = RainOutlook['points'][number];

/** Equal weight per available model, not per member; no probability calibration is claimed. */
export function dayOutlook(point: OutlookPoint, day: number) {
  const available = point.models.flatMap((model) => {
    const values = model.members
      .map((m) => m.rain_mm[day])
      .filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2000,
      );
    return values.length >= Math.ceil(model.expected_members * 0.8)
      ? [{ model: model.model, values }]
      : [];
  });
  if (!available.length) return null;
  const samples = available
    .flatMap((m) =>
      m.values.map((value) => ({
        value,
        weight: 1 / available.length / m.values.length,
      })),
    )
    .sort((a, b) => a.value - b.value);
  const quantile = (p: number) => {
    let sum = 0;
    for (const sample of samples) {
      sum += sample.weight;
      if (sum + 1e-9 >= p) return sample.value;
    }
    return samples.at(-1)!.value;
  };
  const above = (threshold: number) =>
    Math.round(
      (100 *
        available.reduce(
          (sum, m) => sum + m.values.filter((v) => v >= threshold).length / m.values.length,
          0,
        )) /
        available.length,
    );
  return {
    p10: quantile(0.1),
    median: quantile(0.5),
    p90: quantile(0.9),
    heavy: above(35.1),
    veryHeavy: above(90.1),
    models: available.map((m) => m.model),
    partial: available.length < 2,
  };
}

export function outlookDays(data: RainOutlook, point: OutlookPoint, now: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
  return data.days.flatMap((date, i) =>
    date > today ? [{ date, stats: dayOutlook(point, i), index: i }] : [],
  );
}
