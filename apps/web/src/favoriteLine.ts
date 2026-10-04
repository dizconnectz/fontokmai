import type { Alert, LiveFloods, PlaceGazetteer, RainForecast } from './data';
import { displayStatus } from './data';
import { LEVEL_LABEL, provincesOf, worstLevel, type FeedTrust } from './alerts';
import { floodsNear, isOngoing } from './floods';
import { dayRainWords, daysAt } from './forecast';
import { inMultiPolygon } from './geo';
import { placeParts, type WatchArea } from './overview';
import { nearestSubdistrict } from './places';
import { satelliteNear, satelliteOld, type SatelliteFloods } from './satellite';

export type LineTone = 'danger' | 'warn' | 'ok' | 'muted';
export interface LinePart {
  text: string;
  tone: LineTone;
}
const DATE_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
// a forecast refreshed every 6 hours is not read as today's after two refreshes failed (FavoriteForecast)
const FORECAST_STALE_MS = 12 * 3_600_000;

/**
 * The saved place in one line at the top of the side panel (user 2026-10-01): an official alert over it, its
 * district or province on the summary's lists, flood reports near it, flood water GISTDA saw from satellites in its
 * district or near it (user 2026-10-04) and today's rain. What was not found is said
 * as such, never as "safe"; a part whose data is missing is left out.
 */
export function favoriteLine({
  point,
  alerts,
  trust,
  places,
  areas,
  floods,
  forecast,
  satellite = null,
  now,
}: {
  point: number[];
  /** the alerts shown now */
  alerts: Alert[];
  trust: FeedTrust;
  /** DOPA places, to name the district and province of the point as the summary does */
  places: PlaceGazetteer | null;
  /** the summary's places at `now` (overview.watchAreas) */
  areas: WatchArea[];
  floods: LiveFloods | null;
  forecast: RainForecast | null;
  /** GISTDA's flooded area by district (floods/satellite.json); an old file says nothing */
  satellite?: SatelliteFloods | null;
  now: number;
}): LinePart[] {
  const parts: LinePart[] = [];
  const sub = places ? nearestSubdistrict(places, point) : null;
  const district = sub?.place.code.slice(0, 4) ?? null;
  const provinceCode = sub?.place.code.slice(0, 2) ?? null;
  const province = provinceCode
    ? (places?.places.find((place) => place.code === provinceCode)?.name ?? null)
    : null;

  // an alert over the point, or one that names its province (as the pin card matches them)
  const here = alerts.filter(
    (alert) =>
      (alert.geometry && inMultiPolygon(point, alert.geometry.coordinates)) ||
      (province !== null && provincesOf(alert).includes(province)),
  );
  const worst = worstLevel(here);
  if (worst) {
    const active = here.some((alert) => displayStatus(alert, now) === 'active');
    parts.push({
      text: `${active ? 'มีประกาศ' : 'ประกาศล่วงหน้า'}${LEVEL_LABEL[worst]}`,
      tone: worst === 'extreme' || worst === 'severe' ? 'danger' : 'warn',
    });
  } else if (trust === 'ok' && !alerts.some((alert) => !alert.geometry && !here.includes(alert)))
    parts.push({ text: 'ไม่มีประกาศ', tone: 'ok' });
  else parts.push({ text: 'ตรวจประกาศไม่ครบ', tone: 'muted' });

  // the summary's lists name districts (now) and provinces (next) by the same DOPA codes
  const watched = areas.find((area) => area.when === 'now' && area.code === district);
  const prepare = areas.find((area) => area.when === 'next' && area.code === provinceCode);
  if (watched)
    parts.push({ text: `${placeParts(watched.place)[0]} ต้องระวังตอนนี้`, tone: 'danger' });
  else if (prepare) parts.push({ text: `${prepare.place} เตรียมรับมือ`, tone: 'warn' });

  if (floods) {
    const near = floodsNear(floods, point, now).filter((hit) => isOngoing(hit.report, now));
    if (near.length) parts.push({ text: `น้ำท่วมใกล้ๆ ${near.length} จุด`, tone: 'danger' });
  }

  // an agency's map of water (GISTDA), not a forecast: in the district of the point, or near it
  if (satellite && places && !satelliteOld(satellite, now)) {
    const seen = satelliteNear(satellite, places, point, district);
    if (seen.here) parts.push({ text: 'ดาวเทียมเห็นน้ำท่วมในอำเภอนี้', tone: 'danger' });
    else if (seen.near.length)
      parts.push({
        text: `ดาวเทียมเห็นน้ำท่วมใกล้ๆ (${seen.near[0].district.name_th.split(' ')[0]})`,
        tone: 'warn',
      });
  }

  if (forecast && now - Date.parse(forecast.fetched_at) <= FORECAST_STALE_MS) {
    const today = daysAt(forecast, point)?.find((day) => day.date === DATE_KEY.format(now));
    if (today?.rainMm != null) {
      const amount =
        today.rainMm >= 0.1
          ? ` ราว ${today.rainMm.toLocaleString('th-TH', { maximumFractionDigits: 1 })} มม.`
          : '';
      parts.push({
        text: `วันนี้${dayRainWords(today.rainMm)}${amount}`,
        tone: today.rainMm > 35 ? 'warn' : 'muted',
      });
    }
  }
  return parts;
}
