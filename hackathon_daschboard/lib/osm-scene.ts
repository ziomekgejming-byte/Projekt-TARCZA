import { toPL1992 } from '@/lib/geo2180';

export interface OsmBuilding {
  id: string;
  polygon: [number, number][]; // [lat, lng]
  heightM: number;
  measured: boolean; // czy wysokość pochodzi z danych OSM (height / building:levels), a nie z domyślnej
  name?: string;
}
export interface OsmRoad {
  id: string;
  highway: string;
  points: [number, number][];
}
export interface OsmScene {
  buildings: OsmBuilding[];
  roads: OsmRoad[];
}

const URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const NON_VEHICLE = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway', 'corridor', 'proposed', 'construction', 'platform', 'elevator']);
const mem = new Map<string, Promise<OsmScene>>();

const num = (v?: string) => {
  const n = v ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface Way {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export function normalizeOverpass(raw: { elements?: Way[] }): OsmScene {
  const buildings: OsmBuilding[] = [];
  const roads: OsmRoad[] = [];
  for (const el of raw.elements || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    let pts = el.geometry.map((g) => [g.lat, g.lon] as [number, number]);
    if (tags.building && pts.length >= 4) {
      if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
      let h = num(tags.height);
      let measured = true;
      if (h === null) {
        const lv = num(tags['building:levels']);
        if (lv !== null) h = lv * 3 + 1.5;
      }
      if (h === null) {
        h = 6;
        measured = false;
      }
      buildings.push({ id: `OSM-B-${el.id}`, polygon: pts, heightM: h, measured, name: tags.name });
    } else if (tags.highway && !NON_VEHICLE.has(tags.highway)) {
      roads.push({ id: `OSM-R-${el.id}`, highway: tags.highway, points: pts });
    }
  }
  return { buildings, roads };
}

/** Budynki i drogi z OpenStreetMap wokół punktu (z cache w pamięci i localStorage — przydatne bez internetu na prezentacji). */
export function loadOsmScene(lat: number, lng: number, radiusM: number): Promise<OsmScene> {
  const key = `tarcza_osm_${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusM}`;
  if (!mem.has(key)) {
    mem.set(
      key,
      (async () => {
        try {
          const c = localStorage.getItem(key);
          if (c) return normalizeOverpass(JSON.parse(c));
        } catch {
          /* brak cache */
        }
        const q = `[out:json][timeout:25];(way["building"](around:${radiusM},${lat},${lng});way["highway"](around:${radiusM},${lat},${lng}););out geom tags;`;
        for (const url of URLS) {
          try {
            const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            if (!res.ok) continue;
            const raw = await res.json();
            try {
              localStorage.setItem(key, JSON.stringify(raw));
            } catch {
              /* za duże / tryb prywatny */
            }
            return normalizeOverpass(raw);
          } catch {
            /* następny serwer */
          }
        }
        mem.delete(key); // pozwól spróbować ponownie
        return { buildings: [], roads: [] };
      })()
    );
  }
  return mem.get(key)!;
}

export const centroidOf = (poly: [number, number][]): [number, number] => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];

export function polygonAreaM2(poly: [number, number][]): number {
  let s = 0;
  const m = poly.map((p) => toPL1992(p[0], p[1]));
  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    const b = m[(i + 1) % m.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}
