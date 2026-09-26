// One saved place ("ที่ของฉัน"), kept only in this browser: no account, nothing sent anywhere.
const KEY = 'fontokmai.favorite.v1';

export interface Favorite {
  location: [number, number];
  label: string;
}

function valid(value: unknown): value is Favorite {
  const favorite = value as Favorite | null;
  return (
    !!favorite &&
    Array.isArray(favorite.location) &&
    favorite.location.length === 2 &&
    Math.abs(favorite.location[0]) <= 180 &&
    Math.abs(favorite.location[1]) <= 90 &&
    typeof favorite.label === 'string' &&
    favorite.label.length <= 120
  );
}

export function loadFavorite(): Favorite | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveFavorite(favorite: Favorite | null): void {
  try {
    if (favorite) localStorage.setItem(KEY, JSON.stringify(favorite));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode or storage blocked: the place simply is not remembered
  }
}
