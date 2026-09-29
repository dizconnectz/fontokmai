// Diversion dams (barrages) on the great rivers, which the department's large-dam list does not carry: they hold no
// reservoir, so they have no storage figure, and the release through them is not in any file this site may use
// (docs/sources.md). They are pins and lines that lead to the department's own page (user, 2026-09-29).
// Places from OpenStreetMap (© contributors, ODbL 1.0): way 80938821 (waterway=weir) and way 121342565 (waterway=dam).

export interface Barrage {
  id: string;
  name_th: string;
  river_th: string;
  place_th: string;
  location: [number, number];
  /** what to look for on the department's page */
  look_th: string;
}

/** The department's page of daily water levels and flows at its river stations */
export const BARRAGE_LINK = 'https://hyd-app-db.rid.go.th/hydro1d.html';
/**
 * ThaiWater's water chart of the Chao Phraya basin (HII): the flow below both barrages and the river levels against
 * their banks, drawn from several agencies. Link out only: no licence lets this site copy its figures and HII has no
 * API sign-up for the public (docs/sources.md, user 2026-09-29).
 */
export const BASIN_CHART_LINK = 'https://waterchart.thaiwater.net/basin/chaophraya';

export const BARRAGES: Barrage[] = [
  {
    id: 'barrage-chao-phraya',
    name_th: 'เขื่อนเจ้าพระยา',
    river_th: 'แม่น้ำเจ้าพระยา',
    place_th: 'จ.ชัยนาท',
    location: [100.17999, 15.15935],
    look_th: 'ดูน้ำที่ไหลผ่านท้ายเขื่อน (สถานี C.13)',
  },
  {
    id: 'barrage-rama-6',
    name_th: 'เขื่อนพระราม 6',
    river_th: 'แม่น้ำป่าสัก',
    place_th: 'อ.ท่าเรือ จ.พระนครศรีอยุธยา',
    location: [100.7614, 14.55862],
    look_th: 'ดูระดับน้ำและน้ำไหลของแม่น้ำป่าสัก',
  },
];
