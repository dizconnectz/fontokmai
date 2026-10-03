import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';

/**
 * What each source of a map last got, as a signature (Codex M42): the clock ticks every 15 seconds for the words of
 * age, and a tick that changes nothing drawn sends nothing to the map's worker (no new tiles, bubbles or labels).
 * Made empty again when the style, and so every source, is made again.
 */
const sent = new WeakMap<object, Map<string, string>>();

export function resetSent(instance: object): void {
  sent.set(instance, new Map());
}

/**
 * setData of a source when what it shows changed; true when it was sent. The signature is the data itself, or for
 * large shapes (the alert zones) something smaller that changes with them.
 */
export function send(
  instance: Pick<LibreMap, 'getSource'>,
  source: string,
  data: FeatureCollection,
  signature: string = JSON.stringify(data),
): boolean {
  const target = instance.getSource(source) as GeoJSONSource | undefined;
  if (!target) return false;
  let last = sent.get(instance);
  if (!last) {
    last = new Map();
    sent.set(instance, last);
  }
  if (last.get(source) === signature) return false;
  last.set(source, signature);
  target.setData(data);
  return true;
}
