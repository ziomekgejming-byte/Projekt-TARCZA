// WGS84 (lat, lng) <-> PL-1992 (EPSG:2180) — układ współrzędnych plików ASC z Geoportalu.
// Odwzorowanie Gaussa-Krügera, elipsoida GRS80, południk osiowy 19°E, skala 0,9993.

const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const N = F / (2 - F);
const K0 = 0.9993;
const LON0 = (19 * Math.PI) / 180;
const FE = 500000;
const FN = -5300000;

const A_HAT = (A / (1 + N)) * (1 + (N * N) / 4 + N ** 4 / 64);
const ALPHA = [N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3, (13 / 48) * N ** 2 - (3 / 5) * N ** 3, (61 / 240) * N ** 3];
const BETA = [N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3, N ** 2 / 48 + N ** 3 / 15, (17 / 480) * N ** 3];
const DELTA = [2 * N - (2 / 3) * N ** 2 - 2 * N ** 3, (7 / 3) * N ** 2 - (8 / 5) * N ** 3, (56 / 15) * N ** 3];

export function toPL1992(lat: number, lng: number): { x: number; y: number } {
  const phi = (lat * Math.PI) / 180;
  const dl = (lng * Math.PI) / 180 - LON0;
  const e = Math.sqrt(E2);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xiS = xi;
  let etaS = eta;
  for (let j = 1; j <= 3; j++) {
    xiS += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaS += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { x: FE + K0 * A_HAT * etaS, y: FN + K0 * A_HAT * xiS };
}

export function fromPL1992(x: number, y: number): { lat: number; lng: number } {
  const xi = (y - FN) / (K0 * A_HAT);
  const eta = (x - FE) / (K0 * A_HAT);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lam = LON0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: (phi * 180) / Math.PI, lng: (lam * 180) / Math.PI };
}
