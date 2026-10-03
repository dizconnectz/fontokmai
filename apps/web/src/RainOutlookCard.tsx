import { useMemo, useState } from 'react';
import { formatTime, safeLink } from './data';
import { MODEL_NAMES, OUTLOOK_STALE, outlookDays, type RainOutlook } from './outlook';
import type { RefState } from './useData';
import './Outlook.css';

const dayLabel = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
});
export default function Outlook({
  data,
  state,
  now,
  onPoint,
}: {
  data: RainOutlook | null;
  state: RefState;
  now: number;
  onPoint: (location: [number, number]) => void;
}) {
  const [chosen, setChosen] = useState('hii-atg101');
  const [week, setWeek] = useState(1);
  const point = data?.points.find((p) => p.point.id === chosen) ?? data?.points[0];
  const rows = useMemo(
    () => (data && point ? outlookDays(data, point, now) : []),
    [data, point, now],
  );
  const groups = [...new Set(data?.points.map((p) => p.point.area_id) ?? [])];
  const stale =
    !!data &&
    (now - Date.parse(data.fetched_at) > OUTLOOK_STALE || now < Date.parse(data.fetched_at));
  return (
    <section className="outlook-card" aria-label="แนวโน้มฝน 14 วัน" data-testid="rain-outlook">
      <details>
        <summary>
          แนวโน้มฝน 14 วัน <span className="outlook-tag">ทดลอง</span>
        </summary>
        {!data || !point ? (
          <p role="status">
            {state === 'loading'
              ? 'กำลังโหลดแนวโน้มฝน…'
              : state === 'error'
                ? 'โหลดแนวโน้มฝนไม่สำเร็จ จึงยังประเมินไม่ได้'
                : 'ยังไม่มีข้อมูลแนวโน้มฝน 14 วัน'}
          </p>
        ) : (
          <>
            <label className="outlook-place">
              จุดตัวอย่าง
              <select value={point.point.id} onChange={(e) => setChosen(e.target.value)}>
                {groups.map((group) => (
                  <optgroup
                    key={group}
                    label={data.points.find((p) => p.point.area_id === group)!.point.area_th}
                  >
                    {data.points
                      .filter((p) => p.point.area_id === group)
                      .map((p) => (
                        <option key={p.point.id} value={p.point.id}>
                          {p.point.name_th}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="outlook-weeks" aria-label="ช่วงพยากรณ์">
              {[0, 1].map((w) => (
                <button key={w} aria-pressed={week === w} onClick={() => setWeek(w)}>
                  {w ? 'วันที่ 8–14' : 'วันที่ 1–7'}
                </button>
              ))}
            </div>
            {(stale || state === 'error' || state === 'outdated') && (
              <p className="outlook-warning" role="status">
                {stale
                  ? 'ข้อมูลเก่า · แนวโน้มอาจเปลี่ยนแล้ว'
                  : 'อัปเดตไม่สำเร็จ · แสดงชุดที่เก็บไว้'}
              </p>
            )}
            <p className="outlook-note">
              ฝนของพื้นที่แบบจำลองราว 25–50 กม. ไม่ใช่ฝนตรงบ้าน
              {week === 1 && ' · วันที่ฝนหนักอาจเปลี่ยนได้'}
            </p>
            <table>
              <caption>ช่วงฝนจาก 80% ตรงกลางของสถานการณ์ · มม./วัน</caption>
              <thead>
                <tr>
                  <th scope="col">วัน</th>
                  <th scope="col">ช่วงฝน</th>
                  <th scope="col">สัดส่วนที่ให้ฝนหนัก</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.index >= week * 7 && r.index < week * 7 + 7)
                  .map(({ date, stats }) => (
                    <tr
                      key={date}
                      className={stats && !stale && stats.heavy >= 40 ? 'outlook-watch' : ''}
                    >
                      <th scope="row">{dayLabel.format(new Date(`${date}T12:00:00+07:00`))}</th>
                      <td>
                        {stats ? `${stats.p10.toFixed(0)}–${stats.p90.toFixed(0)}` : 'ข้อมูลไม่พอ'}
                      </td>
                      <td>
                        {stats ? `${stats.heavy}%${stats.partial ? ' *' : ''}` : 'ประเมินไม่ได้'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!rows.some((r) => r.index >= week * 7 && r.index < week * 7 + 7) && (
              <p>ชุดนี้ไม่มีวันในช่วงที่เลือกแล้ว</p>
            )}
            <p className="outlook-note">
              ฝนหนัก: ตั้งแต่ 35.1 มม./วัน · สัดส่วนสถานการณ์ยังไม่สอบเทียบ ไม่ใช่โอกาสน้ำท่วม
            </p>
            <p className="outlook-note">
              ให้น้ำหนักแต่ละโมเดลเท่ากัน · * ข้อมูลครบพอเพียงโมเดลเดียว
            </p>
            <p className="outlook-note">
              {point.models.map((m) => MODEL_NAMES[m.model]).join(' + ') || 'ไม่มีโมเดลที่ใช้ได้'} ·
              ดึงเมื่อ {formatTime(data.fetched_at)}
            </p>
            <button className="outlook-map" onClick={() => onPoint(point.point.location)}>
              ดูจุดนี้บนแผนที่
            </button>
            <details className="outlook-method">
              <summary>ข้อมูลสำหรับคำนวณน้ำ</summary>
              <p>
                จุดนี้ยังไม่มีระดับตลิ่งและความสามารถระบายที่ตรวจสอบแล้ว
                จึงยังคำนวณน้ำล้นตลิ่งไม่ได้
              </p>
              <p>
                น้ำปล่อยจากเขื่อนต้องคำนวณความหน่วงและน้ำผันก่อนรวมกับน้ำฝน
                ไม่บวกซ้ำกับน้ำที่โมเดลแม่น้ำรวมไว้แล้ว
              </p>
              <a href={safeLink(point.point.source_url)} target="_blank" rel="noopener noreferrer">
                พิกัด: {point.point.credit_th} ↗
              </a>
            </details>
            <a
              href={safeLink(data.source_url ?? 'https://open-meteo.com/en/docs/ensemble-api')}
              target="_blank"
              rel="noopener noreferrer"
            >
              ที่มา: Open-Meteo · ECMWF · NOAA (CC BY 4.0) ↗
            </a>
          </>
        )}
      </details>
    </section>
  );
}
