import { useEffect, useMemo, useRef, useState } from 'react';
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
  Dam as DamIcon,
  Droplet,
  Info,
  ListChecks,
  Megaphone,
  MapPin,
  Phone,
  Star,
  Route,
  ShieldAlert,
  ShieldCheck,
  Spline,
  Sun,
  TrendingUp,
  Waves,
  X,
} from 'lucide-react';
import {
  riverDay,
  riverSummary,
  riverWords,
  RIVERS_STALE_MS,
  type RiverForecast,
  type RiverRow,
} from './rivers';
import {
  displayStatus,
  formatTime,
  radarAgeMinutes,
  safeLink,
  staleAfter,
  type Alert,
  type Camera,
  type CanalOutlook,
  type LiveFloods,
  type RainForecast,
  type RoadFloodHistory,
  type Snapshot,
} from './data';
import {
  LEVEL_LABEL,
  dateTime,
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
import { dayRainClass, dayRainWords, daysAt, forecastAt } from './forecast';
import {
  floodsNear,
  FLOOD_RADIUS_M,
  FLOODS_STALE_MS,
  isOngoing,
  latestFloods,
  reportedAt,
  REPORTER_TH,
  type FloodReport,
} from './floods';
import type { TimeStep } from './Timeline';
import { distanceM, roadsNear } from './roads';
import {
  bangkokDistrict,
  BKK_STALE_MS,
  floodingText,
  isRecent,
  amount,
  CHAO_PHRAYA_DAMS,
  DAY_RAIN_CLASSES,
  damColor,
  carriedFrom,
  carriedText,
  damMissingText,
  damReadingLines,
  damWords,
  hasDamReadings,
  isTodaysReport,
  shownDam,
  releaseChange,
  releaseWords,
  levelChange,
  levelChangeWords,
  levelWords,
  measuredText,
  oldNote,
  damsOldNote,
  nearest,
  rainAmountWords,
  RAIN_RADIUS_M,
  reportsOnRoads,
  shortCredit,
  reportTime,
  roadLabel,
  thaiDay,
  WATER_RADIUS_M,
  type CanalLevels,
  type RainGauges,
  type Dam,
  type DamReport,
  type RoadFloodingDaily,
  type RoadFloodingReport,
  type SituationReport,
} from './bkk';
import { useRadarAt } from './radarAt';
import { Fold, Section } from './Fold';
import { StatusBar, statusCounts } from './StatusBar';
import { situationSummary, situationTimeLabel, situationWorthShowing } from './situation';
import { BANK_COLORS, bankState, type BankObservation } from './overflow';
import {
  changeSince,
  groupByProvince,
  officialFor,
  officialLine,
  oldInputs,
  OVERVIEW_STALE_MS,
  OVERVIEW_TOO_OLD_MS,
  OVERVIEW_TOP,
  placeParts,
  REASON_TONE,
  reasonLine,
  shownItems,
  type Overview as SummaryOverview,
  type OverviewItem,
} from './overview';
import type { RefState } from './useData';
import { canalsOld, canalsToWatch, canalWords, factorText, gapLines } from './flows';

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
    <Fold
      id="hotlines"
      headingId="hotlines-heading"
      className="hotlines"
      heading={
        <>
          <Phone size={18} /> สายด่วนเมื่อน้ำท่วม
        </>
      }
    >
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
    </Fold>
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
        {reportedAt(report.start, now)} · {REPORTER_TH[report.reporter]}
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
  // shown only when today's report names roads (user 2026-10-02: an empty or another day's report says nothing);
  // the summary and the pin card still use it
  if (!isTodaysReport(flooding, now) || !flooding.reports.length) return null;
  return (
    <Fold
      id="road-flooding"
      headingId="road-flooding-heading"
      testId="road-flooding"
      headingClass={wet.length ? 'heading-rain' : undefined}
      heading={
        <>
          <Route size={18} />{' '}
          {old
            ? `รายงานถนนท่วม กทม. เมื่อ ${reportTime(flooding.fetched_at, now)}`
            : wet.length
              ? `ถนนสายหลัก กทม. ที่ยังท่วม ${wet.length} จุด`
              : 'น้ำท่วมขังถนนสายหลัก กทม. วันนี้'}
        </>
      }
    >
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
          <Info size={15} /> {oldNote(flooding.fetched_at, now)} · ถนนที่ขึ้นว่ายังท่วมอาจแห้งแล้ว
          หรือมีจุดท่วมเพิ่ม
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
    </Fold>
  );
}

