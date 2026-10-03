import { describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { resetSent, send } from './mapSources';

function fakeMap(sources: string[]) {
  const setData = vi.fn();
  const instance = {
    getSource: (id: string) => (sources.includes(id) ? { setData } : undefined),
  } as unknown as Parameters<typeof send>[0];
  return { instance, setData };
}
const points = (n: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [100 + i, 13] },
    properties: { pin: 'pin-rain' },
  })),
});

describe('the map gets data only when what it draws changes (Codex M42)', () => {
  it('sends a source once for the same data, again when it changes or the style is made again', () => {
    const { instance, setData } = fakeMap(['rain']);
    expect(send(instance, 'rain', points(2))).toBe(true);
    // the clock ticked, nothing drawn changed: nothing is sent
    expect(send(instance, 'rain', points(2))).toBe(false);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(send(instance, 'rain', points(3))).toBe(true);
    resetSent(instance); // the basemap changed with the theme: every source is new and empty
    expect(send(instance, 'rain', points(3))).toBe(true);
    expect(setData).toHaveBeenCalledTimes(3);
  });

  it('compares large shapes by a signature of their own, and sends nothing to a source not there', () => {
    const { instance, setData } = fakeMap(['alerts']);
    expect(send(instance, 'alerts', points(1), 'e1:1:severe:active:false')).toBe(true);
    expect(send(instance, 'alerts', points(1), 'e1:1:severe:active:false')).toBe(false);
    // the same zone turns from pending to active: sent again
    expect(send(instance, 'alerts', points(1), 'e1:1:severe:ended:false')).toBe(true);
    expect(send(instance, 'missing', points(1))).toBe(false);
    expect(setData).toHaveBeenCalledTimes(2);
  });
});
