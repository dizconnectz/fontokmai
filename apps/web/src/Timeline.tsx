import { useEffect, useId } from 'react';
import { Pause, Play } from 'lucide-react';
import { hourRange, shortTime } from './alerts';

/** One position of the map timeline: a radar frame, the present without radar, or a forecast hour. */
export type TimeStep =
  | { kind: 'radar'; time: number; frame: number; latest: boolean }
  | { kind: 'now'; time: number }
  | { kind: 'forecast'; time: number; hour: number };

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const WEEKDAY = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  weekday: 'short',
  day: 'numeric',
});
const PLAY_MS = 700;

/** Plain words for a step, also read out by screen readers. */
export function stepLabel(step: TimeStep, now: number): string {
  if (step.kind === 'now') return 'ตอนนี้ · ยังไม่มีภาพเรดาร์';
  if (step.kind === 'radar')
    return `${step.latest ? 'ล่าสุด' : 'ย้อนหลัง'} · เรดาร์ ${shortTime(step.time, now)}`;
  return `พยากรณ์ · ${hourRange(step.time, now)}`;
}

export default function Timeline({
  steps,
  index,
  nowIndex,
  now,
  playing,
  forecastStale,
  onChange,
  onPlay,
}: {
  steps: TimeStep[];
  index: number;
  nowIndex: number;
  now: number;
  playing: boolean;
  /** the forecast file is older than it should be (shown on the bar in forecast mode) */
  forecastStale: boolean;
  onChange: (index: number) => void;
  onPlay: (playing: boolean) => void;
}) {
  const id = useId();
  const last = steps.length - 1;
  // play forward one step at a time and stop at the end
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      onPlay(false);
      return;
    }
    const timer = window.setTimeout(() => onChange(index + 1), PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, onChange, onPlay]);

  if (steps.length < 2) return null;
  const step = steps[index];
  const at = (i: number) => (last > 0 ? (i / last) * 100 : 0);
  // day marks where a new Thai calendar day starts among the forecast hours
  const marks = steps.flatMap((s, i) =>
    i > nowIndex && DAY.format(s.time - 1) !== DAY.format(steps[i - 1].time - 1)
      ? [{ i, text: WEEKDAY.format(s.time) }]
      : [],
  );
  const label = stepLabel(step, now);
  return (
    <div className={`timeline ${step.kind === 'forecast' ? 'is-forecast' : ''}`}>
      <button
        className="timeline-play"
        aria-label={playing ? 'หยุดเล่น' : 'เล่นต่อเนื่องไปข้างหน้า'}
        onClick={() => {
          if (!playing && index >= last) onChange(nowIndex);
          onPlay(!playing);
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="timeline-body">
        <div className="timeline-label">
          <span className={`pill ${step.kind === 'forecast' ? 'forecast' : 'observed'}`}>
            {step.kind === 'forecast' ? 'พยากรณ์' : 'สังเกตจริง'}
          </span>
          <strong aria-live="polite">{label.replace(/^[^·]*· /, '')}</strong>
          {index !== nowIndex && (
            <button
              className="timeline-now"
              aria-label="กลับมาตอนนี้"
              onClick={() => {
                onPlay(false);
                onChange(nowIndex);
              }}
            >
              ตอนนี้
            </button>
          )}
        </div>
        {step.kind === 'forecast' && (
          <p className="timeline-note">
            {forecastStale && <b className="stale-mark">พยากรณ์ไม่อัปเดต</b>}
            <span>ขอบเขตสีบนแผนที่: เฉพาะประกาศที่ออกแล้ว</span>
          </p>
        )}
        <div className="timeline-track" style={{ ['--now' as string]: `${at(nowIndex)}%` }}>
          <input
            id={`${id}-range`}
            type="range"
            aria-label="เลื่อนดูเวลาของแผนที่"
            min={0}
            max={last}
            step={1}
            value={index}
            aria-valuetext={label}
            onChange={(event) => {
              onPlay(false);
              onChange(Number(event.target.value));
            }}
          />
          <div className="timeline-marks" aria-hidden="true">
            <span style={{ left: `${at(nowIndex)}%` }} className="mark-now">
              ตอนนี้
            </span>
            {marks.map((mark) => (
              <span key={mark.i} style={{ left: `${at(mark.i)}%` }}>
                {mark.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
