import { fromPL1992, toPL1992 } from '@/lib/geo2180';

/**
 * Siatka wysokości (NMT) w PL-1992. Wartości w Int16: (wysokość_m − zeroM) * scale, brak danych = NODATA16.
 * Wiersz 0 = północ, kolumna 0 = zachód; x0,y0 = środek komórki (0,0).
 */
export const NODATA16 = -32768;

/**
 * ground  = NMT  (sam teren, bez budynków i drzew)
 * surface = NMPT (model pokrycia terenu: dachy, korony drzew) — z niego pochodzą prawdziwe kształty dachów
 */
export type SheetKind = 'ground' | 'surface';

export interface TerrainSheet {
  id: string;
  name: string;
  kind?: SheetKind; // brak = 'ground' (stare arkusze .bin)
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

/**
 * Wysokość n.p.m. [m] w punkcie PL-1992 albo null poza arkuszem / w dziurze bez danych.
 * Arkusz „sięga” pół komórki poza środki skrajnych komórek (na brzegu wartość jest przedłużona),
 * dzięki czemu sąsiednie arkusze stykają się bez szczeliny.
 */
export function sheetHeight(t: TerrainSheet, x: number, y: number): number | null {
  const fx0 = (x - t.x0) / t.step;
  const fy0 = (t.y0 - y) / t.step;
  if (fx0 < -0.5 || fy0 < -0.5 || fx0 > t.ncols - 0.5 || fy0 > t.nrows - 0.5) return null;
  const fx = Math.min(Math.max(fx0, 0), t.ncols - 1);
  const fy = Math.min(Math.max(fy0, 0), t.nrows - 1);
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

/** Wysokość z zestawu arkuszy: pierwszy, który ma dane w tym punkcie (sąsiednie arkusze uzupełniają się nawzajem). */
export function heightInSet(set: TerrainSheet[], x: number, y: number): number | null {
  for (const s of set) {
    const h = sheetHeight(s, x, y);
    if (h !== null) return h;
  }
  return null;
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

/** Wszystkie arkusze zarejestrowane w przeglądarce (wgrane ręcznie lub już załadowane z /scene). */
export function registeredSheets(): TerrainSheet[] {
  return [...sheets.values()];
}

/**
 * Zgaduje, czy arkusz `t` to NMT czy NMPT, porównując go z innymi arkuszami na wspólnym obszarze.
 * NMPT jest wszędzie ≥ NMT, a nad budynkami/drzewami wyższy o kilka–kilkanaście metrów.
 * Zwraca null, gdy nie ma się z czym porównać (brak wspólnego obszaru).
 */
export function guessKindByComparison(t: TerrainSheet, others: TerrainSheet[]): SheetKind | null {
  for (const o of others) {
    if (o.id === t.id) continue;
    const x0 = Math.max(t.minX, o.minX), x1 = Math.min(t.maxX, o.maxX);
    const y0 = Math.max(t.minY, o.minY), y1 = Math.min(t.maxY, o.maxY);
    if (x1 - x0 < 20 || y1 - y0 < 20) continue;
    const diffs: number[] = [];
    for (let a = 0; a < 60; a++)
      for (let b = 0; b < 60; b++) {
        const x = x0 + ((x1 - x0) * (a + 0.5)) / 60;
        const y = y0 + ((y1 - y0) * (b + 0.5)) / 60;
        const h1 = sheetHeight(t, x, y);
        const h2 = sheetHeight(o, x, y);
        if (h1 !== null && h2 !== null) diffs.push(h1 - h2);
      }
    if (diffs.length < 200) continue;
    diffs.sort((p, q) => p - q);
    const p10 = diffs[Math.floor(diffs.length * 0.1)];
    const p90 = diffs[Math.floor(diffs.length * 0.9)];
    const oKind: SheetKind = o.kind ?? 'ground';
    if (oKind === 'ground' && p90 > 1.5 && p10 > -0.6) return 'surface';
    if (oKind === 'surface' && p10 < -1.5 && p90 < 0.6) return 'ground';
    if (Math.abs(p10) < 0.6 && Math.abs(p90) < 0.6) return oKind; // ten sam typ (sąsiednie/zdublowane dane)
  }
  return null;
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

/**
 * Wszystkie arkusze NMT (gotowe + wgrane), które zahaczają o okolice punktu (promień radiusM).
 * Zwraca [] , gdy sam punkt nie ma danych → tam zostaje mapa 2D.
 */
export async function findTerrainSet(lat: number, lng: number, radiusM = 850): Promise<TerrainSheet[]> {
  const p = toPL1992(lat, lng);
  const near = (s: { minX: number; maxX: number; minY: number; maxY: number; step: number }) =>
    s.maxX + s.step / 2 >= p.x - radiusM && s.minX - s.step / 2 <= p.x + radiusM && s.maxY + s.step / 2 >= p.y - radiusM && s.minY - s.step / 2 <= p.y + radiusM;
  const found = new Map<string, TerrainSheet>();
  for (const s of sheets.values()) if (near(s)) found.set(s.id, s);
  for (const m of await loadManifest()) {
    if (found.has(m.id) || !near(m)) continue;
    const s = await loadSheet(m);
    if (s) found.set(s.id, s);
  }
  const list = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  return heightInSet(list, p.x, p.y) !== null ? list : [];
}

/** Punkt (lat, lng) z prawdziwymi danymi w pobliżu środka arkusza — do pokazania wgranego arkusza w 3D. */
export function sheetCenterLatLng(t: TerrainSheet): [number, number] | null {
  const cx = (t.minX + t.maxX) / 2;
  const cy = (t.minY + t.maxY) / 2;
  const w = t.maxX - t.minX;
  const h = t.maxY - t.minY;
  for (let r = 0; r <= 0.4; r += 0.05)
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = cx + dx * r * w;
      const y = cy + dy * r * h;
      if (sheetHeight(t, x, y) !== null) {
        const ll = fromPL1992(x, y);
        return [ll.lat, ll.lng];
      }
    }
  return null;
}