function SituationCard({ news, now }: { news: SituationReport; now: number }) {
  const { rain, time, warning } = situationSummary(news.text_th, now);
  const source = safeLink(news.source_url);
  return (
    <Fold
      id="situation"
      headingId="situation-heading"
      testId="situation"
      heading={
        <>
          <Megaphone size={18} /> รายงานฝน กทม.
        </>
      }
    >
      {warning && (
        <p className="inline-warning">
          <Info size={15} /> {warning}
        </p>
      )}
      <ul className="situation-summary">
        {rain.length ? (
          rain.map((text, index) => (
            <li key={index}>
              <strong>ฝน:</strong> {text}
            </li>
          ))
        ) : (
          <li>ยังสรุปฝนจากข้อความนี้ไม่ได้ · อ่านข้อความต้นฉบับ</li>
        )}
        <li>
          <strong>เวลารายงาน:</strong> {time ? situationTimeLabel(time) : 'ไม่ทราบ'}
        </li>
      </ul>
      <p className="quiet">ข้อมูล ณ เวลารายงาน ไม่ใช่พยากรณ์ฝน</p>
      <details className="history-details">
        <summary>ข้อความต้นฉบับ</summary>
        <strong className="situation-subject">{news.subject_th}</strong>
        {news.text_th.split('\n').map((text, index) => (
          <p key={index} className="situation-text">
            {text}
          </p>
        ))}
      </details>
      <small className="source-note">
        ที่มา:{' '}
        {source ? (
          <a href={source} target="_blank" rel="noopener noreferrer">
            {shortCredit(news.credit_th)} ↗
          </a>
        ) : (
          shortCredit(news.credit_th)
        )}{' '}
        · ไม่ใช่ประกาศเตือนภัยของกรมอุตุฯ
      </small>
    </Fold>
  );
}

function DamLine({
  dam,
  previousDay,
  onDam,
}: {
  dam: Dam;
  /** day of the report the releases are compared with (the file's previous_report_date) */
  previousDay: string | null;
  onDam: (location: number[]) => void;
}) {
  // a bar filled to how full the reservoir is, in the department's colour for that class, with marks where the
  // classes change (30, 50, 80 %): read at a glance, the words and figures say the same for a screen reader
  // a dam the report leaves blank shows its last known figures, with their day and fetch time (user 2026-10-01)
  const shown = shownDam(dam);
  const carried = carriedFrom(dam);
  const fill = shown.percent === null ? 0 : Math.max(0, Math.min(shown.percent, 100));
  const change = previousDay ? releaseChange(dam) : null;
  const missing = damMissingText(shown);
  const text = (
    <span className="dam-line">
      <span className="dam-head">
        <span>
          <strong>{dam.name_th}</strong>
          {shown.percent !== null && ` · ${damWords(shown.percent)}`}
        </span>
        {shown.percent !== null && <b className="dam-percent">{amount(shown.percent)}%</b>}
      </span>
      {shown.percent !== null && (
        <span className={`dam-bar ${shown.percent > 100 ? 'over' : ''}`} aria-hidden="true">
          <span
            className="dam-fill"
            style={{ width: `${fill}%`, background: damColor(shown.percent) }}
          />
          <i style={{ left: '30%' }} />
          <i style={{ left: '50%' }} />
          <i style={{ left: '80%' }} />
        </span>
      )}
      {dam.region_th && <small>{dam.region_th}</small>}
      {damReadingLines(shown).map((reading) => (
        <small key={reading}>{reading}</small>
      ))}
      {carried && <small className="dam-carried">{carriedText(carried)}</small>}
      {missing && <small className="quiet">{missing}</small>}
      {!dam.location && <small>ไม่มีหมุดบนแผนที่</small>}
      {/* the release against the report before (GetDam gives one day: the day before is what the site had) */}
      {change && previousDay && (
        <small className={`dam-release ${change.direction}${change.big ? ' big' : ''}`}>
          {change.direction !== 'same' && (
            <span aria-hidden="true">{change.direction === 'up' ? '↑ ' : '↓ '}</span>
          )}
          {releaseWords(change, previousDay)}
        </small>
      )}
      {/* where the water goes, for a dam with little room left or releasing a lot more: places to follow, not a
          flood forecast */}
      {dam.downstream_th &&
        ((shown.percent !== null && shown.percent >= 80) || (change !== null && change.big)) && (
          <small className="dam-downstream">{dam.downstream_th}</small>
        )}
    </span>
  );
  // a dam without a place has no pin: it is listed, never put at a guessed place (contract section 18)
  return (
    <li>
      {dam.location ? (
        <button className="road-button" onClick={() => onDam(dam.location!)}>
          {text}
        </button>
      ) : (
        text
      )}
    </li>
  );
}

