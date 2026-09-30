import { toPL1992 } from '@/lib/geo2180';

/**
 * Siatka wysokości (NMT) w PL-1992. Wartości w Int16: (wysokość_m − zeroM) * scale, brak danych = NODATA16.
 * Wiersz 0 = północ, kolumna 0 = zachód; x0,y0 = środek komórki (0,0).
 */
export const NODATA16 = -32768;

export interface TerrainSheet {
  id: string;
  name: string;
  step: number; // rozdzielczość [m]
  ncols: number;
  nrows: number;
  zeroM: number;
  scale: number; // jednostek Int16 na metr (100 = cm, 10 = dm)
  x0: number;
  y0: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  data: Int16Array;
}

export type ManifestSheet = Omit<TerrainSheet, 'data'> & { file: string };

/** Wysokość n.p.m. [m] w punkcie PL-1992 albo null poza arkuszem / w dziurze bez danych. */
export function sheetHeight(t: TerrainSheet, x: number, y: number): number | null {
  const fx = (x - t.x0) / t.step;
  const fy = (t.y0 - y) / t.step;
  if (fx < 0 || fy < 0 || fx > t.ncols - 1 || fy > t.nrows - 1) return null;
  const ix = Math.min(Math.floor(fx), t.ncols - 2);
  const iy = Math.min(Math.floor(fy), t.nrows - 2);
  const tx = fx - ix;
  const ty = fy - iy;
  let sum = 0;
  let wsum = 0;
  const add = (c: number, r: number, w: number) => {
    const v = t.data[r * t.ncols + c];
    if (v !== NODATA16 && w > 0) {
      sum += v * w;
      wsum += w;
    }
  };
  add(ix, iy, (1 - tx) * (1 - ty));
  add(ix + 1, iy, tx * (1 - ty));
  add(ix, iy + 1, (1 - tx) * ty);
  add(ix + 1, iy + 1, tx * ty);
  if (wsum < 0.5) return null; // za mało danych wokół punktu
  return t.zeroM + sum / wsum / t.scale;
}

export function heightAtLatLng(t: TerrainSheet, lat: number, lng: number): number | null {
  const p = toPL1992(lat, lng);
  return sheetHeight(t, p.x, p.y);
}

// ---------------------------------------------------------------------------
// Rejestr arkuszy: gotowe (public/scene) + wgrane w przeglądarce
// ---------------------------------------------------------------------------

const sheets = new Map<string, TerrainSheet>();
const loading = new Map<string, Promise<TerrainSheet | null>>();
let manifestP: Promise<ManifestSheet[]> | null = null;
const EVENT = 'tarcza-terrain-changed';

function loadManifest(): Promise<ManifestSheet[]> {
  if (!manifestP) {
    manifestP = fetch('/scene/manifest.json')
      .then((r) => (r.ok ? r.json() : { sheets: [] }))
      .then((j) => (j.sheets || []) as ManifestSheet[])
      .catch(() => []);
  }
  return manifestP;
}

async function loadSheet(m: ManifestSheet): Promise<TerrainSheet | null> {
  const have = sheets.get(m.id);
  if (have) return have;
  if (!loading.has(m.id)) {
    loading.set(
      m.id,
      fetch(`/scene/${m.file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((buf) => {
          const { file, ...meta } = m;
          void file;
          const t: TerrainSheet = { ...meta, data: new Int16Array(buf) };
          sheets.set(t.id, t);
          return t;
        })
        .catch(() => null)
    );
  }
  return loading.get(m.id)!;
}

/** Rejestruje arkusz zbudowany w przeglądarce (np. z wgranego pliku ASC). */
export function registerSheet(t: TerrainSheet) {
  sheets.set(t.id, t);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function onTerrainChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

const inBox = (s: { minX: number; maxX: number; minY: number; maxY: number }, x: number, y: number) => x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY;

/** Arkusz NMT pokrywający punkt (z prawdziwymi danymi, nie tylko w prostokącie) albo null → tam zostaje mapa 2D. */
export async function findTerrain(lat: number, lng: number): Promise<TerrainSheet | null> {
  const p = toPL1992(lat, lng);
  for (const s of sheets.values()) if (inBox(s, p.x, p.y) && sheetHeight(s, p.x, p.y) !== null) return s;
  for (const m of await loadManifest()) {
    if (!inBox(m, p.x, p.y)) continue;
    const s = await loadSheet(m);
    if (s && sheetHeight(s, p.x, p.y) !== null) return s;
  }
  return null;
}
