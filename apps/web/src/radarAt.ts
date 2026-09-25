import { useEffect, useState } from 'react';
import type { RadarFeed } from './data';
import { radarClass, radarPixel, type RadarLegendItem } from './geo';

export interface RadarReading {
  state: 'none' | 'loading' | 'ready' | 'outside' | 'error';
  item: RadarLegendItem | null;
  time: string | null;
}
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('radar frame unavailable'));
      image.src = url;
    });
    images.set(url, pending);
    if (images.size > 8) images.delete(images.keys().next().value!);
  }
  return pending;
}

/** Rain-rate class of the radar frame under a pin, read from one pixel. */
export function useRadarAt(
  radar: RadarFeed | null | undefined,
  base: string | null,
  pin: number[] | null,
  frameIndex: number,
): RadarReading {
  const frame = radar?.frames[frameIndex];
  const [reading, setReading] = useState<RadarReading>({ state: 'none', item: null, time: null });
  useEffect(() => {
    if (!radar || !frame || !base || !pin) {
      setReading({ state: 'none', item: null, time: null });
      return;
    }
    let cancelled = false;
    setReading({ state: 'loading', item: null, time: frame.time });
    loadImage(new URL(frame.path, base).href)
      .then((image) => {
        if (cancelled) return;
        const pixel = radarPixel(radar.coordinates, image.naturalWidth, image.naturalHeight, pin);
        if (!pixel) {
          setReading({ state: 'outside', item: null, time: frame.time });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('no 2d canvas');
        context.drawImage(image, pixel.x, pixel.y, 1, 1, 0, 0, 1, 1);
        const rgba = context.getImageData(0, 0, 1, 1).data;
        setReading({
          state: 'ready',
          item: radarClass(rgba, radar.legend, radar.legend_opacity),
          time: frame.time,
        });
      })
      .catch(() => {
        if (!cancelled) setReading({ state: 'error', item: null, time: frame.time });
      });
    return () => {
      cancelled = true;
    };
  }, [radar, frame, base, pin]);
  return reading;
}
