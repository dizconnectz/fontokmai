/** Extract only explicit observations; never use a fetch/edit time as the report time. */
const MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
const REPORT_OLD_MS = 60 * 60_000;
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });

export function situationTime(text: string): string | null {
  const normalized = text.replace(/[๐-๙]/g, (n) => String(n.charCodeAt(0) - 0x0e50));
  const matches = [
    ...normalized.matchAll(
      new RegExp(
        `วันที่\\s*(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\s+เวลา\\s*(\\d{1,2})[.:](\\d{2})\\s*น`,
        'g',
      ),
    ),
  ];
  // A bulletin with several dated observations needs a richer parser, not an arbitrary first time.
  if (matches.length !== 1) return null;
  const [, dayText, monthText, yearText, hourText, minuteText] = matches[0];
  const day = Number(dayText),
    month = MONTHS.indexOf(monthText),
    year = Number(yearText) - 543;
  const hour = Number(hourText),
    minute = Number(minuteText);
  if (year < 2000 || hour > 23 || minute > 59) return null;
  const local = new Date(Date.UTC(year, month, day, hour, minute));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month ||
    local.getUTCDate() !== day
  )
    return null;
  return new Date(local.getTime() - 7 * 3_600_000).toISOString();
}

export function situationSummary(text: string, now: number) {
  const time = situationTime(text);
  const warning = !time
    ? 'ยังระบุเวลารายงานไม่ได้ · อ่านข้อความต้นฉบับประกอบ'
    : Date.parse(time) > now
      ? 'เวลารายงานอยู่ในอนาคต · ยังยืนยันสถานการณ์ไม่ได้'
      : now - Date.parse(time) > REPORT_OLD_MS
        ? 'รายงานย้อนหลัง · สภาพฝนอาจเปลี่ยนแล้ว'
        : null;
  const rain = text
    .split(/[\n/]+/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        /ฝน/.test(part) && !/อุณหภูมิ|ความชื้น|คาด|พยากรณ์|แนวโน้ม|พรุ่งนี้|จะมี|จะตก/.test(part),
    )
    .map((part) => part.replace(/^วันที่.*?เวลา\s*\d{1,2}[.:]\d{2}\s*น\.?\s*/, '').trim())
    .map((part) =>
      /^พื้นที่\s*กทม\.\s*ไม่พบกลุ่มฝน$/.test(part) ? 'ไม่พบกลุ่มฝนในพื้นที่ กทม.' : part,
    )
    .filter(Boolean);
  return { time, warning, rain };
}

/**
 * The card has something to say (user 2026-10-02: a card without data is not shown): a report of today, not ahead
 * of the clock, that names rain. "ไม่พบกลุ่มฝน" is no rain; a report without a readable time is not shown either.
 */
export function situationWorthShowing(text: string, now: number): boolean {
  const { time, rain } = situationSummary(text, now);
  if (!time || Date.parse(time) > now || DAY.format(Date.parse(time)) !== DAY.format(now))
    return false;
  return rain.some((line) => !/ไม่พบกลุ่มฝน/.test(line));
}

export function situationTimeLabel(time: string): string {
  return (
    new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(time)) + ' น.'
  );
}
