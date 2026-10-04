import { describe, expect, it } from 'vitest';
import { longdoWaterUrl } from './longdo';
import { safeLink } from './data';

describe('longdoWaterUrl', () => {
  it('opens Longdo Water at the place, coloured by the distance to the bank', () => {
    const url = longdoWaterUrl([100.5231234, 13.7563456]);
    expect(url).toBe('https://water.longdo.com/?lat=13.75635&lon=100.52312&zoom=15&mode=bank');
    expect(safeLink(url)).toBe(url);
  });
});
