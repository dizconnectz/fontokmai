import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  CircleHelp,
  CloudRain,
  Droplets,
  ExternalLink,
  Info,
  Layers,
  List,
  Map as MapIcon,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Waves,
  X,
} from 'lucide-react';
import {
  displayStatus,
  formatTime,
  isStale,
  safeLink,
  staleAfter,
  visibleAlerts,
  type Alert,
} from './data';
import { useData } from './useData';
import MapBoundary from './MapBoundary';

const AlertMap = lazy(() => import('./AlertMap'));
const modes = [
  { id: 'official', label: 'น้ำและประกาศ', Icon: ShieldCheck },
  { id: 'rain', label: 'ฝนล่าสุด', Icon: CloudRain },
  { id: 'forecast', label: 'พยากรณ์ 7 วัน', Icon: Layers },
  { id: 'flood', label: 'น้ำท่วมพื้นที่นำร่อง', Icon: Waves },
] as const;
type Mode = (typeof modes)[number]['id'];
const disclaimer = 'fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา';

function initialBookmarks(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('fontokmai:alerts:v1') ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((x): x is string => typeof x === 'string').slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
function StatusPill({ alert, now }: { alert: Alert; now: number }) {
  const pending = displayStatus(alert, now) === 'pending';
  return (
    <span className={`pill ${pending ? 'pending' : 'official'}`}>
      <span className="status-dot" />
      {pending ? 'เริ่มมีผลภายหลัง' : 'มีผลตามเวลาประกาศ'}
    </span>
  );
}
function AlertDetails({ alert, now, onClose }: { alert: Alert; now: number; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [alert.event_id]);
  const url = safeLink(alert.source_url);
  return (
    <section className="alert-detail" aria-label="รายละเอียดประกาศ" data-testid="alert-detail">
      <div className="detail-top">
        <span className="eyebrow">
          <ShieldCheck size={15} /> ประกาศทางการ
        </span>
        <button className="icon-button" aria-label="ปิดรายละเอียดประกาศ" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {alert.headline_th ?? alert.event}
      </h2>
      <StatusPill alert={alert} now={now} />
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
      <h3>พื้นที่ตามประกาศ</h3>
      <p>{alert.area_desc_th ?? 'ต้นฉบับไม่ได้ระบุชื่อพื้นที่'}</p>
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
        <>
          <h3>คำแนะนำจากกรมอุตุนิยมวิทยา</h3>
          <p className="preserve-lines">{alert.instruction_th}</p>
        </>
      )}
      <div className="detail-source">
        <span>
          ที่มา: {alert.credit_th}
          <br />
          ออกประกาศ {formatTime(alert.sent)} น.
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

export default function App() {
  const { snapshot, config, error, loading, now, refresh } = useData();
  const [mode, setMode] = useState<Mode>('official');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [storageError, setStorageError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('alert'),
  );
  const alerts = useMemo(() => visibleAlerts(snapshot?.feed, now), [snapshot, now]);
  const selected = alerts.find((a) => a.event_id === selectedId);
  const filtered = useMemo(
    () =>
      alerts.filter((alert) => {
        const text = [
          alert.headline_th,
          alert.area_desc_th,
          alert.event,
          ...alert.targets.map((t) => t.code),
        ]
          .join(' ')
          .toLocaleLowerCase('th');
        return (
          text.includes(query.trim().toLocaleLowerCase('th')) &&
          (!savedOnly || bookmarks.includes(alert.event_id))
        );
      }),
    [alerts, query, savedOnly, bookmarks],
  );
  const stale = snapshot ? isStale(snapshot.manifest, now) : false;
  const partial =
    snapshot?.manifest.completeness === 'partial' ||
    snapshot?.manifest.source_status.some((s) => s.status !== 'ok');
  const isExample = config?.DATA_MODE === 'example' || snapshot?.manifest.writer === 'example';
  const activeCount = alerts.filter((a) => displayStatus(a, now) === 'active').length;
  const pendingCount = alerts.length - activeCount;
  const selectAlert = (id: string | null) => {
    setSelectedId(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set('alert', id);
    else url.searchParams.delete('alert');
    history.replaceState(null, '', url);
  };
  const bookmark = (id: string) => {
    const next = bookmarks.includes(id)
      ? bookmarks.filter((x) => x !== id)
      : [...bookmarks, id].slice(-100);
    setBookmarks(next);
    try {
      localStorage.setItem('fontokmai:alerts:v1', JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  return (
    <>
      <a href="#main" className="skip-link">
        ข้ามไปเนื้อหาหลัก
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/">
            <span className="brand-symbol">
              <Droplets size={26} strokeWidth={1.8} />
            </span>
            <span>
              <strong>
                ฝนตกไหม<span className="brand-dot">.</span>
              </strong>
              <small>fontokmai</small>
            </span>
          </a>
          <nav aria-label="เมนูหลัก">
            <a href="/" aria-current="page">
              ภาพรวม
            </a>
            <a href="#data-status">สถานะข้อมูล</a>
            <a href="/sources/">
              แหล่งข้อมูล <ArrowUpRight size={13} />
            </a>
          </nav>
          <a className="about-link" href="/method/">
            <CircleHelp size={18} />
            <span>อ่านแผนที่อย่างไร</span>
          </a>
        </div>
      </header>

      <main id="main" className="page-shell">
        <section className="page-heading">
          <div>
            <p className="eyebrow">
              <span className="teal-dot" /> ประเทศไทย · เฝ้าติดตามอากาศ
            </p>
            <h1>
              มองฟ้า รู้ทันสถานการณ์<span>.</span>
            </h1>
            <p className="heading-description">ประกาศทางการในที่เดียว พร้อมพื้นที่และเวลาที่มีผล</p>
          </div>
          <div className="heading-note">
            <ShieldCheck size={22} />
            <span>
              เริ่มจากข้อมูลที่ตรวจสอบที่มาได้<small>ฟรีสำหรับทุกคน · กำลังพัฒนา P0</small>
            </span>
          </div>
        </section>

        {isExample && (
          <div className="example-banner" role="note">
            <Info size={18} />
            <div>
              <strong>กำลังแสดงชุดข้อมูลตัวอย่าง</strong>
              <span>ประกาศชุดวันที่ 25–26 ก.ย. 2569 สำหรับทดสอบเว็บ ไม่ใช่สถานการณ์ปัจจุบัน</span>
            </div>
            <span className="example-tag">รุ่นทดสอบ</span>
          </div>
        )}
        {!config && !error && (
          <p className="notice" role="status">
            กำลังอ่านการตั้งค่าแหล่งข้อมูล…
          </p>
        )}
        {error && (
          <div className="notice warning" role="status">
            <Info size={18} />
            <div>
              <strong>
                {error.code === 'mixed' ? 'กำลังอัปเดต · ไฟล์ข้อมูลยังไม่ตรงกัน' : error.message}
              </strong>
              <span>
                {snapshot
                  ? 'แสดงชุดข้อมูลล่าสุดที่โหลดครบ กรุณาตรวจเวลาข้อมูล'
                  : 'ยังไม่มีชุดข้อมูลที่ตรวจสอบครบ จึงยังแสดงประกาศไม่ได้'}
              </span>
            </div>
          </div>
        )}
        {stale && (
          <div className="notice warning" role="status">
            <RefreshCw size={17} />
            <div>
              <strong>
                ข้อมูลไม่อัปเดต ตั้งแต่ {formatTime(staleAfter(snapshot!.manifest))} น.
              </strong>
              <span>สถานะประกาศอาจเปลี่ยนแล้ว โปรดตรวจสอบกับกรมอุตุนิยมวิทยา</span>
            </div>
          </div>
        )}
        {partial && (
          <div className="notice warning" role="status">
            <Info size={17} />
            <div>
              <strong>แหล่งข้อมูลส่งข้อมูลไม่ครบ</strong>
              <span>กำลังแสดงประกาศที่เก็บไว้ พร้อมเวลาที่ดึงสำเร็จครั้งล่าสุดด้านล่าง</span>
            </div>
          </div>
        )}

        <section className="summary-grid" aria-label="ภาพรวมข้อมูล">
          <div className="summary-item primary-summary">
            <span className="summary-icon">
              <ShieldCheck size={22} />
            </span>
            <div>
              <span className="summary-label">ประกาศทางการในชุดข้อมูล</span>
              <p>
                <strong>{snapshot?.feed ? activeCount : '—'}</strong>
                <span>
                  {snapshot?.feed
                    ? `มีผลตามเวลา${pendingCount ? ` · รอเริ่ม ${pendingCount}` : ''}`
                    : 'ยังไม่มีข้อมูล'}
                </span>
              </p>
            </div>
          </div>
          <div className="summary-item">
            <CloudRain size={22} />
            <div>
              <span className="summary-label">ปริมาณฝน / พยากรณ์</span>
              <p className="missing-value">ยังไม่มีข้อมูล</p>
            </div>
          </div>
          <div className="summary-item">
            <Waves size={22} />
            <div>
              <span className="summary-label">น้ำท่วม / ระดับน้ำ / เขื่อน</span>
              <p className="missing-value">ยังไม่มีข้อมูล</p>
            </div>
          </div>
          <div className="summary-item update-summary">
            <Radio size={20} />
            <div>
              <span className="summary-label">ชุดข้อมูลเผยแพร่เมื่อ</span>
              <p>
                {snapshot ? `${formatTime(snapshot.manifest.generated_at)} น.` : 'ยังไม่มีข้อมูล'}
              </p>
            </div>
            <button
              className={`icon-button ${loading ? 'is-loading' : ''}`}
              disabled={loading}
              onClick={() => void refresh()}
              aria-label="ตรวจข้อมูลอีกครั้ง"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </section>

        <div className="workspace-toolbar">
          <div className="mode-switch" role="group" aria-label="ชั้นข้อมูล">
            {modes.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-pressed={mode === id}
                className={mode === id ? 'selected' : ''}
                onClick={() => setMode(id)}
              >
                <Icon size={17} />
                {label}
                {id === 'flood' && <span className="tiny-tag">นำร่อง</span>}
              </button>
            ))}
          </div>
          <div className="view-switch" role="group" aria-label="มุมมอง">
            <button
              aria-pressed={view === 'map'}
              aria-label="มุมมองแผนที่"
              onClick={() => setView('map')}
            >
              <MapIcon size={17} />
              <span>แผนที่</span>
            </button>
            <button
              aria-pressed={view === 'list'}
              aria-label="มุมมองรายการ"
              onClick={() => setView('list')}
            >
              <List size={17} />
              <span>รายการ</span>
            </button>
          </div>
        </div>

        <section
          className={`workspace ${view === 'list' ? 'list-view' : ''}`}
          aria-label="ประกาศและแผนที่"
        >
          <aside className="alerts-panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">จากกรมอุตุนิยมวิทยา</span>
                <h2>
                  ประกาศทางการ <span>{snapshot?.feed ? alerts.length : '—'}</span>
                </h2>
              </div>
              <ShieldCheck size={23} />
            </div>
            <label className="search-box">
              <Search size={19} />
              <span className="sr-only">ค้นหาจังหวัดหรือประกาศ</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ค้นหาจังหวัดหรือประกาศ…"
              />
            </label>
            <p className="search-hint">ค้นหาจากข้อความประกาศ · ยังไม่รองรับรายตำบล</p>
            <div className="filter-row">
              <button
                className={!savedOnly ? 'active-filter' : ''}
                aria-pressed={!savedOnly}
                onClick={() => setSavedOnly(false)}
              >
                ทั้งหมด
              </button>
              <button
                className={savedOnly ? 'active-filter' : ''}
                aria-pressed={savedOnly}
                onClick={() => setSavedOnly(true)}
              >
                <Bookmark size={14} /> บันทึกไว้
              </button>
              <span>{filtered.length} รายการ</span>
            </div>
            {storageError && (
              <p role="status" className="inline-warning">
                บันทึกได้เฉพาะแท็บนี้ เบราว์เซอร์ไม่อนุญาตให้เก็บในเครื่อง
              </p>
            )}
            <div className="alert-list" aria-live="polite" aria-busy={loading && !snapshot}>
              {!snapshot && loading && (
                <div className="empty-list">
                  <RefreshCw size={26} />
                  <p>กำลังโหลดประกาศ…</p>
                </div>
              )}
              {!(loading && !snapshot) && filtered.length === 0 && (
                <div className="empty-list">
                  <ShieldCheck size={30} />
                  <h3>
                    {!snapshot?.feed
                      ? 'ยังไม่มีข้อมูลประกาศ'
                      : savedOnly
                        ? 'ยังไม่มีประกาศที่บันทึกไว้ในรายการนี้'
                        : query
                          ? 'ไม่พบประกาศที่ตรงกับคำค้น'
                          : 'ไม่พบประกาศที่มีผลในชุดนี้'}
                  </h3>
                  <p>ไม่มีข้อมูลหรือไม่พบประกาศ ไม่ได้แปลว่าพื้นที่ปลอดภัย</p>
                  {(query || savedOnly) && (
                    <button
                      className="text-link"
                      onClick={() => {
                        setQuery('');
                        setSavedOnly(false);
                      }}
                    >
                      ดูประกาศทั้งหมด <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              )}
              {filtered.map((alert) => (
                <article
                  key={alert.event_id}
                  className={`alert-card ${selectedId === alert.event_id ? 'is-selected' : ''}`}
                  data-testid="alert-card"
                >
                  <div className="card-top">
                    <StatusPill alert={alert} now={now} />
                    <button
                      className={`icon-button bookmark ${bookmarks.includes(alert.event_id) ? 'is-saved' : ''}`}
                      aria-label={`${bookmarks.includes(alert.event_id) ? 'เลิกบันทึก' : 'บันทึก'}ประกาศ ${alert.source_message_id}`}
                      aria-pressed={bookmarks.includes(alert.event_id)}
                      onClick={() => bookmark(alert.event_id)}
                    >
                      <Bookmark
                        size={18}
                        fill={bookmarks.includes(alert.event_id) ? 'currentColor' : 'none'}
                      />
                    </button>
                  </div>
                  <button
                    className="alert-select"
                    onClick={() => selectAlert(alert.event_id)}
                    aria-pressed={selectedId === alert.event_id}
                  >
                    <h3>{alert.headline_th ?? alert.event}</h3>
                    <p className="area-preview">{alert.area_desc_th ?? 'ไม่ระบุพื้นที่'}</p>
                    <span className="card-cta">
                      ดูพื้นที่และรายละเอียด <ArrowUpRight size={16} />
                    </span>
                  </button>
                  <div className="card-meta">
                    <span>ที่มา: {alert.credit_th}</span>
                    <span>ออกประกาศ {formatTime(alert.sent)} น.</span>
                  </div>
                  {alert.expires_policy === 'default_24h' && (
                    <span className="expiry-note">
                      <Info size={13} /> เวลาสิ้นสุดเป็นค่าประมาณ
                    </span>
                  )}
                  {safeLink(alert.source_url) && (
                    <a
                      className="original-link"
                      href={safeLink(alert.source_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ต้นฉบับ <ExternalLink size={12} />
                    </a>
                  )}
                </article>
              ))}
            </div>
            <div className="panel-foot">
              <Info size={15} />
              <span>
                บันทึกประกาศในเครื่องนี้ได้
                <br />
                ยังไม่มีการส่งแจ้งเตือน
              </span>
            </div>
          </aside>
          <div className="map-panel">
            <div className="map-title">
              <div>
                <span className="teal-dot" />
                <strong>
                  {mode === 'official'
                    ? 'ขอบเขตประกาศทางการ'
                    : modes.find((item) => item.id === mode)?.label}
                </strong>
              </div>
              <span>{mode === 'official' ? 'กรมอุตุนิยมวิทยา · CAP' : 'ยังไม่มีข้อมูล'}</span>
            </div>
            {view === 'map' ? (
              <div className="map-wrap">
                <MapBoundary onList={() => setView('list')}>
                  <Suspense fallback={<div className="map-loading">กำลังเตรียมแผนที่…</div>}>
                    <AlertMap
                      alerts={mode === 'official' ? filtered : []}
                      selectedId={selectedId}
                      now={now}
                      onSelect={selectAlert}
                      onList={() => setView('list')}
                    />
                  </Suspense>
                </MapBoundary>
                {mode !== 'official' && (
                  <div className="unavailable-layer">
                    <span className="empty-icon">
                      <CloudRain size={28} />
                    </span>
                    <h2>ยังไม่มีข้อมูล</h2>
                    <p>
                      {mode === 'flood'
                        ? 'ข้อมูลติดตามและคาดโซนน้ำท่วม กทม.–ปริมณฑล รวมรังสิตและคลองหลวง ยังไม่พร้อมแสดง'
                        : 'ชุดข้อมูลปัจจุบันมีเฉพาะประกาศทางการ ยังไม่มีข้อมูลฝนตรวจวัดหรือพยากรณ์'}
                    </p>
                    <button className="primary-button" onClick={() => setMode('official')}>
                      ดูประกาศทางการ <ArrowUpRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="list-explainer">
                <List size={27} />
                <h2>อ่านประกาศได้โดยไม่ใช้แผนที่</h2>
                <p>เลือกประกาศเพื่อดูพื้นที่และช่วงเวลาที่มีผล</p>
                {mode !== 'official' && (
                  <p className="inline-warning">
                    {modes.find((item) => item.id === mode)?.label}: ยังไม่มีข้อมูล
                  </p>
                )}
              </div>
            )}
            {selected ? (
              <AlertDetails alert={selected} now={now} onClose={() => selectAlert(null)} />
            ) : selectedId ? (
              <div className="detail-placeholder">
                <Info size={20} />
                <span>
                  ประกาศจากลิงก์นี้ไม่มีในรายการที่มีผล อาจสิ้นสุด ถูกยกเลิก
                  หรือไม่อยู่ในชุดข้อมูลนี้
                </span>
                <button className="text-link" onClick={() => selectAlert(null)}>
                  ปิด
                </button>
              </div>
            ) : (
              <div className="detail-placeholder">
                <MapIcon size={21} />
                <span>เลือกพื้นที่บนแผนที่ หรือเลือกประกาศเพื่ออ่านรายละเอียด</span>
                <ChevronRight size={17} />
              </div>
            )}
          </div>
        </section>

        <section className="below-map">
          <div className="reading-note">
            <span className="note-icon">
              <CircleHelp size={22} />
            </span>
            <div>
              <h2>สีบนแผนที่บอกอะไร?</h2>
              <p>พื้นที่สีคือขอบเขตตามประกาศกรมอุตุฯ ไม่ใช่ฝนที่กำลังตกหรือพื้นที่ตรวจพบน้ำท่วม</p>
              <a className="text-link" href="/method/">
                วิธีอ่านข้อมูลและข้อจำกัด <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
          <div className="coming-note">
            <Waves size={24} />
            <div>
              <h2>เริ่มที่กรุงเทพฯ และปริมณฑล</h2>
              <p>ข้อมูลฝน น้ำในคลอง เขื่อน CCTV และข่าวจะเพิ่มตามความพร้อมของแหล่งข้อมูล</p>
              <span className="quiet-badge">ฟีเจอร์เหล่านี้ยังไม่มีข้อมูล</span>
            </div>
          </div>
        </section>

        <section id="data-status" className="data-status" aria-labelledby="data-status-heading">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ตรวจสอบที่มาได้</span>
              <h2 id="data-status-heading">สถานะข้อมูล</h2>
            </div>
            <span className={`health-label ${stale || partial || error ? 'needs-attention' : ''}`}>
              <span className="status-dot" />
              {!snapshot
                ? 'ยังไม่มีข้อมูล'
                : stale
                  ? 'ข้อมูลไม่อัปเดต'
                  : partial
                    ? 'ข้อมูลบางส่วนไม่ครบ'
                    : error
                      ? 'รอตรวจสอบชุดใหม่'
                      : isExample
                        ? 'ชุดตัวอย่างโหลดครบ'
                        : 'ชุดข้อมูลโหลดครบ'}
            </span>
          </div>
          <div className="source-row">
            <div className="source-logo">
              <Radio size={23} />
            </div>
            <div className="source-name">
              <strong>กรมอุตุนิยมวิทยา</strong>
              <span>ประกาศทางการ · CAP 1.2</span>
            </div>
            <div className="source-times">
              {snapshot?.manifest.source_status.map((source) => (
                <div key={source.source_id}>
                  <span>
                    {source.source_id}:{' '}
                    {source.status === 'ok'
                      ? 'ดึงสำเร็จในรอบข้อมูลนี้'
                      : source.status === 'degraded'
                        ? 'ดึงได้บางฉบับ'
                        : 'ดึงข้อมูลไม่สำเร็จ'}
                  </span>
                  <small>
                    สำเร็จล่าสุด {formatTime(source.last_success_at)}
                    {source.last_success_at ? ' น.' : ''}
                  </small>
                </div>
              )) ?? <span>ยังไม่มีข้อมูล</span>}
            </div>
            <a
              className="text-link"
              href="https://www.tmd.go.th/api/xml/CAP"
              target="_blank"
              rel="noopener noreferrer"
            >
              แหล่งต้นทาง <ArrowUpRight size={17} />
            </a>
          </div>
          <p className="status-footnote">
            <Check size={14} /> เว็บตรวจชุดข้อมูลทุก 1 นาทีเมื่อเปิดแท็บ ·
            ความครบของไฟล์ไม่ใช่การรับรองความแม่นของพยากรณ์ · เวลาไทย (UTC+7)
          </p>
          {snapshot?.feed && (
            <details className="history-details">
              <summary>ประกาศที่สิ้นสุดในชุดข้อมูล ({snapshot.feed.tombstones.length})</summary>
              <p>
                รายการสิ้นสุดจากต้นทาง ไม่แสดงเป็นประกาศที่มีผล · ตั้งแต่{' '}
                {formatTime(snapshot.feed.history_since)} น.
              </p>
              <ul>
                {snapshot.feed.tombstones.map((item) => (
                  <li key={item.event_id}>
                    <code>{item.event_id}</code>
                    <span>
                      {item.lifecycle_status === 'cancelled' ? 'ยกเลิก' : 'หมดอายุ'} ·{' '}
                      {formatTime(item.ended_at)} น.
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <span className="footer-brand">
            <Droplets size={18} /> fontokmai by Takuma
          </span>
          <p>{disclaimer}</p>
        </div>
        <div>
          <a href="/sources/">แหล่งข้อมูล</a>
          <a href="/method/">วิธีอ่านข้อมูล</a>
          <a href="/LICENSE">
            License <ArrowDownToLine size={12} />
          </a>
          <a href="/NOTICE">เครดิต</a>
        </div>
      </footer>
    </>
  );
}
