import { useEffect, useMemo, useRef } from 'react';
import {
  ArrowUpRight,
  Camera as CameraIcon,
  CheckCircle2,
  CircleHelp,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  ExternalLink,
  Droplet,
  Info,
  MapPin,
  Phone,
  Star,
  Route,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Waves,
  X,
} from 'lucide-react';
import {
  displayStatus,
  formatTime,
  radarAgeMinutes,
  safeLink,
  staleAfter,
  type Alert,
  type Camera,
  type RadarFeed,
  type LiveFloods,
  type RainForecast,
  type RoadFloodHistory,
  type Snapshot,
} from './data';
import {
  LEVEL_LABEL,
  feedTrust,
  hazardTitle,
  hourRange,
  levelOf,
  provincesOf,
  regionsOf,
  shortTime,
  summaryLine,
  whenText,
  whereText,
  worstLevel,
} from './alerts';
import { inMultiPolygon, rainWords } from './geo';
import type { FoundPlace, Place } from './places';
import { dayRainWords, daysAt, forecastAt } from './forecast';
import {
  agoText,
  floodsNear,
  FLOOD_RADIUS_M,
  FLOODS_STALE_MS,
  isOngoing,
  latestFloods,
  REPORTER_TH,
  type FloodReport,
} from './floods';
import type { TimeStep } from './Timeline';
import { distanceM, roadsNear } from './roads';
import {
  BKK_STALE_MS,
  floodingText,
  isRecent,
  isTodaysReport,
  levelText,
  mmText,
  nearest,
  RAIN_RADIUS_M,
  reportsOnRoads,
  reportTime,
  roadLabel,
  WATER_RADIUS_M,
  type CanalLevels,
  type RainGauges,
  type RoadFloodingDaily,
  type RoadFloodingReport,
} from './bkk';
import { useRadarAt } from './radarAt';
import type { RefState } from './useData';

type Road = RoadFloodHistory['roads'][number];
const RADAR_STALE_MIN = 45;
const be = (year: string | number) => Number(year) + 543;
const dayText = (date: string) => formatTime(`${date}T12:00:00+07:00`).replace(/ \d\d:\d\d$/, '');
const FORECAST_STALE_MS = 12 * 3_600_000;
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const WEEKDAY = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  weekday: 'short',
  day: 'numeric',
});
function dayName(date: string, now: number): string {
  if (date === DAY.format(now)) return 'วันนี้';
  if (date === DAY.format(now + 86_400_000)) return 'พรุ่งนี้';
  return WEEKDAY.format(new Date(`${date}T12:00:00+07:00`));
}
/** Icon and words of a WMO weather code (Open-Meteo daily weather_code). */
function WeatherIcon({ code }: { code: number | null }) {
  const [Icon, words] =
    code === null
      ? [Cloud, 'ไม่มีข้อมูล']
      : code <= 1
        ? [Sun, 'แจ่มใส']
        : code === 2
          ? [CloudSun, 'มีเมฆบางส่วน']
          : code === 3
            ? [Cloud, 'เมฆมาก']
            : code <= 48
              ? [CloudFog, 'หมอก']
              : code <= 57
                ? [CloudDrizzle, 'ฝนละออง']
                : code <= 82
                  ? [CloudRain, 'ฝน']
                  : [CloudLightning, 'ฝนฟ้าคะนอง'];
  return (
    <span className="weather-icon" role="img" aria-label={words} title={words}>
      <Icon size={18} />
    </span>
  );
}
const CAMERA_RADIUS_M = 25_000;
const distanceText = (metres: number) =>
  metres < 1000 ? `${Math.round(metres / 10) * 10} ม.` : `${(metres / 1000).toFixed(1)} กม.`;

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
        <summary>
          พื้นที่ตามประกาศ ({provinces.length || 'ไม่ระบุ'} จังหวัด
          {regionsOf(alert).length ? ` และ${regionsOf(alert).join(' ')}` : ''})
        </summary>
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

