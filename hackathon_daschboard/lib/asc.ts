import { NODATA16, TerrainSheet } from '@/lib/terrain';

/**
 * Interpreter plików ESRI ASCII Grid (.asc) z Geoportalu (NMT / NMPT) w układzie PL-1992 (EPSG:2180).
 *
 * Format: 6 linii nagłówka (ncols, nrows, xllcorner|xllcenter, yllcorner|yllcenter, cellsize, NODATA_value),
 * potem nrows wierszy po ncols liczb, od północy (wiersz 0) do południa. Nie zakładamy „jedna linia = jeden wiersz” —
 * czytamy strumień liczb, więc działa też przy zawiniętych liniach i końcach CRLF.
 */

export interface AscGrid {
  ncols: number;
  nrows: number;
  cellsize: number;
  /** współrzędne ŚRODKA komórki lewej-dolnej (przeliczone, jeśli plik podaje róg) */
  xllCenter: number;
  yllCenter: number;
  nodata: number;
  values: Float32Array; // wiersz 0 = północ; brak danych = NaN
  min: number;
  max: number;
  nodataFraction: number;
}

export class AscError extends Error {}

export function parseAsc(input: ArrayBuffer | string): AscGrid {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  const n = text.length;

  // --- nagłówek: pary "klucz wartość", dopóki pierwsza pozycja linii nie jest liczbą ---
  const hdr: Record<string, number> = {};
  let pos = 0;
  for (let lines = 0; lines < 12 && pos < n; lines++) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = n;
    const line = text.slice(pos, end).trim();
    if (!line) {
      pos = end + 1;
      continue;
    }
    const m = /^([A-Za-z_]+)\s+([-+0-9.eE,]+)$/.exec(line);
    if (!m) break; // zaczęły się dane
    hdr[m[1].toLowerCase()] = parseFloat(m[2].replace(',', '.'));
    pos = end + 1;
  }
  const need = (k: string) => {
    if (!(k in hdr) || !Number.isFinite(hdr[k])) throw new AscError(`Brak pola „${k}” w nagłówku ASC.`);
    return hdr[k];
  };
  const ncols = need('ncols');
  const nrows = need('nrows');
  const cellsize = need('cellsize');
  const nodata = 'nodata_value' in hdr ? hdr['nodata_value'] : -9999;
  let xll: number;
  let yll: number;
  if ('xllcenter' in hdr) xll = hdr['xllcenter'];
  else xll = need('xllcorner') + cellsize / 2;
  if ('yllcenter' in hdr) yll = hdr['yllcenter'];
  else yll = need('yllcorner') + cellsize / 2;
  if (ncols < 2 || nrows < 2 || cellsize <= 0) throw new AscError('Nieprawidłowy rozmiar siatki w nagłówku ASC.');
  // PL-1992: x ∈ ~[100 000, 900 000], y ∈ ~[100 000, 800 000]. Układ 2000 ma północ rzędu milionów.
  if (yll > 1e6 || xll < 0 || xll > 1e6) throw new AscError('Współrzędne nie wyglądają na PL-1992 (EPSG:2180). Pobierz NMT w układzie 1992.');

  // --- dane: szybki skaner liczb ---
  const total = ncols * nrows;
  const values = new Float32Array(total);
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let bad = 0;
  let i = pos;
  while (i < n && count < total) {
    let c = text.charCodeAt(i);
    // pomijamy białe znaki
    if (c <= 32) {
      i++;
      continue;
    }
    let sign = 1;
    if (c === 45) {
      sign = -1;
      i++;
      c = text.charCodeAt(i);
    } else if (c === 43) {
      i++;
      c = text.charCodeAt(i);
    }
    let v = 0;
    let digits = 0;
    while (c >= 48 && c <= 57) {
      v = v * 10 + (c - 48);
      digits++;
      c = text.charCodeAt(++i);
    }
    if (c === 46 || c === 44) {
      c = text.charCodeAt(++i);
      let f = 0.1;
      while (c >= 48 && c <= 57) {
        v += (c - 48) * f;
        f /= 10;
        digits++;
        c = text.charCodeAt(++i);
      }
    }
    if (c === 101 || c === 69) {
      // wykładnik
      let es = 1;
      c = text.charCodeAt(++i);
      if (c === 45) {
        es = -1;
        c = text.charCodeAt(++i);
      } else if (c === 43) c = text.charCodeAt(++i);
      let ev = 0;
      while (c >= 48 && c <= 57) {
        ev = ev * 10 + (c - 48);
        c = text.charCodeAt(++i);
      }
      v *= Math.pow(10, es * ev);
    }
    if (digits === 0) {
      i++; // śmieć — pomijamy znak
      continue;
    }
    v *= sign;
    if (v === nodata) {
      values[count++] = NaN;
      bad++;
    } else {
      values[count++] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (count < total) throw new AscError(`Plik ucięty: ${count} z ${total} wartości.`);
  if (!Number.isFinite(min)) throw new AscError('Plik ASC nie zawiera żadnych wysokości.');
  return { ncols, nrows, cellsize, xllCenter: xll, yllCenter: yll, nodata, values, min, max, nodataFraction: bad / total };
}

/**
 * Zamienia siatkę ASC na arkusz terenu (Int16). `decimate` = co ile komórek uśredniać (2 → siatka 2 m z 1 m).
 * Blok bez ani jednej wartości zostaje „brak danych”; częściowe bloki liczą się ze średniej z tego, co jest.
 */
export function ascToSheet(g: AscGrid, id: string, name = id, decimate = 1): TerrainSheet {
  const k = Math.max(1, Math.floor(decimate));
  const ncols = Math.ceil(g.ncols / k);
  const nrows = Math.ceil(g.nrows / k);
  const step = g.cellsize * k;
  const range = g.max - g.min;
  const scale = range < 300 ? 100 : range < 3000 ? 10 : 1; // cm / dm / m
  const zeroM = Math.floor(g.min);
  const data = new Int16Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      let sum = 0;
      let cnt = 0;
      for (let dr = 0; dr < k; dr++) {
        const rr = r * k + dr;
        if (rr >= g.nrows) break;
        for (let dc = 0; dc < k; dc++) {
          const cc = c * k + dc;
          if (cc >= g.ncols) break;
          const v = g.values[rr * g.ncols + cc];
          if (v === v) {
            sum += v;
            cnt++;
          }
        }
      }
      data[r * ncols + c] = cnt === 0 ? NODATA16 : Math.round((sum / cnt - zeroM) * scale);
    }
  }
  // środek komórki (0,0) — północno-zachodnia; blok k×k ma środek przesunięty o (k−1)/2 oryginalnej komórki
  const shift = ((k - 1) / 2) * g.cellsize;
  const x0 = g.xllCenter + shift;
  const yTopCenter = g.yllCenter + (g.nrows - 1) * g.cellsize;
  const y0 = yTopCenter - shift;
  return {
    id,
    name,
    step,
    ncols,
    nrows,
    zeroM,
    scale,
    x0,
    y0,
    minX: x0,
    maxX: x0 + (ncols - 1) * step,
    minY: y0 - (nrows - 1) * step,
    maxY: y0,
    data,
  };
}

/** Wygodnik do pola <input type="file">: plik → arkusz gotowy do registerSheet(). */
export async function ascFileToSheet(file: File, decimate = 2): Promise<{ sheet: TerrainSheet; grid: Pick<AscGrid, 'min' | 'max' | 'nodataFraction' | 'ncols' | 'nrows' | 'cellsize'> }> {
  const grid = parseAsc(await file.arrayBuffer());
  const id = file.name.replace(/\.[^.]+$/, '');
  const sheet = ascToSheet(grid, id, id, decimate);
  return { sheet, grid };
}
