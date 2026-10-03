import { describe, expect, it } from 'vitest';
import example from '../../../contracts/v1/examples/outlook/outlook.json';
import { dayOutlook, outlookDays, type RainOutlook } from './outlook';

const data = example as unknown as RainOutlook;
function point() {
  return structuredClone(data.points[0]);
}

describe('daily rain ensemble', () => {
  it('weights models equally despite their different member counts', () => {
    const p = point();
    p.models[0].members.forEach((m) => m.rain_mm.fill(100));
    p.models[1].members.forEach((m) => m.rain_mm.fill(0));
    const stats = dayOutlook(p, 0)!;
    expect(stats.heavy).toBe(50); // pooling 51 + 31 would incorrectly give 62%
    expect(stats.veryHeavy).toBe(50);
    expect([stats.p10, stats.median, stats.p90]).toEqual([0, 0, 100]);
    expect(stats.partial).toBe(false);
  });
  it('uses exact heavy-rain thresholds and preserves known zero', () => {
    const p = point();
    p.models.forEach((m) => m.members.forEach((member) => member.rain_mm.fill(35.1)));
    expect(dayOutlook(p, 0)?.heavy).toBe(100);
    expect(dayOutlook(p, 0)?.veryHeavy).toBe(0);
    p.models.forEach((m) => m.members.forEach((member) => member.rain_mm.fill(0)));
    expect(dayOutlook(p, 0)?.p90).toBe(0);
  });
  it('needs 80% of each model and never converts missing to zero', () => {
    const p = point();
    p.models[0].members.slice(40).forEach((m) => m.rain_mm.fill(null));
    p.models[1].members.forEach((m) => m.rain_mm.fill(40));
    expect(dayOutlook(p, 0)?.models).toEqual(['gfs05']);
    expect(dayOutlook(p, 0)?.partial).toBe(true);
    p.models[1].members.slice(24).forEach((m) => m.rain_mm.fill(null));
    expect(dayOutlook(p, 0)).toBeNull();
    expect(dayOutlook(p, 20)).toBeNull();
  });
  it('removes past dates at the Thai midnight rather than the viewer timezone', () => {
    expect(outlookDays(data, data.points[0], Date.parse('2026-09-25T16:59:00Z'))).toHaveLength(14);
    const after = outlookDays(data, data.points[0], Date.parse('2026-09-25T17:00:00Z'));
    expect(after).toHaveLength(13);
    expect(after[0].date).toBe('2026-09-27');
    expect(after[0].index).toBe(1);
  });
});