// Public hotlines of the agencies (as of September 2026); tel: links call them on a phone.
const HOTLINES = [
  { number: '1784', name: 'ปภ. ขอความช่วยเหลือและอพยพ', note: 'LINE @1784DDPM' },
  { number: '1669', name: 'เจ็บป่วยฉุกเฉิน (สพฉ.)' },
  { number: '1586', name: 'กรมทางหลวง · สอบถามเส้นทาง' },
  { number: '1146', name: 'กรมทางหลวงชนบท · สอบถามเส้นทาง' },
  { number: '1129', name: 'ไฟฟ้าส่วนภูมิภาค (กฟภ.)' },
  { number: '1130', name: 'ไฟฟ้านครหลวง (กฟน.) กทม. นนทบุรี สมุทรปราการ' },
];
export function Hotlines() {
  return (
    <section className="panel-section hotlines" aria-labelledby="hotlines-heading">
      <h2 id="hotlines-heading">
        <Phone size={18} /> สายด่วนเมื่อน้ำท่วม
      </h2>
      <ul>
        {HOTLINES.map((line) => (
          <li key={line.number}>
            <a href={`tel:${line.number}`} aria-label={`โทร ${line.number} ${line.name}`}>
              <strong>{line.number}</strong>
              <span>
                {line.name}
                {line.note && <small> · {line.note}</small>}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <small className="source-note">เบอร์ที่หน่วยงานประกาศ ณ กันยายน 2569 · แตะเพื่อโทร</small>
    </section>
  );
}

function FloodLine({
  report,
  now,
  distance,
}: {
  report: FloodReport;
  now: number;
  distance?: number;
}) {
  const ongoing = isOngoing(report, now);
  return (
    <span className={`flood-line ${ongoing ? '' : 'ended'}`}>
      <strong>{report.road_th ?? report.title_th.replace(/^น้ำท่วม\s*/, '')}</strong>
      <small>
        {agoText(report.start, now)} · {REPORTER_TH[report.reporter]}
        {distance !== undefined && ` · ห่าง ${distanceText(distance)}`}
        {!ongoing && ' · ครบเวลารายงานแล้ว อาจลดลง'}
      </small>
    </span>
  );
}

function RoadFloodingLine({
  report,
  now,
  old = false,
}: {
  report: RoadFloodingReport;
  now: number;
  /** the report was fetched a while ago: "still flooded" only held at that time */
  old?: boolean;
}) {
  const start = report.flood_start ? reportTime(report.flood_start, now) : null;
  const still = old ? 'ยังท่วมตอนรายงาน' : 'ยังท่วม';
  return (
    <span className={`flood-line ${report.dry_at ? 'ended' : ''}`}>
      <strong>
        {roadLabel(report.road_th)}
        {report.area_th ? ` · ${report.area_th}` : ''}
      </strong>
      <small>
        {[
          report.district_th ? `เขต${report.district_th.replace(/^เขต/, '')}` : null,
          floodingText(report),
          report.dry_at
            ? `ท่วม ${start ?? ''} แห้งแล้ว ${reportTime(report.dry_at, now)}`
            : start
              ? `${still} ตั้งแต่ ${start}`
              : still,
        ]
          .filter(Boolean)
          .join(' · ')}
      </small>
    </span>
  );
}

const ROAD_LIST_LIMIT = 12;
function RoadFloodingToday({
  flooding,
  now,
  onRoad,
}: {
  flooding: RoadFloodingDaily;
  now: number;
  /** show a reported road on the map; the side panel stays */
  onRoad: (name: string) => void;
}) {
  const wet = flooding.reports.filter((report) => report.dry_at === null);
  const dry = flooding.reports.filter((report) => report.dry_at !== null);
  const old = now - Date.parse(flooding.fetched_at) > BKK_STALE_MS;
  const item = (report: RoadFloodingReport, index: number) => (
    <li key={`${index}:${report.road_th}:${report.area_th ?? ''}`}>
      <button className="road-button" onClick={() => onRoad(report.road_th)}>
        <RoadFloodingLine report={report} now={now} old={old} />
      </button>
    </li>
  );
  // another day's report is not the situation now
  if (!isTodaysReport(flooding, now)) return null;
  return (
    <section
      className="panel-section"
      aria-labelledby="road-flooding-heading"
      data-testid="road-flooding"
    >
      <h2 id="road-flooding-heading" className={wet.length ? 'heading-rain' : undefined}>
        <Route size={18} />{' '}
        {old
          ? `รายงานถนนท่วม กทม. เมื่อ ${reportTime(flooding.fetched_at, now)}`
          : wet.length
            ? `ถนนสายหลัก กทม. ที่ยังท่วม ${wet.length} จุด`
            : 'น้ำท่วมขังถนนสายหลัก กทม. วันนี้'}
      </h2>
      {flooding.reports.length === 0 && (
        <p className="quiet">วันนี้ยังไม่มีรายงานน้ำท่วมขังบนถนนสายหลัก · ถนนอื่นยังท่วมได้</p>
      )}
      {wet.length > 0 && <ul className="flood-list">{wet.slice(0, ROAD_LIST_LIMIT).map(item)}</ul>}
      {wet.length > ROAD_LIST_LIMIT && (
        <details className="history-details">
          <summary>ดูอีก {wet.length - ROAD_LIST_LIMIT} จุดที่ยังท่วม</summary>
          <ul className="flood-list">{wet.slice(ROAD_LIST_LIMIT).map(item)}</ul>
        </details>
      )}
      {dry.length > 0 && (
        <details className="history-details">
          <summary>แห้งแล้ววันนี้ {dry.length} จุด</summary>
          <ul className="flood-list">{dry.map(item)}</ul>
        </details>
      )}
      {old && (
        <p className="inline-warning">
          <Info size={15} /> ข้อมูลนี้ดึงเมื่อ {reportTime(flooding.fetched_at, now)}{' '}
          ไม่ได้อัปเดตอัตโนมัติ ถนนที่ขึ้นว่ายังท่วมอาจแห้งแล้ว หรือมีจุดท่วมเพิ่ม
        </p>
      )}
      <small className="source-note">
        รายงานของเจ้าหน้าที่{flooding.credit_th.replace(/ \(ผ่านระบบ DXS\)$/, '')}
        {flooding.updated_at ? ` · อัปเดต ${reportTime(flooding.updated_at, now)}` : ''} ·
        เฉพาะถนนสายหลักที่ติดตาม ถนนที่ไม่มีในรายการไม่ได้แปลว่าไม่ท่วม ·
        แตะรายการเพื่อดูถนนบนแผนที่ ·{' '}
        <a href={flooding.source_url} target="_blank" rel="noopener noreferrer">
          รายงานต้นทาง ↗
        </a>
      </small>
    </section>
  );
}

function FloodsNow({
  floods,
  floodsState,
  now,
  openId,
  onFlood,
}: {
  floods: LiveFloods | null;
  floodsState: RefState;
  now: number;
  /** report whose popup is open on the map */
  openId: string | null;
  onFlood: (report: FloodReport) => void;
}) {
  const latest = floods ? latestFloods(floods, now) : [];
  const ongoing = floods ? floods.reports.filter((r) => isOngoing(r, now)).length : 0;
  const old = floods ? now - Date.parse(floods.fetched_at) > FLOODS_STALE_MS : false;
  return (
    <section className="panel-section" aria-labelledby="floods-now-heading">
      <h2 id="floods-now-heading" className={ongoing ? 'heading-rain' : undefined}>
        <Waves size={18} /> {ongoing ? `รายงานน้ำท่วมตอนนี้ ${ongoing} จุด` : 'รายงานน้ำท่วมตอนนี้'}
      </h2>
      {(floodsState === 'idle' || floodsState === 'loading') && (
        <p className="quiet">กำลังโหลดรายงานน้ำท่วม…</p>
      )}
      {(floodsState === 'missing' || floodsState === 'error') && (
        <p className="missing-value">ยังไม่มีข้อมูลรายงานน้ำท่วมสด</p>
      )}
      {floods && ongoing === 0 && (
        <p className="quiet">ยังไม่มีรายงานที่ยังไม่หมดเวลา · ไม่ได้แปลว่าไม่มีน้ำท่วม</p>
      )}
      {latest.length > 0 && (
        <ul className="flood-list">
          {latest.map((report) => (
            <li key={report.id}>
              <button
                id={`flood-${report.id}`}
                className="road-button"
                aria-current={report.id === openId ? 'true' : undefined}
                onClick={() => onFlood(report)}
              >
                <FloodLine report={report} now={now} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {old && (
        <p className="inline-warning">
          <Info size={15} /> รายงานน้ำท่วมไม่อัปเดตตั้งแต่ {formatTime(floods!.fetched_at)} น.
        </p>
      )}
      {floods && (
        <small className="source-note">
          รายงานจากผู้ใช้ เจ้าหน้าที่ iTIC และกรมทางหลวง ไม่ใช่การตรวจวัด · {floods.credit_th} ·
          แตะรายการเพื่อดูบนแผนที่ หรือแตะหมุดสีน้ำเงินบนแผนที่
        </small>
      )}
    </section>
  );
}

export function Overview({
  snapshot,
  alerts,
  now,
  loading,
  floods,
  floodsState,
  favoriteLabel,
  openFloodId,
  flooding,
  onRoadName,
  onSelectAlert,
  onFlood,
  onFavorite,
}: {
  snapshot: Snapshot | null;
  alerts: Alert[];
  now: number;
  loading: boolean;
  floods: LiveFloods | null;
  floodsState: RefState;
  favoriteLabel: string | null;
  openFloodId: string | null;
  flooding: RoadFloodingDaily | null;
  onRoadName: (name: string) => void;
  onSelectAlert: (id: string) => void;
  onFlood: (report: FloodReport) => void;
  onFavorite: () => void;
}) {
  const worst = worstLevel(alerts);
  const trusted = feedTrust(snapshot, now) === 'ok';
  return (
    <>
      {favoriteLabel && (
        <button className="panel-section favorite-card" onClick={onFavorite}>
          <Star size={18} />
          <span>
            <strong>ที่ของฉัน · {favoriteLabel}</strong>
            <small>แตะเพื่อดูประกาศ ฝน และน้ำท่วมของที่นี่</small>
          </span>
        </button>
      )}
      <section className="panel-section" aria-labelledby="alerts-heading">
        <h2
          id="alerts-heading"
          className={worst ? `heading-level-${worst}` : trusted ? 'heading-ok' : 'heading-unknown'}
        >
          {worst ? (
            <ShieldAlert size={19} />
          ) : trusted ? (
            <ShieldCheck size={19} />
          ) : (
            <CircleHelp size={19} />
          )}
          {!snapshot?.feed
            ? 'ประกาศเตือนภัย'
            : alerts.length
              ? `ประกาศเตือนภัยที่มีผล ${alerts.length} ฉบับ`
              : trusted
                ? 'ไม่มีประกาศเตือนภัยที่มีผลตอนนี้'
                : 'ไม่พบประกาศที่มีผลในข้อมูลล่าสุดที่มี'}
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
      <FloodsNow
        floods={floods}
        floodsState={floodsState}
        now={now}
        openId={openFloodId}
        onFlood={onFlood}
      />
      {flooding && <RoadFloodingToday flooding={flooding} now={now} onRoad={onRoadName} />}
      <RadarNow radar={snapshot?.radar} now={now} />
      <section className="panel-section pin-hint">
        <MapPin size={20} />
        <p>
          <strong>แตะที่ใดก็ได้บนแผนที่เพื่อปักหมุด</strong>
          หรือพิมพ์ชื่อตำบล อำเภอ หรือสถานที่ในช่องค้นหาด้านบน แล้วดูประกาศ ฝน น้ำท่วมแถวนั้น
          และกล้องใกล้ๆ ของจุดนั้น
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
        {distance !== undefined && ` · ห่าง ${distanceText(distance)}`}
      </span>
    </li>
  );
}

export function PinCard({
  pin,
  place,
  nearby,
  snapshot,
  alerts,
  now,
  dataBase,
  step,
  forecast,
  forecastState,
  roads,
  roadsState,
  cameras,
  camerasState,
  floods,
  floodsState,
  water,
  waterState,
  rain,
  rainState,
  flooding,
  onClose,
  onSelectAlert,
  onRoad,
  favorite,
  onFavorite,
}: {
  pin: number[];
  /** chosen in the search box */
  place: FoundPlace | null;
  /** nearest subdistrict point, for a pin dropped on the map */
  nearby: { place: Place; distance: number } | null;
  snapshot: Snapshot | null;
  alerts: Alert[];
  now: number;
  dataBase: string | null;
  /** the time the map shows (timeline) */
  step: TimeStep;
  forecast: RainForecast | null;
  forecastState: RefState;
  roads: RoadFloodHistory | null;
  roadsState: RefState;
  cameras: Camera[];
  camerasState: RefState;
  floods: LiveFloods | null;
  floodsState: RefState;
  water: CanalLevels | null;
  waterState: RefState;
  rain: RainGauges | null;
  rainState: RefState;
  flooding: RoadFloodingDaily | null;
  onClose: () => void;
  onSelectAlert: (id: string) => void;
  onRoad: (road: Road) => void;
  /** this pin is the saved place */
  favorite: boolean;
  onFavorite: () => void;
}) {
  // A DOPA area is also covered when an alert lists its province (TMD warns province by province),
  // which still works for an alert without a boundary.
  const province = place?.province ?? null;
  const here = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (a.geometry && inMultiPolygon(pin, a.geometry.coordinates)) ||
          (province !== null && provincesOf(a).includes(province)),
      ),
    [alerts, pin, province],
  );
  const where = place?.source === 'dopa' ? ` ${place.title}` : 'จุดนี้';
  // alerts without a boundary that no province name ties to this place: they may or may not cover it
  const unplaced = alerts.filter((a) => !a.geometry && !here.includes(a));
  const trust = feedTrust(snapshot, now);
  const cap = snapshot?.manifest.source_status.find((s) => s.source_id === 'tmd_cap');
  const status: 'covered' | 'unknown' | 'uncertain' | 'unplaced' | 'clear' = here.length
    ? 'covered'
    : trust === 'none'
      ? 'unknown'
      : trust !== 'ok'
        ? 'uncertain'
        : unplaced.length
          ? 'unplaced'
          : 'clear';
  const area = place !== null && place.scale !== 'subdistrict' && place.scale !== 'point';
  const reading = useRadarAt(
    snapshot?.radar,
    dataBase,
    pin,
    step.kind === 'radar' ? step.frame : -1,
  );
  const future =
    step.kind === 'forecast' && forecast ? forecastAt(forecast, step.hour, pin) : undefined;
  const days = useMemo(() => {
    const all = forecast ? daysAt(forecast, pin) : null;
    return all?.filter((day) => day.date >= DAY.format(now)) ?? null;
  }, [forecast, pin, now]);
  const wettest = Math.max(10, ...(days ?? []).map((day) => day.rainMm ?? 0));
  const forecastOld = forecast ? now - Date.parse(forecast.fetched_at) > FORECAST_STALE_MS : false;
  const forecastSource = forecast
    ? `พยากรณ์จากแบบจำลอง ${forecast.credit_th} · ออกเมื่อ ${formatTime(forecast.fetched_at)} น. · ไม่ใช่ประกาศทางการ`
    : '';
  const radarAge = radarAgeMinutes(snapshot?.radar, now);
  const inRoadArea =
    !roads ||
    (pin[0] >= roads.bbox[0] &&
      pin[0] <= roads.bbox[2] &&
      pin[1] >= roads.bbox[1] &&
      pin[1] <= roads.bbox[3]);
  const nearAll = useMemo(() => (roads ? roadsNear(roads, pin) : []), [roads, pin]);
  const near = nearAll.slice(0, 5);
  // today's report of the department on the roads around the pin (matched by road name)
  const reportedHere = useMemo(
    () =>
      flooding && isTodaysReport(flooding, now)
        ? reportsOnRoads(
            flooding,
            nearAll.map(({ road }) => road.name_th),
          )
        : [],
    [flooding, nearAll, now],
  );
  const reportOld = flooding ? now - Date.parse(flooding.fetched_at) > BKK_STALE_MS : false;
  const nearCameras = useMemo(
    () =>
      cameras
        .filter((c) => c.location)
        .map((c) => ({ camera: c, distance: distanceM(pin, c.location!) }))
        .filter((c) => c.distance <= CAMERA_RADIUS_M)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3),
    [cameras, pin],
  );
  const floodsHere = useMemo(
    () => (floods ? floodsNear(floods, pin, now) : []),
    [floods, pin, now],
  );
  const floodsOld = floods ? now - Date.parse(floods.fetched_at) > FLOODS_STALE_MS : false;
  const nearRain = useMemo(
    () => (rain ? nearest(rain.gauges, pin, RAIN_RADIUS_M, 1) : []),
    [rain, pin],
  );
  const nearWater = useMemo(
    () => (water ? nearest(water.stations, pin, WATER_RADIUS_M, 3) : []),
    [water, pin],
  );
  const bkkOld = [water, rain].some(
    (file) => file && now - Date.parse(file.fetched_at) > BKK_STALE_MS,
  );
  const bkkFailed = [waterState, rainState].some((state) => state === 'error');
  const worst = worstLevel(here);
  return (
    <div className="pin-card" data-testid="pin-card">
      <div className="section-top pin-head">
        <div className="pin-title">
          <span className="eyebrow">
            <MapPin size={15} />{' '}
            {place
              ? place.source === 'dopa'
                ? 'พื้นที่ที่ค้นหา'
                : 'สถานที่ที่ค้นหา'
              : 'จุดที่ปักหมุด'}
          </span>
          <h2 className="place-name">
            {place
              ? place.title
              : nearby
                ? `แถว${nearby.place.label.split(' ')[0]}`
                : 'จุดบนแผนที่'}
          </h2>
          <small>
            {place
              ? [
                  place.detail,
                  place.source === 'dopa' ? 'จุดอ้างอิงกรมการปกครอง' : 'ตำแหน่งจาก OpenStreetMap',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : nearby
                ? `${nearby.place.label.split(' ').slice(1).join(' ')} · ห่างจุดอ้างอิงตำบล ${distanceText(nearby.distance)}`
                : 'ไม่พบชื่อตำบลใกล้จุดนี้'}
          </small>
          <small className="coordinates">
            {pin[1].toFixed(4)}, {pin[0].toFixed(4)}
          </small>
        </div>
        <div className="pin-buttons">
          <button
            className={`favorite-toggle ${favorite ? 'on' : ''}`}
            aria-pressed={favorite}
            onClick={onFavorite}
          >
            <Star size={16} /> {favorite ? 'ที่ของฉัน' : 'ตั้งเป็นที่ของฉัน'}
          </button>
          <button className="icon-button" aria-label="ปิดหมุด" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </div>

      <section className="panel-section" aria-labelledby="pin-now">
        <h2
          id="pin-now"
          className={
            status === 'covered'
              ? `heading-level-${worst}`
              : status === 'clear'
                ? 'heading-ok'
                : 'heading-unknown'
          }
        >
          {status === 'covered' ? (
            <ShieldAlert size={18} />
          ) : status === 'clear' ? (
            <CheckCircle2 size={18} />
          ) : (
            <CircleHelp size={18} />
          )}
          {status === 'covered'
            ? `มีประกาศครอบคลุม${where} ${here.length} ฉบับ`
            : status === 'unknown'
              ? `ยังตรวจประกาศของ${where}ไม่ได้`
              : status === 'uncertain'
                ? `ไม่พบประกาศครอบคลุม${where}ในข้อมูลล่าสุดที่มี`
                : status === 'unplaced'
                  ? `ไม่พบประกาศที่มีขอบเขตครอบคลุม${where}`
                  : `ไม่มีประกาศเตือนภัยครอบคลุม${where}`}
        </h2>
        {status === 'unknown' && (
          <p className="inline-warning">
            <Info size={15} /> ยังโหลดข้อมูลประกาศไม่สำเร็จ ไม่ได้แปลว่าไม่มีประกาศ
            โปรดตรวจสอบกับกรมอุตุนิยมวิทยา
          </p>
        )}
        {trust === 'stale' && snapshot && (
          <p className="inline-warning">
            <Info size={15} /> ข้อมูลไม่อัปเดตตั้งแต่ {formatTime(staleAfter(snapshot.manifest))} น.
            สถานะประกาศอาจเปลี่ยนแล้ว โปรดตรวจสอบกับกรมอุตุนิยมวิทยา
          </p>
        )}
        {trust === 'partial' && (
          <p className="inline-warning">
            <Info size={15} /> รอบล่าสุดดึงประกาศได้ไม่ครบ · ดึงสำเร็จล่าสุด{' '}
            {formatTime(cap?.last_success_at)}
            {cap?.last_success_at ? ' น.' : ''}
          </p>
        )}
        {here.map((alert) => (
          <AlertCard key={alert.event_id} alert={alert} now={now} onSelect={onSelectAlert} />
        ))}
        {status === 'unplaced' && (
          <>
            <p className="quiet">
              มีประกาศ {unplaced.length} ฉบับที่ไม่ระบุขอบเขตพิกัด
              จึงตรวจไม่ได้ว่าครอบคลุมจุดนี้หรือไม่
            </p>
            {unplaced.map((alert) => (
              <AlertCard key={alert.event_id} alert={alert} now={now} onSelect={onSelectAlert} />
            ))}
          </>
        )}
        {status === 'clear' && <p className="quiet">ตามประกาศกรมอุตุนิยมวิทยาที่มีผลตอนนี้</p>}
      </section>

      {step.kind === 'forecast' ? (
        <section className="panel-section forecast-now" aria-labelledby="pin-rain">
          <h2 id="pin-rain">
            <CloudRain size={18} />{' '}
            {area ? 'ฝนที่พยากรณ์ที่จุดกลางพื้นที่' : 'ฝนที่พยากรณ์ตรงจุดนี้'}
          </h2>
          <p className="quiet">ช่วง {hourRange(step.time, now)}</p>
          {future === null && (
            <p className="missing-value">จุดนี้อยู่นอกพื้นที่พยากรณ์ (เฉพาะประเทศไทย)</p>
          )}
          {future !== null && future !== undefined && (
            <p className={future >= 0.1 ? 'rain-value' : 'ok-value'}>
              {future >= 0.1
                ? `${rainWords(future)} ราว ${future.toFixed(1)} มม. ในชั่วโมงนั้น`
                : 'ไม่มีฝนในพยากรณ์ชั่วโมงนั้น'}
            </p>
          )}
          <small className="source-note">{forecastSource}</small>
        </section>
      ) : (
        <section className="panel-section" aria-labelledby="pin-rain">
          <h2 id="pin-rain">
            <CloudRain size={18} /> {area ? 'ฝนตอนนี้ที่จุดกลางพื้นที่' : 'ฝนตอนนี้ตรงจุดนี้'}
          </h2>
          {area && <p className="quiet">ดูฝนทั้งพื้นที่ได้จากสีบนแผนที่</p>}
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
      )}

      <section className="panel-section" aria-labelledby="pin-forecast">
        <h2 id="pin-forecast">ฝน 7 วัน</h2>
        {(forecastState === 'idle' || forecastState === 'loading') && (
          <p className="quiet">กำลังโหลดพยากรณ์…</p>
        )}
        {(forecastState === 'missing' || forecastState === 'error') && (
          <p className="missing-value">ยังไม่มีข้อมูลพยากรณ์</p>
        )}
        {forecast && !days && (
          <p className="missing-value">จุดนี้อยู่นอกพื้นที่พยากรณ์ (เฉพาะประเทศไทย)</p>
        )}
        {days && days.length > 0 && (
          <ul className="forecast-days" data-testid="forecast-days">
            {days.map((day) => (
              <li key={day.date}>
                <span className="day-name">{dayName(day.date, now)}</span>
                <WeatherIcon code={day.code} />
                <span className="day-words">{dayRainWords(day.rainMm)}</span>
                <span className="day-bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, ((day.rainMm ?? 0) / wettest) * 100)}%` }} />
                </span>
                <span className="day-numbers">
                  {day.rainMm === null ? '–' : `${Math.round(day.rainMm)} มม.`}
                  {day.probability !== null && <small> · {day.probability}%</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {forecastOld && (
          <p className="inline-warning">
            <Info size={15} /> พยากรณ์ไม่อัปเดต
          </p>
        )}
        {forecast && (
          <small className="source-note">
            ฝนรวมทั้งวันและโอกาสฝนสูงสุดของวัน · {forecastSource}
          </small>
        )}
      </section>

      {(nearRain.length > 0 || nearWater.length > 0) && (
        <section
          className="panel-section"
          aria-labelledby="pin-measured"
          data-testid="measured-here"
        >
          <h2 id="pin-measured">
            <Droplet size={18} /> ฝนและระดับน้ำที่วัดได้ใกล้ๆ (กทม.)
          </h2>
          {nearRain.map(({ item: gauge, distance }) => (
            <p key={gauge.code} className="measured-line">
              <strong>
                ฝน 1 ชม. {mmText(gauge.rain_1h_mm)} · 24 ชม. {mmText(gauge.rain_24h_mm)}
              </strong>
              <span>
                สถานี{gauge.name_th} ห่าง {distanceText(distance)} ·{' '}
                {gauge.observed_at
                  ? `วัดเมื่อ ${agoText(gauge.observed_at, now).replace(/^เมื่อ /, '')}`
                  : 'ไม่มีค่าล่าสุด'}
                {gauge.observed_at && !isRecent(gauge.observed_at, now) && ' (ค่าเก่า)'}
              </span>
            </p>
          ))}
          {nearWater.length > 0 && (
            <ul className="road-list" data-testid="water-here">
              {nearWater.map(({ item: station, distance }) => (
                <li key={station.code} className="road-line">
                  <strong>
                    {station.name_th} · ด้านใน {levelText(station.level_in_m)}
                  </strong>
                  <span>
                    {station.canal_th ? `${station.canal_th} · ` : ''}ห่าง {distanceText(distance)}{' '}
                    ·{' '}
                    {station.observed_at
                      ? `วัดเมื่อ ${agoText(station.observed_at, now).replace(/^เมื่อ /, '')}`
                      : 'ไม่มีค่าล่าสุด'}
                    {station.observed_at && !isRecent(station.observed_at, now) && ' (ค่าเก่า)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {bkkOld && (
            <p className="inline-warning">
              <Info size={15} /> ข้อมูลน้ำและฝนของ กทม. ไม่อัปเดตตั้งแต่{' '}
              {formatTime((water ?? rain)!.fetched_at)} น.
            </p>
          )}
          <small className="source-note">
            วัดจริงโดย{(water ?? rain)!.credit_th.replace(/ \(ผ่านระบบ DXS\)$/, '')} ผ่านระบบ DXS ·
            ระดับน้ำเป็น ม.รทก. (เทียบระดับทะเล) ไม่ใช่ความลึกน้ำท่วมบนถนน
          </small>
        </section>
      )}
      {bkkFailed && nearRain.length === 0 && nearWater.length === 0 && (
        <p className="missing-value">โหลดข้อมูลน้ำและฝนของ กทม. ไม่สำเร็จ</p>
      )}

      <section className="panel-section" aria-labelledby="pin-flood">
        <h2
          id="pin-flood"
          className={floodsHere.some((f) => isOngoing(f.report, now)) ? 'heading-rain' : undefined}
        >
          <Waves size={18} /> น้ำท่วมตอนนี้ (รายงานในรัศมี {FLOOD_RADIUS_M / 1000} กม.)
        </h2>
        {(floodsState === 'idle' || floodsState === 'loading') && (
          <p className="quiet">กำลังโหลดรายงานน้ำท่วม…</p>
        )}
        {(floodsState === 'missing' || floodsState === 'error') && (
          <p className="missing-value">ยังไม่มีข้อมูลรายงานน้ำท่วมสด</p>
        )}
        {floods && floodsHere.length === 0 && (
          <p className="quiet">ยังไม่มีรายงานน้ำท่วมใกล้จุดนี้ในช่วง 2 ชม. · ไม่ได้แปลว่าไม่ท่วม</p>
        )}
        {floodsHere.length > 0 && (
          <ul className="flood-list" data-testid="floods-here">
            {floodsHere.slice(0, 5).map(({ report, distance }) => (
              <li key={report.id}>
                <a href={report.url} target="_blank" rel="noopener noreferrer">
                  <FloodLine report={report} now={now} distance={distance} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {floodsOld && (
          <p className="inline-warning">
            <Info size={15} /> รายงานน้ำท่วมไม่อัปเดตตั้งแต่ {formatTime(floods!.fetched_at)} น.
          </p>
        )}
        {reportedHere.length > 0 && (
          <div className="road-report-here" data-testid="road-report-here">
            <strong>
              {reportOld
                ? `สำนักการระบายน้ำรายงาน (ข้อมูลเมื่อ ${reportTime(flooding!.fetched_at, now)}) บนถนนแถวนี้`
                : 'สำนักการระบายน้ำรายงานวันนี้ บนถนนแถวนี้'}
            </strong>
            <ul className="flood-list">
              {reportedHere.slice(0, 5).map((report, index) => (
                <li key={`${index}:${report.road_th}:${report.area_th ?? ''}`}>
                  <RoadFloodingLine report={report} now={now} old={reportOld} />
                </li>
              ))}
            </ul>
            <small className="source-note">
              จับคู่จากชื่อถนนที่อยู่ในรัศมี 2 กม. จุดที่ท่วมจริงอาจอยู่ไกลจากหมุด ดูบริเวณในรายการ
            </small>
          </div>
        )}
        {floods && (
          <small className="source-note">
            รายงานจากผู้ใช้และหน่วยงาน ไม่ใช่การตรวจวัด · {floods.credit_th}
          </small>
        )}
        <details className="history-details flood-history">
          <summary>
            <Route size={15} /> ประวัติ: ถนนแถวนี้ที่เคยมีรายงานน้ำท่วม (ข้อมูลย้อนหลัง
            ไม่ใช่ตอนนี้)
          </summary>
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
          {roadsState === 'outdated' && (
            <p className="inline-warning">
              <Info size={15} /> ประวัติชุดก่อน เพราะโหลดรุ่นใหม่ไม่สำเร็จ
            </p>
          )}
          {roads && (
            <small className="source-note">
              ที่มา: {roads.sources.map((s) => s.credit_th).join(' · ')}
            </small>
          )}
        </details>
      </section>

      <section className="panel-section" aria-labelledby="pin-cameras">
        <h2 id="pin-cameras">
          <CameraIcon size={18} /> กล้องใกล้ๆ ({CAMERA_RADIUS_M / 1000} กม.)
        </h2>
        {(camerasState === 'idle' || camerasState === 'loading') && (
          <p className="quiet">กำลังโหลดทะเบียนกล้อง…</p>
        )}
        {camerasState === 'error' && (
          <p className="missing-value">
            โหลดทะเบียนกล้องไม่สำเร็จ · ยังบอกไม่ได้ว่ามีกล้องใกล้จุดนี้ไหม
          </p>
        )}
        {camerasState === 'missing' && (
          <p className="missing-value">ชุดข้อมูลนี้ยังไม่มีทะเบียนกล้อง</p>
        )}
        {camerasState === 'outdated' && (
          <p className="inline-warning">
            <Info size={15} /> ทะเบียนกล้องชุดก่อน เพราะโหลดรุ่นใหม่ไม่สำเร็จ
          </p>
        )}
        {(camerasState === 'ready' || camerasState === 'outdated') && nearCameras.length === 0 ? (
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
