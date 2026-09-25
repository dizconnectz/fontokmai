import { useEffect, useMemo, useRef } from 'react';
import {
  ArrowUpRight,
  Camera as CameraIcon,
  CheckCircle2,
  CloudRain,
  ExternalLink,
  Info,
  MapPin,
  Route,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  displayStatus,
  formatTime,
  radarAgeMinutes,
  safeLink,
  type Alert,
  type Camera,
  type RadarFeed,
  type RoadFloodHistory,
  type Snapshot,
} from './data';
import {
  LEVEL_LABEL,
  hazardTitle,
  levelOf,
  provincesOf,
  shortTime,
  summaryLine,
  whenText,
  whereText,
  worstLevel,
} from './alerts';
import { inMultiPolygon, rainWords } from './geo';
import { distanceM, roadsNear } from './roads';
import { useRadarAt } from './radarAt';
import type { RefState } from './useData';

type Road = RoadFloodHistory['roads'][number];
const RADAR_STALE_MIN = 45;
const be = (year: string | number) => Number(year) + 543;
const dayText = (date: string) => formatTime(`${date}T12:00:00+07:00`).replace(/ \d\d:\d\d$/, '');

export function LevelBadge({ alert }: { alert: Alert }) {
  const level = levelOf(alert);
  return <span className={`level-badge level-${level}`}>{LEVEL_LABEL[level]}</span>;
}

