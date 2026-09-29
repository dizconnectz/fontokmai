import { useMemo } from 'react';
import { Info, Star } from 'lucide-react';
import { formatTime, safeLink, type RainForecast } from './data';
import type { Favorite } from './favorite';
import { dayRainWords, daysAt } from './forecast';
import type { RefState } from './refSync';
import './FavoriteForecast.css';

const DAY_MS = 86_400_000;
const STALE_MS = 12 * 3_600_000;
const DATE_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const DATE_LABEL = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** The saved location stays independent of the selected pin and the map's timeline. */
export default function FavoriteForecast({
  favorite,
  forecast,
  state,
  now,
  onOpen,
}: {
  favorite: Favorite;
  forecast: RainForecast | null;
  state: RefState;
  now: number;
  onOpen: () => void;
}) {
  const days = useMemo(
    () => (forecast ? daysAt(forecast, favorite.location) : null),
    [forecast, favorite.location],
  );
  // Always show today's seven calendar dates in Thailand, including any missing tail days.
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = DATE_KEY.format(now + offset * DAY_MS);
    return { date, day: days?.find((item) => item.date === date) };
  });
  const old = forecast !== null && now - Date.parse(forecast.fetched_at) > STALE_MS;

  return (
    <section
      className="panel-section favorite-forecast"
      aria-labelledby="favorite-forecast-heading"
      data-testid="favorite-forecast"
    >
      <button className="favorite-card" onClick={onOpen}>
        <Star size={17} aria-hidden="true" />
        <span>
          <strong>ที่ของฉัน · {favorite.label}</strong>
          <small>ดูจุดนี้บนแผนที่</small>
        </span>
      </button>
      <h2 id="favorite-forecast-heading">ฝน 7 วัน</h2>
      <p className="favorite-forecast-range">วันนี้และ 6 วันถัดไป · เวลาประเทศไทย</p>
      {!forecast && (state === 'idle' || state === 'loading') && (
        <p className="quiet" role="status">
          กำลังโหลดพยากรณ์…
        </p>
      )}
      {!forecast && (state === 'missing' || state === 'error') && (
        <p className="missing-value">ยังไม่มีข้อมูลพยากรณ์ของที่นี่</p>
      )}
      {forecast && !days && <p className="missing-value">จุดนี้อยู่นอกพื้นที่พยากรณ์ที่มีข้อมูล</p>}
      {days && (
        <table aria-labelledby="favorite-forecast-heading">
          <thead>
            <tr>
              <th scope="col">วัน</th>
              <th scope="col">แนวโน้ม</th>
              <th scope="col">ฝนรวม</th>
              <th scope="col">โอกาสฝน</th>
            </tr>
          </thead>
          <tbody>
            {week.map(({ date, day }, i) => (
              <tr
                key={date}
                data-date={date}
                className={
                  day?.rainMm != null && day.rainMm >= 0.1 ? 'favorite-rain-day' : undefined
                }
              >
                <th scope="row">
                  <time
                    dateTime={date}
                    title={DATE_LABEL.format(new Date(`${date}T12:00:00+07:00`))}
                  >
                    {i === 0
                      ? 'วันนี้'
                      : i === 1
                        ? 'พรุ่งนี้'
                        : DATE_LABEL.format(new Date(`${date}T12:00:00+07:00`))}
                  </time>
                </th>
                <td>{dayRainWords(day?.rainMm ?? null)}</td>
                <td>
                  {day?.rainMm == null ? (
                    <span aria-label="ไม่มีข้อมูลปริมาณฝน">—</span>
                  ) : (
                    `${day.rainMm.toLocaleString('th-TH', { maximumFractionDigits: 1 })} มม.`
                  )}
                </td>
                <td>
                  {day?.probability == null ? (
                    <span aria-label="ไม่มีข้อมูลโอกาสฝน">—</span>
                  ) : (
                    `${day.probability}%`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(old || state === 'outdated') && (
        <p className="inline-warning" role="status">
          <Info size={15} aria-hidden="true" /> พยากรณ์ไม่อัปเดต · แสดงข้อมูลครั้งก่อน
        </p>
      )}
      {forecast && (
        <small className="source-note">
          ฝนรวมทั้งวันและโอกาสฝนสูงสุดของวัน · ค่าจากแบบจำลองบริเวณใกล้จุดที่บันทึก
          <br />
          อัปเดต {formatTime(forecast.fetched_at)} น.
          <br />
          ที่มา:{' '}
          <a href={safeLink(forecast.source_url)} target="_blank" rel="noreferrer">
            {forecast.credit_th} ↗
          </a>
        </small>
      )}
    </section>
  );
}
