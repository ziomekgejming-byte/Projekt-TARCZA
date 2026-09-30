import { TerrainSheet, heightInSet } from '@/lib/terrain';

/**
 * Siatka 3D z prawdziwymi dachami: NMT (teren) + NMPT (dachy, korony drzew) → jeden gęsty mesh (domyślnie 1 m).
 *
 * Wysokość wierzchołka = teren + wysokość obiektu, gdzie wysokość obiektu = NMPT − NMT (tzw. nDSM), a wszystko poniżej
 * `minObjH` (auta, płoty, krzaki, szum) spłaszczamy do terenu. Pion ścian robi się sam: trójkąt łączący wierzchołek dachu
 * z wierzchołkiem terenu obok jest niemal pionowy. Przewyższenie (ve) działa tylko na teren — budynek ma zawsze prawdziwą wysokość.
 *
 * Moduł jest czysty (bez THREE i DOM), żeby dało się go testować w Node.
 */

export const CLS_GROUND = 0;
export const CLS_ROOF = 1;
export const CLS_TREE = 2;
export const CLS_OTHER = 3;

export interface SurfaceMeshOptions {
  ground: TerrainSheet[]; // NMT; pusty → nie da się oddzielić dachów od terenu (obiekty = 0)
  surface: TerrainSheet[]; // NMPT
  ox: number; // środek sceny w PL-1992
  oy: number;
  half: number; // połowa boku prostokąta [m]
  step: number; // krok siatki [m]; half/step ma być całkowite
  h0: number; // wysokość odniesienia (n.p.m.) — środek sceny
  minObjH?: number; // poniżej tego nDSM traktujemy jako teren (domyślnie 2 m)
  buildingMask?: Uint8Array | null; // n*n, 1 = wewnątrz obrysu budynku (OSM/EGiB); wiersz 0 = północ
}

export interface SurfaceMeshData {
  n: number; // wierzchołków na bok
  step: number;
  half: number;
  groundRel: Float32Array; // wysokość terenu − h0 [m]
  objH: Float32Array; // wysokość obiektu nad terenem [m], 0 = teren
  valid: Uint8Array;
  cls: Uint8Array; // CLS_*
  positions: Float32Array; // x, y, z (północ = −Z), y wypełnia applyVerticalExaggeration
  indices: Uint32Array;
  stats: { roofVerts: number; treeVerts: number; otherVerts: number; maxObjH: number; separated: boolean };
}

export function buildSurfaceMesh(o: SurfaceMeshOptions): SurfaceMeshData {
  const { ground, surface, ox, oy, half, step, h0 } = o;
  const minObj = o.minObjH ?? 2;
  const n = Math.round((2 * half) / step) + 1;
  const N = n * n;
  const separated = ground.length > 0;

  const groundRel = new Float32Array(N);
  const objH = new Float32Array(N);
  const valid = new Uint8Array(N);
  const cls = new Uint8Array(N);
  let maxObj = 0;

  for (let j = 0; j < n; j++) {
    const y = oy + half - j * step;
    for (let i = 0; i < n; i++) {
      const x = ox - half + i * step;
      const k = j * n + i;
      const s = heightInSet(surface, x, y);
      const g = separated ? heightInSet(ground, x, y) : s;
      const gg = g ?? s;
      if (gg === null) continue; // brak danych — dziura w siatce
      valid[k] = 1;
      groundRel[k] = gg - h0;
      const ss = s ?? gg;
      let d = ss - gg;
      if (d >= minObj) {
        if (d > 80) d = 80; // pojedyncze „kolce” (ptaki, błędy) nie mogą robić wież
        objH[k] = d;
        if (d > maxObj) maxObj = d;
      }
    }
  }

  // --- klasyfikacja obiektów: dach / drzewo / inne ---
  const top = (k: number) => groundRel[k] + objH[k];
  const lap = new Float32Array(N);
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (!objH[k]) continue;
      const nb = (kk: number) => (objH[kk] ? top(kk) : top(k)); // brzeg obiektu nie liczy się jako „chropowatość”
      lap[k] = Math.abs(top(k) - (nb(k - 1) + nb(k + 1) + nb(k - n) + nb(k + n)) / 4);
    }
  let roofV = 0, treeV = 0, otherV = 0;
  const mask = o.buildingMask && o.buildingMask.length === N ? o.buildingMask : null;
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (!objH[k]) continue;
      let rs = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const kk = k + dj * n + di;
          if (objH[kk]) {
            rs += lap[kk];
            c++;
          }
        }
      const rough = rs / c; // dach jest gładki (płaszczyzny), korona drzewa — chropowata
      let cl = CLS_OTHER;
      if (mask && mask[k] === 1) cl = CLS_ROOF;
      else if (rough > 0.5) cl = CLS_TREE;
      else if (objH[k] >= 3.5) cl = CLS_ROOF; // budynek, którego nie ma w OSM
      cls[k] = cl;
      if (cl === CLS_ROOF) roofV++;
      else if (cl === CLS_TREE) treeV++;
      else otherV++;
    }

  // --- geometria ---
  const positions = new Float32Array(N * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      positions[k * 3] = i * step - half;
      positions[k * 3 + 2] = j * step - half; // południe = +Z
    }
  const idx = new Uint32Array(6 * (n - 1) * (n - 1));
  let m = 0;
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (!(valid[a] && valid[b] && valid[c] && valid[d])) continue;
      // przekątna wzdłuż mniejszej różnicy wysokości — krawędzie dachów wychodzą czyściej
      if (Math.abs(top(a) - top(d)) < Math.abs(top(b) - top(c))) {
        idx[m++] = a; idx[m++] = c; idx[m++] = d;
        idx[m++] = a; idx[m++] = d; idx[m++] = b;
      } else {
        idx[m++] = a; idx[m++] = c; idx[m++] = b;
        idx[m++] = b; idx[m++] = c; idx[m++] = d;
      }
    }

  const data: SurfaceMeshData = {
    n, step, half, groundRel, objH, valid, cls, positions,
    indices: idx.slice(0, m),
    stats: { roofVerts: roofV, treeVerts: treeV, otherVerts: otherV, maxObjH: maxObj, separated },
  };
  applyVerticalExaggeration(data, 1);
  return data;
}

/** Przelicza tylko Y: teren × ve + prawdziwa wysokość obiektu. Tanie — można wołać przy każdym ruchu suwaka. */
export function applyVerticalExaggeration(d: SurfaceMeshData, ve: number) {
  const N = d.n * d.n;
  for (let k = 0; k < N; k++) d.positions[k * 3 + 1] = d.valid[k] ? d.groundRel[k] * ve + d.objH[k] : 0;
}

/** Czy siatka pokrywa punkt (X, Z) sceny (zgrubnie, do wycinania dziury w gruboziarnistym terenie pod spodem). */
export function hasMeshAt(d: SurfaceMeshData, X: number, Z: number): boolean {
  const i = Math.round((X + d.half) / d.step);
  const j = Math.round((Z + d.half) / d.step);
  if (i < 1 || j < 1 || i > d.n - 2 || j > d.n - 2) return false;
  return d.valid[j * d.n + i] === 1;
}