export function AlertCard({
  alert,
  now,
  selected,
  onSelect,
}: {
  alert: Alert;
  now: number;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  const pending = displayStatus(alert, now) === 'pending';
  return (
    <article
      className={`alert-card level-edge-${levelOf(alert)} ${selected ? 'is-selected' : ''}`}
      data-testid="alert-card"
    >
      <div className="card-top">
        <LevelBadge alert={alert} />
        {pending && <span className="pill pending">เริ่มมีผลภายหลัง</span>}
      </div>
      <button className="alert-select" onClick={() => onSelect(alert.event_id)}>
        <strong>{hazardTitle(alert)}</strong>
        <span>{whereText(alert)}</span>
        <span>{whenText(alert, now)}</span>
        <span className="card-cta">
          ดูพื้นที่และรายละเอียด <ArrowUpRight size={15} />
        </span>
      </button>
      {alert.expires_policy === 'default_24h' && (
        <span className="expiry-note">
          <Info size={13} /> เวลาสิ้นสุดเป็นค่าประมาณ
        </span>
      )}
      <span className="card-meta">ที่มา: {alert.credit_th}</span>
    </article>
  );
}

export function AlertDetails({
  alert,
  now,
  onClose,
}: {
  alert: Alert;
  now: number;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [alert.event_id]);
  const url = safeLink(alert.source_url);
  const provinces = provincesOf(alert);
  return (
    <section
      className="panel-section alert-detail"
      aria-label="รายละเอียดประกาศ"
      data-testid="alert-detail"
    >
      <div className="section-top">
        <span className="eyebrow">
          <ShieldAlert size={15} /> ประกาศกรมอุตุนิยมวิทยา
        </span>
        <button className="icon-button" aria-label="ปิดรายละเอียดประกาศ" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {hazardTitle(alert)}
      </h2>
      <div className="badge-row">
        <LevelBadge alert={alert} />
        <span
          className={`pill ${displayStatus(alert, now) === 'pending' ? 'pending' : 'official'}`}
        >
          {displayStatus(alert, now) === 'pending' ? 'เริ่มมีผลภายหลัง' : 'มีผลตามเวลาประกาศ'}
        </span>
      </div>
      <p className="summary-line">{summaryLine(alert, now)}</p>
      <dl className="detail-times">
        <div>
          <dt>เริ่มมีผล</dt>
          <dd>{formatTime(alert.effective)} น.</dd>
        </div>
        <div>
          <dt>สิ้นสุด</dt>
          <dd>{formatTime(alert.expires)} น.</dd>
        </div>
      </dl>
      {alert.expires_policy === 'default_24h' && (
        <p className="inline-warning">
          <Info size={16} />
          เวลาสิ้นสุดเป็นค่าประมาณ เนื่องจากเวลาต้นฉบับไม่ครบหรือไม่สอดคล้องกัน
        </p>
      )}
      <details>
        <summary>พื้นที่ตามประกาศ ({provinces.length || 'ไม่ระบุ'} จังหวัด)</summary>
        <p>{alert.area_desc_th ?? 'ต้นฉบับไม่ได้ระบุชื่อพื้นที่'}</p>
      </details>
      {!alert.geometry && (
        <p className="inline-warning">ประกาศนี้ไม่มีขอบเขตพิกัด จึงแสดงเฉพาะรายการ</p>
      )}
      {alert.body_th && (
        <details>
          <summary>อ่านเนื้อหาประกาศ</summary>
          <p className="preserve-lines">{alert.body_th}</p>
        </details>
      )}
      {alert.instruction_th && (
        <details>
          <summary>คำแนะนำจากกรมอุตุนิยมวิทยา</summary>
          <p className="preserve-lines">{alert.instruction_th}</p>
        </details>
      )}
      <div className="detail-source">
        <span>
          ที่มา: {alert.credit_th} · ออกประกาศ {formatTime(alert.sent)} น.
        </span>
        {url && (
          <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">
            อ่านต้นฉบับ <ExternalLink size={14} />
          </a>
        )}
      </div>
    </section>
  );
}

function RadarNow({ radar, now }: { radar: RadarFeed | null | undefined; now: number }) {
  const age = radarAgeMinutes(radar, now);
  const latest = radar?.frames.at(-1);
  return (
    <section className="panel-section" aria-labelledby="rain-now-heading">
      <h2 id="rain-now-heading">
        <CloudRain size={18} /> ฝนตอนนี้
      </h2>
      {!latest ? (
        <p className="missing-value">ยังไม่มีข้อมูลเรดาร์</p>
      ) : (
        <>
          <p>ภาพเรดาร์ล่าสุด {shortTime(latest.time, now)} · ดูสีฝนบนแผนที่ (สีฟ้าเบา → แดงหนัก)</p>
          {age !== null && age > RADAR_STALE_MIN && (
            <p className="inline-warning">
              <Info size={15} /> ภาพเรดาร์ไม่อัปเดต {age} นาที
            </p>
          )}
          <small className="source-note">เรดาร์: {radar!.credit_th}</small>
        </>
      )}
    </section>
  );
}

export function Overview({
  snapshot,
  alerts,
  now,
  loading,
  onSelectAlert,
}: {
  snapshot: Snapshot | null;
  alerts: Alert[];
  now: number;
  loading: boolean;
  onSelectAlert: (id: string) => void;
}) {
  const worst = worstLevel(alerts);
  return (
    <>
      <section className="panel-section" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className={worst ? `heading-level-${worst}` : 'heading-ok'}>
          {worst ? <ShieldAlert size={19} /> : <ShieldCheck size={19} />}
          {!snapshot?.feed
            ? 'ประกาศเตือนภัย'
            : alerts.length
              ? `ประกาศเตือนภัยที่มีผล ${alerts.length} ฉบับ`
              : 'ไม่มีประกาศเตือนภัยที่มีผลตอนนี้'}
        </h2>
        <div className="alert-list" aria-live="polite" aria-busy={loading && !snapshot}>
          {!snapshot && loading && <p className="missing-value">กำลังโหลดประกาศ…</p>}
          {!(loading && !snapshot) && alerts.length === 0 && (
            <div className="empty-list">
              <strong>
                {!snapshot?.feed ? 'ยังไม่มีข้อมูลประกาศ' : 'ไม่พบประกาศที่มีผลในชุดนี้'}
              </strong>
              <p>ไม่มีข้อมูลหรือไม่พบประกาศ ไม่ได้แปลว่าพื้นที่ปลอดภัย</p>
            </div>
          )}
          {alerts.map((alert) => (
            <AlertCard key={alert.event_id} alert={alert} now={now} onSelect={onSelectAlert} />
          ))}
        </div>
      </section>
      <RadarNow radar={snapshot?.radar} now={now} />
      <section className="panel-section pin-hint">
        <MapPin size={20} />
        <p>
          <strong>แตะที่ใดก็ได้บนแผนที่เพื่อปักหมุด</strong>
          ดูประกาศ ฝน น้ำท่วมแถวนั้น และกล้องใกล้ๆ ของจุดนั้น
        </p>
      </section>
    </>
  );
}

function RoadLine({ road, distance }: { road: Road; distance?: number }) {
  return (
    <li className="road-line">
      <strong>{road.kind === 'road' ? `ถ.${road.name_th}` : road.name_th}</strong>
      <span>
        เคยมีรายงานน้ำท่วม {road.flood_days} วัน ({be(road.first_date.slice(0, 4))}–
        {be(road.last_date.slice(0, 4))}) · ล่าสุด {dayText(road.last_date)}
        {distance !== undefined &&
          ` · ห่าง ${distance < 1000 ? `${Math.round(distance / 10) * 10} ม.` : `${(distance / 1000).toFixed(1)} กม.`}`}
      </span>
    </li>
  );
}

export function PinCard({
  pin,
  snapshot,
  alerts,
  now,
  dataBase,
  radarFrame,
  roads,
  roadsState,
  cameras,
  onClose,
  onSelectAlert,
  onRoad,
}: {
  pin: number[];
  snapshot: Snapshot | null;
  alerts: Alert[];
  now: number;
  dataBase: string | null;
  radarFrame: number;
  roads: RoadFloodHistory | null;
  roadsState: RefState;
  cameras: Camera[];
  onClose: () => void;
  onSelectAlert: (id: string) => void;
  onRoad: (road: Road) => void;
}) {
  const here = useMemo(
    () => alerts.filter((a) => a.geometry && inMultiPolygon(pin, a.geometry.coordinates)),
    [alerts, pin],
  );
  const reading = useRadarAt(snapshot?.radar, dataBase, pin, radarFrame);
  const radarAge = radarAgeMinutes(snapshot?.radar, now);
  const inRoadArea =
    !roads ||
    (pin[0] >= roads.bbox[0] &&
      pin[0] <= roads.bbox[2] &&
      pin[1] >= roads.bbox[1] &&
      pin[1] <= roads.bbox[3]);
  const near = useMemo(() => (roads ? roadsNear(roads, pin).slice(0, 5) : []), [roads, pin]);
  const nearCameras = useMemo(
    () =>
      cameras
        .filter((c) => c.location)
        .map((c) => ({ camera: c, distance: distanceM(pin, c.location!) }))
        .filter((c) => c.distance <= 10_000)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3),
    [cameras, pin],
  );
  const worst = worstLevel(here);
  return (
    <div className="pin-card" data-testid="pin-card">
      <div className="section-top pin-head">
        <span className="eyebrow">
          <MapPin size={15} /> จุดที่ปักหมุด · {pin[1].toFixed(4)}, {pin[0].toFixed(4)}
        </span>
        <button className="icon-button" aria-label="ปิดหมุด" onClick={onClose}>
          <X size={19} />
        </button>
      </div>

      <section className="panel-section" aria-labelledby="pin-now">
        <h2 id="pin-now" className={worst ? `heading-level-${worst}` : 'heading-ok'}>
          {worst ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}
          {here.length
            ? `มีประกาศครอบคลุมจุดนี้ ${here.length} ฉบับ`
            : 'ไม่มีประกาศเตือนภัยครอบคลุมจุดนี้'}
        </h2>
        {here.map((alert) => (
          <AlertCard key={alert.event_id} alert={alert} now={now} onSelect={onSelectAlert} />
        ))}
        {!here.length && snapshot?.feed && (
          <p className="quiet">ตามประกาศกรมอุตุนิยมวิทยาที่มีผลตอนนี้</p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="pin-rain">
        <h2 id="pin-rain">
          <CloudRain size={18} /> ฝนตอนนี้ตรงจุดนี้
        </h2>
        {reading.state === 'none' && <p className="missing-value">ยังไม่มีข้อมูลเรดาร์</p>}
        {reading.state === 'loading' && <p className="quiet">กำลังอ่านภาพเรดาร์…</p>}
        {reading.state === 'error' && <p className="missing-value">อ่านภาพเรดาร์ไม่สำเร็จ</p>}
        {reading.state === 'outside' && <p className="missing-value">จุดนี้อยู่นอกภาพเรดาร์</p>}
        {reading.state === 'ready' && (
          <p className={reading.item ? 'rain-value' : 'ok-value'}>
            {reading.item
              ? `${rainWords(reading.item.min_mm_per_hr)} ประมาณ ${reading.item.label} มม./ชม.`
              : 'ไม่พบฝนจากเรดาร์'}
          </p>
        )}
        {reading.time && (
          <small className="source-note">
            ภาพเรดาร์ {shortTime(reading.time, now)} · กรมอุตุนิยมวิทยา · เป็นค่าประมาณจากเรดาร์
            ไม่ใช่ฝนที่วัดได้
          </small>
        )}
        {radarAge !== null && radarAge > RADAR_STALE_MIN && (
          <p className="inline-warning">
            <Info size={15} /> ภาพเรดาร์ไม่อัปเดต {radarAge} นาที
          </p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="pin-forecast">
        <h2 id="pin-forecast">ฝน 7 วัน</h2>
        <p className="missing-value">ยังไม่มีข้อมูล · กำลังเพิ่มพยากรณ์</p>
      </section>

      <section className="panel-section" aria-labelledby="pin-flood">
        <h2 id="pin-flood">
          <Route size={18} /> น้ำท่วมแถวนี้ (รัศมี 2 กม.)
        </h2>
        {(roadsState === 'loading' || roadsState === 'idle') && (
          <p className="quiet">กำลังโหลดประวัติน้ำท่วมถนน…</p>
        )}
        {(roadsState === 'missing' || roadsState === 'error') && (
          <p className="missing-value">ยังไม่มีข้อมูลประวัติน้ำท่วมถนน</p>
        )}
        {roads && !inRoadArea && (
          <p className="missing-value">ตอนนี้มีประวัติน้ำท่วมถนนเฉพาะ กทม. และปริมณฑล</p>
        )}
        {roads && inRoadArea && near.length === 0 && (
          <p className="quiet">ไม่พบรายงานน้ำท่วมถนนใกล้จุดนี้ · ไม่ได้แปลว่าไม่เคยท่วม</p>
        )}
        {near.length > 0 && (
          <ul className="road-list">
            {near.map(({ road, distance }) => (
              <li key={road.key}>
                <button className="road-button" onClick={() => onRoad(road)}>
                  <RoadLine road={road} distance={distance} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {roads && (
          <small className="source-note">
            ที่มา: {roads.sources.map((s) => s.credit_th).join(' · ')}
          </small>
        )}
      </section>

      <section className="panel-section" aria-labelledby="pin-cameras">
        <h2 id="pin-cameras">
          <CameraIcon size={18} /> กล้องใกล้ๆ (10 กม.)
        </h2>
        {nearCameras.length === 0 ? (
          <p className="quiet">ยังไม่มีกล้องในทะเบียนของเราใกล้จุดนี้</p>
        ) : (
          <ul className="camera-list">
            {nearCameras.map(({ camera, distance }) => (
              <li key={camera.id}>
                <a href={camera.page_url} target="_blank" rel="noopener noreferrer">
                  {camera.name_th} <ExternalLink size={13} />
                </a>
                <span>
                  {camera.owner_th} · ห่าง {(distance / 1000).toFixed(1)} กม.
                  {camera.position === 'approximate' ? ' · ตำแหน่งโดยประมาณ' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function RoadCard({
  road,
  history,
  onClose,
}: {
  road: Road;
  history: RoadFloodHistory;
  onClose: () => void;
}) {
  const years = Object.entries(road.days_by_year);
  const peak = Math.max(...years.map(([, days]) => days), 1);
  return (
    <section
      className="panel-section road-card"
      aria-label="ประวัติน้ำท่วมถนน"
      data-testid="road-card"
    >
      <div className="section-top">
        <span className="eyebrow">
          <Route size={15} /> ประวัติน้ำท่วมถนน
        </span>
        <button className="icon-button" aria-label="ปิดประวัติถนน" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h2>{road.kind === 'road' ? `ถ.${road.name_th}` : road.name_th}</h2>
      <p className="summary-line">
        เคยมีรายงานน้ำท่วม {road.flood_days} วัน ({road.reports} รายงาน) ตั้งแต่{' '}
        {be(road.first_date.slice(0, 4))} · ล่าสุด {dayText(road.last_date)}
        {road.max_depth_cm !== null && ` · ลึกสุด ${road.max_depth_cm} ซม.`}
      </p>
      {road.districts.length > 0 && <p className="quiet">เขต: {road.districts.join(', ')}</p>}
      <div className="year-bars" aria-label="จำนวนวันที่มีรายงานในแต่ละปี">
        {years.map(([year, days]) => (
          <div key={year} className="year-bar">
            <span style={{ height: `${Math.max(6, (days / peak) * 100)}%` }} />
            <small>{be(year)}</small>
            <b>{days}</b>
          </div>
        ))}
      </div>
      <details open>
        <summary>รายงานล่าสุด</summary>
        <ul className="report-list">
          {road.recent.map((report, index) => (
            <li key={`${report.date}-${index}`}>
              <strong>{formatTime(report.start ?? `${report.date}T00:00:00+07:00`)}</strong>
              <span>
                {[
                  report.spot,
                  report.depth_cm !== null ? `${report.depth_cm} ซม.` : null,
                  report.lanes,
                  report.rain_mm !== null ? `ฝน ${report.rain_mm} มม.` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {report.url && (
                <a href={report.url} target="_blank" rel="noopener noreferrer">
                  ดูรายงานต้นทาง <ExternalLink size={12} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
      <ul className="note-list">
        {history.notes_th.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <small className="source-note">
        {history.sources.map((s) => (
          <a key={s.source_id} href={s.url} target="_blank" rel="noopener noreferrer">
            {s.credit_th}
          </a>
        ))}
      </small>
    </section>
  );
}
