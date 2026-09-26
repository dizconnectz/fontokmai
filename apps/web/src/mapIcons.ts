// Pins and cluster bubbles for the map, drawn on a canvas the first time MapLibre asks for them
// (styleimagemissing). No sprite file or font server is needed, and they come back by themselves
// after the basemap changes with the theme. Glyph shapes are lucide icons (ISC).

const RATIO = 2;

import { RAIN_HOUR_CLASSES, RAIN_OLD_COLOR } from './bkk';

// lucide "waves", "video", "droplet" and "cloud-rain", in their 24 × 24 box
const GLYPHS = {
  water: [
    'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  ],
  rain: [
    'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242',
    'M16 14v6',
    'M8 14v6',
    'M12 16v6',
  ],
  flood: [
    'M2 5q2.5 2 5 0t5 0 5 0 5 0',
    'M2 12q2.5 2 5 0t5 0 5 0 5 0',
    'M2 19q2.5 2 5 0t5 0 5 0 5 0',
  ],
  camera: [
    'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5',
    'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  ],
};
type Kind = keyof typeof GLYPHS;

/** pin image name → kind and colour; "ended" and "approx" are the paler versions */
const PINS: Record<string, { kind: Kind; color: string }> = {
  'pin-flood': { kind: 'flood', color: '#1565c0' },
  'pin-flood-ended': { kind: 'flood', color: '#86a9d4' },
  'pin-camera': { kind: 'camera', color: '#37474f' },
  'pin-camera-approx': { kind: 'camera', color: '#90a4ae' },
  'pin-water': { kind: 'water', color: '#00838f' },
  'pin-water-old': { kind: 'water', color: '#90a4ae' },
  'pin-rain-old': { kind: 'rain', color: RAIN_OLD_COLOR },
  ...Object.fromEntries(
    RAIN_HOUR_CLASSES.map((item) => [item.pin, { kind: 'rain' as const, color: item.color }]),
  ),
};
export const CLUSTER_COLOR: Record<Kind, string> = {
  flood: '#1565c0',
  camera: '#37474f',
  water: '#00838f',
  rain: '#1e6fd9',
};

export interface MapImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width * RATIO;
  element.height = height * RATIO;
  const context = element.getContext('2d');
  context?.scale(RATIO, RATIO);
  return context;
}

function image(context: CanvasRenderingContext2D): MapImage {
  const { width, height } = context.canvas;
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** A teardrop pin, 28 × 37 CSS px, tip at the bottom centre, with a white glyph in the head. */
function pin(kind: Kind, color: string): MapImage | null {
  const width = 28;
  const height = 37;
  const context = canvas(width, height);
  if (!context) return null;
  const cx = width / 2;
  const cy = 13;
  const r = 11.5;
  const tip = height - 2;
  // the sides are tangent to the head circle
  const theta = Math.acos(r / (tip - cy));
  context.beginPath();
  context.moveTo(cx, tip);
  context.arc(cx, cy, r, Math.PI / 2 + theta, Math.PI / 2 - theta);
  context.closePath();
  context.shadowColor = 'rgb(0 0 0 / 35%)';
  context.shadowBlur = 2;
  context.shadowOffsetY = 1;
  context.fillStyle = color;
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.strokeStyle = '#ffffff';
  context.stroke();
  const size = 14;
  context.translate(cx - size / 2, cy - size / 2);
  context.scale(size / 24, size / 24);
  context.lineWidth = 2.6;
  context.lineCap = 'round';
  for (const d of GLYPHS[kind]) context.stroke(new Path2D(d));
  return image(context);
}

/** A round bubble with the number of reports or cameras close together. */
function cluster(kind: Kind, label: string): MapImage | null {
  const count = parseFloat(label) * (label.endsWith('k') ? 1000 : 1);
  const r = count < 10 ? 13 : count < 100 ? 16 : 19;
  const size = 2 * r + 10;
  const context = canvas(size, size);
  if (!context) return null;
  const c = size / 2;
  context.fillStyle = CLUSTER_COLOR[kind];
  context.globalAlpha = 0.28;
  context.beginPath();
  context.arc(c, c, r + 4.5, 0, 2 * Math.PI);
  context.fill();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(c, c, r, 0, 2 * Math.PI);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#ffffff';
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = `700 ${count < 100 ? 13 : 12}px 'Noto Sans Thai', Tahoma, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, c, c + 0.5);
  return image(context);
}

/** Picture for a name used by our map layers, or null for names that are not ours. */
export function mapImage(name: string): MapImage | null {
  const found = PINS[name];
  if (found) return pin(found.kind, found.color);
  const match = /^cluster-(flood|camera|water|rain)-(.+)$/.exec(name);
  return match ? cluster(match[1] as Kind, match[2]) : null;
}
export const MAP_IMAGE_RATIO = RATIO;