function ChaoPhrayaDams({
  dams,
  now,
  onDam,
}: {
  dams: DamReport;
  now: number;
  /** show the dam on the map; the side panel stays */
  onDam: (location: number[]) => void;
}) {
  // a dam with its last known figures is shown, dated; only a dam with neither is "missing"
  const shows = (dam: Dam) => hasDamReadings(dam) || carriedFrom(dam) !== null;
  const available = dams.dams.filter(shows);
  const missing = dams.dams.filter((dam) => !shows(dam));
  const ofToday = dams.dams.filter(hasDamReadings).length;
  const carriedCount = available.length - ofToday;
  const main = CHAO_PHRAYA_DAMS.flatMap((id) => available.filter((dam) => dam.id === id));
  const missingMain = CHAO_PHRAYA_DAMS.filter((id) => !main.some((dam) => dam.id === id)).length;
  const rest = available
    .filter((dam) => !CHAO_PHRAYA_DAMS.includes(dam.id))
    .sort((a, b) => (shownDam(b).percent ?? -1) - (shownDam(a).percent ?? -1));
  // over storage capacity, or releasing a lot more than the report before, is worth seeing without opening the
  // list, wherever the dam is
  const previousDay = dams.previous_report_date ?? null;
  const full = rest.filter((dam) => (shownDam(dam).percent ?? 0) > 100);
  const releasing = previousDay
    ? rest.filter((dam) => !full.includes(dam) && releaseChange(dam)?.big)
    : [];
  const others = rest.filter((dam) => !full.includes(dam) && !releasing.includes(dam));
  const overFull = available.filter((dam) => (shownDam(dam).percent ?? 0) > 100).length;
  const note = damsOldNote(dams, now);
  return (
    <Section
      id="dams"
      headingId="dams-heading"
      testId="dams"
      heading={
        <>
          <DamIcon size={18} /> เขื่อนใหญ่
          {overFull > 0 && ` · เกินความจุ ${overFull} แห่ง`}
        </>
      }
    >
      <p className="quiet" data-testid="dams-coverage">
        {ofToday > 0
          ? `มีตัวเลขในรายงานนี้ ${ofToday} จาก ${dams.dams.length} แห่ง`
          : 'ยังไม่มีตัวเลขเขื่อนในรายงานนี้'}
        {carriedCount > 0 &&
          ` · อีก ${carriedCount} แห่งแสดงตัวเลขล่าสุดที่มี พร้อมวันที่และเวลาที่ได้มา`}
      </p>
      {(main.length > 0 || missingMain > 0) && (
        <>
          <h3 className="dams-group">เขื่อนหลักเหนือกรุงเทพฯ (ลุ่มเจ้าพระยา)</h3>
          {main.length > 0 && (
            <ul className="flood-list">
              {main.map((dam) => (
                <DamLine key={dam.id} dam={dam} previousDay={previousDay} onDam={onDam} />
              ))}
            </ul>
          )}
          {missingMain > 0 && (
            <p className="inline-warning" data-testid="dams-main-missing">
              ยังไม่มีตัวเลขล่าสุดของเขื่อนหลัก {missingMain} แห่ง
              จึงยังประเมินสถานการณ์ของเขื่อนที่ขาดข้อมูลไม่ได้
            </p>
          )}
        </>
      )}
      {full.length > 0 && (
        <>
          <h3 className="dams-group">น้ำเกินความจุเก็บกัก</h3>
          <ul className="flood-list">
            {full.map((dam) => (
              <DamLine key={dam.id} dam={dam} previousDay={previousDay} onDam={onDam} />
            ))}
          </ul>
        </>
      )}
      {releasing.length > 0 && (
        <>
          <h3 className="dams-group">ระบายน้ำเพิ่มมาก</h3>
          <ul className="flood-list" data-testid="dams-releasing">
            {releasing.map((dam) => (
              <DamLine key={dam.id} dam={dam} previousDay={previousDay} onDam={onDam} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <details className="flood-history" data-testid="dams-others">
          <summary>เขื่อนใหญ่อื่นๆ {others.length} แห่ง (น้ำมากก่อน)</summary>
          <ul className="flood-list">
            {others.map((dam) => (
              <DamLine key={dam.id} dam={dam} previousDay={previousDay} onDam={onDam} />
            ))}
          </ul>
        </details>
      )}
      {missing.length > 0 && (
        <details className="flood-history" data-testid="dams-missing">
          <summary>เขื่อนที่ยังไม่มีตัวเลขในรายงานนี้ ({missing.length} แห่ง)</summary>
          <ul className="flood-list">
            {missing.map((dam) => (
              <li key={dam.id}>
                {dam.location ? (
                  <button className="road-button" onClick={() => onDam(dam.location!)}>
                    {dam.name_th}
                  </button>
                ) : (
                  dam.name_th
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {note && (
        <p className="inline-warning">
          <Info size={15} /> {note}
        </p>
      )}
      <small className="source-note">
        ข้อมูลวันที่ {thaiDay(dams.report_date)} · ที่มา: {shortCredit(dams.credit_th)} ·
        แตะชื่อเพื่อดูบนแผนที่
        {available.some((dam) => shownDam(dam).percent !== null) &&
          ' · น้ำเกิน 80% แปลว่าเหลือที่รับน้ำน้อย ไม่ใช่การพยากรณ์ว่าจะท่วม'}
        {previousDay &&
          available.some((dam) => releaseChange(dam)) &&
          ` · ระบายเพิ่มมาก = เพิ่มอย่างน้อย 1 ล้าน ลบ.ม./วัน และอย่างน้อยครึ่งหนึ่งจากรายงาน ${thaiDay(previousDay)} (เกณฑ์ทดลองของเว็บ)`}
      </small>
    </Section>
  );
}

/** Places to watch now and to prepare for, by the site's rules; the official alerts come below, apart. */
function WatchSummary({
  overview,
  alerts,
  now,
  onPlace,
  onPlaces,
}: {
  overview: SummaryOverview;
  alerts: Alert[];
  now: number;
  onPlace: (item: OverviewItem) => void;
  /** the districts of a province together on the map */
  onPlaces: (items: OverviewItem[]) => void;
}) {
  const [all, setAll] = useState(false);
  const age = now - Date.parse(overview.generated_at);
  const tooOld = age > OVERVIEW_TOO_OLD_MS;
  const lists = [
    { when: 'now' as const, title: 'ต้องระวังตอนนี้', empty: 'ยังไม่พบจุดที่เข้าเกณฑ์ตอนนี้' },
    {
      when: 'next' as const,
      title: 'เตรียมรับมือในวันข้างหน้า',
      empty: 'ยังไม่พบฝนหนักหรือน้ำขึ้นมากตามเกณฑ์',
    },
  ].map((list) => {
    const items = shownItems(overview, list.when, now);
    // the places to watch now go by province; the ones to prepare for are provinces, rivers and dams already
    const groups =
      list.when === 'now'
        ? groupByProvince(items)
        : items.map((item) => ({ province: item.place_th, items: [item] }));
    // what is new since the round about an hour before (user 2026-10-01)
    const change = changeSince(overview, list.when, now);
    return { ...list, items, groups, change, added: new Set(change?.added ?? []) };
  });
  const more = lists.some((list) => list.groups.length > OVERVIEW_TOP);
  const isNew = (item: OverviewItem) =>
    lists.some((list) => list.when === item.when && list.added.has(item.place_th));
  const placeButton = (item: OverviewItem) => {
    const alert = officialFor(item, alerts, now);
    // one line per reason, the three that matter most (they come ordered)
    const lines = item.reasons
      .map((reason) => ({ text: reasonLine(reason, now), tone: REASON_TONE[reason.kind] }))
      .filter((line): line is { text: string; tone: 'danger' | 'warn' | undefined } => !!line.text)
      .slice(0, 3);
    return (
      <li key={`${item.when}:${item.place_th}`}>
        <button className="summary-item" onClick={() => onPlace(item)}>
          <span className="summary-place">
            <strong>{item.place_th}</strong>
            {isNew(item) && <span className="new-chip">ใหม่</span>}
            {alert && (
              <span className={`level-chip level-${alert.level}`}>
                {alert.pending ? 'ประกาศล่วงหน้า' : 'มีประกาศ'} {LEVEL_LABEL[alert.level]}
              </span>
            )}
          </span>
          {item.detail_th && <small>{item.detail_th}</small>}
          <span className="summary-reasons">
            {lines.map((line) => (
              <span key={line.text} className={line.tone ? `reason-line ${line.tone}` : undefined}>
                {line.tone === 'danger' ? `⚠ ${line.text}` : line.text}
              </span>
            ))}
          </span>
        </button>
      </li>
    );
  };
  const official = officialLine(alerts);
  const missing = oldInputs(overview);
  return (
    <section
      id="summary"
      className="panel-section summary-card"
      aria-labelledby="summary-heading"
      data-testid="summary"
    >
      <h2 id="summary-heading">
        <ListChecks size={18} /> ภาพรวม: จุดที่ต้องระวัง
      </h2>
      <p className="summary-lead">
        สรุปอัตโนมัติจากข้อมูลทุกชุดด้วยเกณฑ์ของเว็บ (ทดลอง) ไม่ใช่ประกาศทางการ
      </p>
      {official && <p className="summary-official">{official}</p>}
      {age > OVERVIEW_STALE_MS && (
        <p className="inline-warning">
          <Info size={15} /> สรุปนี้ไม่ได้อัปเดต · สรุปเมื่อ{' '}
          {reportTime(overview.generated_at, now)}
          {tooOld && ' เก่าเกินไปจึงไม่แสดงรายการ'}
        </p>
      )}
      {lists.map((list) => (
        <div key={list.when} className="summary-group">
          <h3>
            {list.title}
            {list.items.length > 0 && ` ${list.items.length} แห่ง`}
            {list.groups.length > 1 &&
              list.groups.length < list.items.length &&
              ` ใน ${list.groups.length} จังหวัด`}
          </h3>
          {list.change && (
            <p className="summary-change">
              เทียบกับรอบ {reportTime(list.change.at, now)}:{' '}
              {list.change.added.length || list.change.passed
                ? [
                    list.change.added.length && `ใหม่ ${list.change.added.length} แห่ง`,
                    list.change.passed && `พ้นเกณฑ์แล้ว ${list.change.passed} แห่ง`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'เท่าเดิม'}
            </p>
          )}
          {list.items.length === 0 ? (
            <p className="quiet">
              {tooOld ? 'ไม่มีข้อมูลที่ใหม่พอ' : `${list.empty} (ไม่ได้แปลว่าปลอดภัย)`}
            </p>
          ) : (
            <ul className="summary-list">
              {(all ? list.groups : list.groups.slice(0, OVERVIEW_TOP)).map((group) => {
                if (group.items.length === 1) return placeButton(group.items[0]);
                // a province with several districts: one card, the first line of each kind of reason (what is
                // happening before what is forecast), the districts as chips
                const top = group.items[0];
                const alert = officialFor(top, alerts, now);
                const kinds = new Set<string>();
                const happening: string[] = [];
                const ahead: string[] = [];
                for (const item of group.items)
                  for (const reason of item.reasons) {
                    const text = kinds.has(reason.kind) ? null : reasonLine(reason, now);
                    if (text === null) continue;
                    kinds.add(reason.kind);
                    (reason.day ? ahead : happening).push(text);
                  }
                const lines = [...happening, ...ahead].slice(0, 3);
                const unit = group.items.every((item) => item.place_th.startsWith('เขต'))
                  ? 'เขต'
                  : 'อำเภอ';
                return (
                  <li key={`${list.when}:province:${group.province}`} className="summary-province">
                    <button className="summary-item" onClick={() => onPlaces(group.items)}>
                      <span className="summary-place">
                        <strong>{group.province}</strong> · {group.items.length} {unit}
                        {alert && (
                          <span className={`level-chip level-${alert.level}`}>
                            {alert.pending ? 'ประกาศล่วงหน้า' : 'มีประกาศ'}{' '}
                            {LEVEL_LABEL[alert.level]}
                          </span>
                        )}
                      </span>
                      <span className="summary-reasons">
                        {lines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </span>
                    </button>
                    <span className="summary-districts">
                      {group.items.map((item) => (
                        <button
                          key={item.place_th}
                          className="district-chip"
                          onClick={() => onPlace(item)}
                        >
                          {placeParts(item.place_th)[0]}
                          {isNew(item) && <span className="new-chip">ใหม่</span>}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {more && (
        <button className="link-button" aria-expanded={all} onClick={() => setAll((open) => !open)}>
          {all ? 'แสดงน้อยลง' : 'ดูทั้งหมด'}
        </button>
      )}
      <small className="source-note">
        สรุปเมื่อ {reportTime(overview.generated_at, now)} จากรายงานน้ำท่วม, สำนักการระบายน้ำ กทม.,
        พยากรณ์ Open-Meteo, GloFAS และกรมชลประทาน
        {missing.length > 0 && ` · ไม่ได้ใช้เพราะไม่อัปเดต: ${missing.join(', ')}`} ·{' '}
        <a href={`${import.meta.env.BASE_URL}method/#summary`}>วิธีคิด</a>
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
    <Section
      id="floods-now"
      headingId="floods-now-heading"
      headingClass={ongoing ? 'heading-rain' : undefined}
      heading={
        <>
          <Waves size={18} />{' '}
          {ongoing ? `รายงานน้ำท่วมตอนนี้ ${ongoing} จุด` : 'รายงานน้ำท่วมตอนนี้'}
        </>
      }
    >
      {floods && <p className="quiet">ข้อมูลถึง {dateTime(floods.fetched_at)}</p>}
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
    </Section>
  );
}

/**
 * The main rivers in the next 7 days, from the system's forecast (user 2026-10-02: say where the lines are and that
 * they are the system's forecast): those forecast to rise with their strongest stretch, or that none is.
 */
function RiverOutlookCard({
  rivers,
  rows,
  now,
  onRiver,
}: {
  rivers: RiverForecast;
  /** riverSummary of `rivers` */
  rows: RiverRow[];
  now: number;
  onRiver: (points: number[][]) => void;
}) {
  const rising = rows.filter((row) => row.rising.length > 0);
  // nothing to worry about: no card (user 2026-10-02); the thin lines on the map still show the forecast
  if (!rising.length) return null;
  const old = now - Date.parse(rivers.fetched_at) > RIVERS_STALE_MS;
  const source = safeLink(rivers.source_url);
  return (
    <Section
      id="rivers"
      headingId="rivers-heading"
      testId="rivers"
      headingClass={rising.length ? 'heading-rain' : undefined}
      heading={
        <>
          <TrendingUp size={18} /> แม่น้ำสายหลัก 7 วันข้างหน้า
          {rising.length > 0 && ` · น้ำจะเพิ่ม ${rising.length} สาย`}
        </>
      }
    >
      {old && (
        <p className="inline-warning">
          <Info size={15} /> พยากรณ์ไม่อัปเดต · แสดงข้อมูลครั้งก่อน
        </p>
      )}
      {rising.length ? (
        <ul className="flood-list">
          {rising.map((row) => (
            <li key={row.river}>
              <button
                className="road-button"
                onClick={() => onRiver(row.rising.map((item) => item.point.location))}
              >
                <span className="flood-line">
                  <strong>{row.river}</strong>
                  <span>
                    {riverWords(row.rising[0].outlook)} · {row.rising.length} ช่วง
                  </span>
                  <small>มากสุด{row.rising[0].point.name_th.replace(/^\S+\s+/, '')}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">
          ยังไม่มีแม่น้ำสายหลักที่คาดว่าน้ำจะเพิ่ม · ทรงตัวหรือลดลงทั้ง {rows.length} สาย
        </p>
      )}
      <small className="source-note">
        พยากรณ์ของระบบจากแบบจำลอง GloFAS (ทดลอง) จุดคำนวณราวทุก 50 กม. · ไม่ใช่ประกาศ
        และไม่ใช่ระดับน้ำที่วัดได้ · ฝนหนักเฉพาะที่ยังทำให้น้ำท่วมได้ · เส้นบนแผนที่: ส้ม/แดง =
        น้ำจะเพิ่ม · อัปเดต {reportTime(rivers.fetched_at, now)} ·{' '}
        {source && (
          <a href={source} target="_blank" rel="noopener noreferrer">
            ที่มา ↗
          </a>
        )}
      </small>
    </Section>
  );
}

/**
 * The canals of the pilot that may overflow by the site's trial rules (D35, user 2026-10-03: the gates' figures as
 * one factor of which canal may flood): shown only while one is at watch or warn, each with the factors that count.
 */
function CanalCard({
  outlook,
  now,
  onCanal,
}: {
  outlook: CanalOutlook;
  now: number;
  /** show the canal on the map; the side panel stays */
  onCanal: (id: string) => void;
}) {
  const shown = canalsToWatch(outlook);
  // nothing adds up: no card (user 2026-10-02); the thin lines on the map still show the canals followed
  if (!shown.length) return null;
  const warn = shown.filter((watch) => watch.level === 'warn').length;
  return (
    <Section
      id="canals"
      headingId="canals-heading"
      testId="canals"
      headingClass={warn ? 'heading-rain' : undefined}
      heading={
        <>
          <Spline size={18} /> คลองที่อาจล้น (ทดลอง)
          {warn ? ` · ต้องระวัง ${warn} สาย` : ` · เฝ้าดู ${shown.length} สาย`}
        </>
      }
    >
      {canalsOld(outlook, now) && (
        <p className="inline-warning">
          <Info size={15} /> ผลประเมินไม่อัปเดต · แสดงผลครั้งก่อน
        </p>
      )}
      <ul className="flood-list">
        {shown.map((watch) => (
          <li key={watch.id}>
            <button className="road-button" onClick={() => onCanal(watch.id)}>
              <span className="flood-line">
                <strong>{watch.name_th}</strong>
                <span className={`canal-level ${watch.level}`}>{canalWords(watch)}</span>
                {watch.factors
                  .filter((factor) => factor.points > 0)
                  .map((factor, i) => (
                    <small key={`${factor.kind}-${i}`}>{factorText(factor)}</small>
                  ))}
                {gapLines(watch).map((text) => (
                  <small key={text} className="quiet">
                    ยังไม่ได้นับ {text}
                  </small>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <small className="source-note">
        เกณฑ์ทดลองของเว็บ ไม่ใช่ประกาศ และยังไม่ได้ทดสอบย้อนหลังกับเหตุการณ์จริง ·
        คะแนนบอกว่าปัจจัยที่ทำให้น้ำในคลองสูงขึ้นมาพร้อมกันกี่อย่าง ไม่ได้บอกว่าน้ำจะสูงเท่าไร ·
        จากตัวเลขกรมชลประทาน พยากรณ์ฝน และระดับน้ำ กทม. · คิดเมื่อ{' '}
        {reportTime(outlook.generated_at, now)} · แตะชื่อเพื่อดูบนแผนที่ ·{' '}
        <a href={`${import.meta.env.BASE_URL}method/#canals`}>วิธีคิด</a>
      </small>
    </Section>
  );
}

export function Overview({
  snapshot,
  alerts,
  now,
  loading,
  floods,
  floodsState,
  openFloodId,
  flooding,
  onRoadName,
  news,
  dams,
  rivers,
  onRiver,
  canals,
  onCanal,
  water,
  onBank,
  onDam,
  summary,
  summaryState,
  onPlace,
  onPlaces,
  onSelectAlert,
  onFlood,
}: {
  snapshot: Snapshot | null;
  alerts: Alert[];
  now: number;
  loading: boolean;
  floods: LiveFloods | null;
  floodsState: RefState;
  openFloodId: string | null;
  flooding: RoadFloodingDaily | null;
  onRoadName: (name: string) => void;
  news: SituationReport | null;
  dams: DamReport | null;
  /** the GloFAS river forecast, or null (not published, or the timeline on the forecast) */
  rivers: RiverForecast | null;
  onRiver: (points: number[][]) => void;
  /** the canals' outlook by the trial rules (D35), or null (not published, or the timeline on the forecast) */
  canals: CanalOutlook | null;
  onCanal: (id: string) => void;
  water: CanalLevels | null;
  onBank: (item: BankObservation) => void;
  onDam: (location: number[]) => void;
  /** the places to watch (summary/overview.json), or null before it is published */
  summary: SummaryOverview | null;
  /** how the summary file loaded: the status bar never says "nothing found" from one it could not read (M40) */
  summaryState: RefState;
  onPlace: (item: OverviewItem) => void;
  onPlaces: (items: OverviewItem[]) => void;
  onSelectAlert: (id: string) => void;
  onFlood: (report: FloodReport) => void;
}) {
  const worst = worstLevel(alerts);
  const trusted = feedTrust(snapshot, now) === 'ok';
  // read by the status bar and the rivers card; the trends change with the day, not with every tick of the clock
  const day = riverDay(now);
  const riverRows = useMemo(() => (rivers ? riverSummary(rivers, now) : null), [rivers, day]);
  return (
    <>
      <StatusBar
        counts={statusCounts({
          summary,
          floods,
          dams,
          riverRows,
          canals,
          summaryLoad: summaryState,
          alerts,
          trusted,
          worst,
          now,
        })}
      />
      {summary && (
        <WatchSummary
          overview={summary}
          alerts={alerts}
          now={now}
          onPlace={onPlace}
          onPlaces={onPlaces}
        />
      )}
      <FloodsNow
        floods={floods}
        floodsState={floodsState}
        now={now}
        openId={openFloodId}
        onFlood={onFlood}
      />
      {/* how full the dams are comes before the alerts: the user reads it at a glance (2026-09-28) */}
      {dams && <ChaoPhrayaDams dams={dams} now={now} onDam={onDam} />}
      {rivers && riverRows && (
        <RiverOutlookCard rivers={rivers} rows={riverRows} now={now} onRiver={onRiver} />
      )}
      {canals && <CanalCard outlook={canals} now={now} onCanal={onCanal} />}
      {!!water?.bank_observations?.length && (
        <section
          className="panel-section"
          aria-labelledby="bank-heading"
          data-testid="bank-evidence"
        >
          <h2 id="bank-heading">
            <Waves size={18} /> ระดับน้ำเทียบตลิ่ง
          </h2>
          <p className="quiet">
            แดง: เกินตลิ่ง · ส้ม: ถึงตลิ่ง · ฟ้า: ต่ำกว่าตลิ่ง · เทา: ยังยืนยันไม่ได้
          </p>
          <p className="quiet">
            จุดแสดงเฉพาะที่วัด เส้นแสดงช่วงที่ต้นทางรายงาน ไม่ใช่ขอบเขตพื้นที่ท่วม
          </p>
          <ul className="flood-list">
            {water.bank_observations.map((item) => {
              const state = bankState(item, now);
              const source = safeLink(item.source_url);
              return (
                <li key={item.id}>
                  <button className="road-button" onClick={() => onBank(item)}>
                    <span className="flood-line">
                      <strong>{item.name_th}</strong>
                      <span>
                        <span
                          className="bank-dot"
                          style={{ background: BANK_COLORS[state.status] }}
                        />{' '}
                        {state.text}
                      </span>
                      <small>
                        {item.observed_at
                          ? `ข้อมูล ${situationTimeLabel(item.observed_at)}`
                          : 'ไม่มีเวลาข้อมูล'}
                      </small>
                    </span>
                  </button>
                  <small className="source-note">
                    {item.kind === 'measurement' ? 'เทียบระดับเฉพาะจุด · ทดลอง · ' : ''}
                    ที่มา:{' '}
                    {source ? (
                      <a href={source} target="_blank" rel="noopener noreferrer">
                        {item.credit_th} ↗
                      </a>
                    ) : (
                      item.credit_th
                    )}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {/* no alert in effect, from a feed that can be trusted: the status bar says so and the card is not shown
          (user 2026-10-02); an old or missing feed keeps the card, which says it cannot tell */}
      {!(snapshot?.feed && trusted && alerts.length === 0) && (
        <section id="alerts" className="panel-section" aria-labelledby="alerts-heading">
          <h2
            id="alerts-heading"
            className={
              worst ? `heading-level-${worst}` : trusted ? 'heading-ok' : 'heading-unknown'
            }
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
      )}
      {flooding && <RoadFloodingToday flooding={flooding} now={now} onRoad={onRoadName} />}
      {news && situationWorthShowing(news.text_th, now) && <SituationCard news={news} now={now} />}
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
            bangkokDistrict(
              nearby?.place.label ?? (place ? `${place.title} ${place.detail}` : null),
            ),
          )
        : [],
    [flooding, nearAll, now, nearby, place],
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
  // each file has its own age: new canal levels must not hide that the rain beside them is a day old
  const rainOld = nearRain.length > 0 && rain ? oldNote(rain.fetched_at, now) : null;
  const waterOld = nearWater.length > 0 && water ? oldNote(water.fetched_at, now) : null;
  const bkkNotes =
    rainOld && waterOld && rainOld !== waterOld
      ? [`ฝน: ${rainOld}`, `ระดับน้ำ: ${waterOld}`]
      : [rainOld ?? waterOld].filter((text): text is string => !!text);
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

      {!favorite && (
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
                    <i
                      style={{
                        width: `${Math.min(100, ((day.rainMm ?? 0) / wettest) * 100)}%`,
                        background: DAY_RAIN_CLASSES[dayRainClass(day.rainMm) ?? 0].color,
                      }}
                    />
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
      )}

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
                ชั่วโมงล่าสุด{rainAmountWords(gauge.rain_1h_mm, 1)} · 24 ชม.{' '}
                {rainAmountWords(gauge.rain_24h_mm, 24)}
              </strong>
              <span>
                สถานี{gauge.name_th} ห่าง {distanceText(distance)} ·{' '}
                {measuredText(gauge.observed_at, now)}
                {gauge.observed_at && !isRecent(gauge.observed_at, now) && ' (ค่าเก่า)'}
              </span>
            </p>
          ))}
          {nearWater.length > 0 && (
            <ul className="road-list" data-testid="water-here">
              {nearWater.map(({ item: station, distance }) => (
                <li key={station.code} className="road-line">
                  <strong>
                    {station.name_th} · น้ำในคลอง{levelWords(station.level_in_m)}
                    {(() => {
                      // rising or falling since the reading before (user 2026-10-02)
                      const change = levelChange(station);
                      return change ? ` · ${levelChangeWords(change)}` : '';
                    })()}
                  </strong>
                  <span>
                    {station.canal_th ? `${station.canal_th} · ` : ''}ห่าง {distanceText(distance)}{' '}
                    · {measuredText(station.observed_at, now)}
                    {station.observed_at && !isRecent(station.observed_at, now) && ' (ค่าเก่า)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {bkkNotes.map((text) => (
            <p key={text} className="inline-warning">
              <Info size={15} /> {text}
            </p>
          ))}
          <small className="source-note">
            ที่มา: {shortCredit((water ?? rain)!.credit_th)} · ระดับน้ำเทียบระดับน้ำทะเล
            ไม่ใช่ความลึกน้ำท่วมบนถนน
            {nearWater.length > 0 &&
              ' · ยังบอกไม่ได้ว่าวิกฤตหรือใกล้ล้นตลิ่ง เพราะต้นทางไม่ได้ส่งระดับตลิ่งมา'}
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
              จับคู่จากชื่อถนนในรัศมี 2 กม. ในเขตเดียวกับหมุด จุดที่ท่วมจริงอาจอยู่ไกลจากหมุด
              ดูบริเวณในรายการ
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
