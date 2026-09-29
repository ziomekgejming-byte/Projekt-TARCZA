import { FireCell } from '@/types/tarcza';

export interface OfflineFacilityObject {
  id: string;
  name: string;
  sector: 'A' | 'B' | 'C' | 'D';
  type: 'BUILDING' | 'STORAGE' | 'WATER_RESERVOIR' | 'GATE' | 'TRANSFORMER';
  coords: [number, number]; // lat, lng
  polygon: [number, number][]; // footprint polygon [lat, lng][]
  constructionType: 'STEEL' | 'CONCRETE' | 'WOOD';
  structuralDecayRisk?: number; // 0 - 100%
  roofIntact?: boolean;
  entrances: Array<{ coords: [number, number]; label: string; status: 'CLEAR' | 'SMOKE_BLOCKED' | 'FIRE' }>;
  hazards: string[];
  fireHydrants: Array<{ coords: [number, number]; type: 'DN80' | 'DN100' }>;
}

export const MAX_HOSE_LENGTH_METERS = 150;

// Haversine distance in meters
export function haversineDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371e3;
  const phi1 = (p1[0] * Math.PI) / 180;
  const phi2 = (p2[0] * Math.PI) / 180;
  const deltaPhi = ((p2[0] - p1[0]) * Math.PI) / 180;
  const deltaLambda = ((p2[1] - p1[1]) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Ray-casting algorithm for Point in Polygon check
export function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Spatial Hash Grid for high-performance collision avoidance (O(1) neighbor lookups)
export class DroneSpatialHash {
  private cellSizeLat: number;
  private cellSizeLng: number;
  private grid: Map<string, string[]>;

  constructor(cellSizeMeters: number = 20) {
    this.cellSizeLat = cellSizeMeters / 111000;
    this.cellSizeLng = cellSizeMeters / (111000 * Math.cos((52.2 * Math.PI) / 180));
    this.grid = new Map();
  }

  private getKey(lat: number, lng: number): string {
    const gx = Math.floor(lat / this.cellSizeLat);
    const gy = Math.floor(lng / this.cellSizeLng);
    return `${gx}:${gy}`;
  }

  public clear(): void {
    this.grid.clear();
  }

  public insert(id: string, coords: [number, number]): void {
    const key = this.getKey(coords[0], coords[1]);
    const list = this.grid.get(key) || [];
    list.push(id);
    this.grid.set(key, list);
  }

  public getNearbyIds(coords: [number, number]): string[] {
    const gx = Math.floor(coords[0] / this.cellSizeLat);
    const gy = Math.floor(coords[1] / this.cellSizeLng);
    const neighbors: string[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx}:${gy + dy}`;
        const items = this.grid.get(key);
        if (items) {
          neighbors.push(...items);
        }
      }
    }
    return neighbors;
  }
}

// Generates 10m x 10m grid cells for realistic continuous surface fire simulation
export function generateFireGridForBounds(
  bounds: [[number, number], [number, number]],
  baseTemp: number = 620,
  sector: string = 'SEKTOR B-4'
): FireCell[] {
  const minLat = Math.min(bounds[0][0], bounds[1][0]);
  const maxLat = Math.max(bounds[0][0], bounds[1][0]);
  const minLng = Math.min(bounds[0][1], bounds[1][1]);
  const maxLng = Math.max(bounds[0][1], bounds[1][1]);

  // ~10 meters step
  const stepLat = 0.00009;
  const stepLng = 0.000146;

  const cells: FireCell[] = [];
  let row = 0;

  for (let lat = minLat; lat <= maxLat; lat += stepLat) {
    let col = 0;
    for (let lng = minLng; lng <= maxLng; lng += stepLng) {
      // Natural variation based on distance to core
      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;
      const distFromCenter = Math.hypot(lat - centerLat, lng - centerLng);
      const tempVariance = Math.floor((Math.random() - 0.5) * 80);
      const cellTemp = Math.max(160, Math.min(920, Math.round(baseTemp - distFromCenter * 180000 + tempVariance)));

      cells.push({
        id: `FIRE-CELL-${row}-${col}`,
        coords: [lat + stepLat / 2, lng + stepLng / 2],
        bounds: [
          [lat, lng],
          [lat + stepLat, lng + stepLng],
        ],
        temperature: cellTemp,
        intensity: Math.max(0.15, Math.min(1.0, cellTemp / 900)),
        fuelRemaining: Math.floor(60 + Math.random() * 40),
        sector,
        isExtinguished: false,
      });
      col++;
    }
    row++;
  }

  return cells;
}

// Propagates fire along wind direction and transfers heat to adjacent downwind cells
export function propagateFireGrid(
  cells: FireCell[],
  windDeg: number, // 0 = N, 90 = E, 180 = S, 225 = SW
  windSpeedKmh: number
): FireCell[] {
  // Wind comes FROM windDeg, blows TOWARD (windDeg + 180) % 360
  const blowAngleRad = (((windDeg + 180) % 360) * Math.PI) / 180;
  const windVectorLat = Math.cos(blowAngleRad);
  const windVectorLng = Math.sin(blowAngleRad);

  return cells.map((cell, idx) => {
    if (cell.isExtinguished) {
      return {
        ...cell,
        temperature: Math.max(30, cell.temperature - 15),
        intensity: 0,
      };
    }

    // Heat transfer from wind
    let windBonus = 0;
    // Look for hot cells upwind
    const upwindNeighbors = cells.filter((other, oIdx) => {
      if (oIdx === idx || other.isExtinguished) return false;
      const dLat = cell.coords[0] - other.coords[0];
      const dLng = cell.coords[1] - other.coords[1];
      const dist = Math.hypot(dLat, dLng);
      if (dist > 0.00035 || dist === 0) return false;

      // Check alignment with wind vector
      const dot = (dLat * windVectorLat + dLng * windVectorLng) / dist;
      return dot > 0.5 && other.temperature > 400;
    });

    if (upwindNeighbors.length > 0) {
      windBonus = Math.round((windSpeedKmh / 20) * 12 * upwindNeighbors.length);
    }

    const consumption = Math.random() < 0.3 ? 1 : 0;
    const newFuel = Math.max(0, cell.fuelRemaining - consumption);
    const newTemp = Math.min(980, Math.max(120, cell.temperature + windBonus - (newFuel < 20 ? 10 : 0)));

    return {
      ...cell,
      temperature: newTemp,
      intensity: Math.max(0.1, Math.min(1.0, newTemp / 950)),
      fuelRemaining: newFuel,
      isExtinguished: newFuel <= 5 && newTemp < 200,
    };
  });
}

// Facility objects mapped to true geographical coordinates around Kombinat Ożarów Mazowiecki [52.2120, 20.7930]
export const OFFLINE_FACILITY_BUILDINGS: OfflineFacilityObject[] = [
  {
    id: 'BLD-A1',
    name: 'Budynek Dyrekcji i Sztab Dowodzenia KDR',
    sector: 'A',
    type: 'BUILDING',
    coords: [52.2110, 20.7905],
    constructionType: 'CONCRETE',
    structuralDecayRisk: 5,
    roofIntact: true,
    polygon: [
      [52.2106, 20.7898],
      [52.2114, 20.7898],
      [52.2114, 20.7912],
      [52.2106, 20.7912],
    ],
    entrances: [
      { coords: [52.2108, 20.7908], label: 'Wejście Główne A-1', status: 'CLEAR' },
      { coords: [52.2112, 20.7902], label: 'Wyjście Ewakuacyjne A-2', status: 'CLEAR' },
    ],
    hazards: [],
    fireHydrants: [{ coords: [52.2106, 20.7903], type: 'DN100' }],
  },
  {
    id: 'BLD-B4',
    name: 'Główna Hala Produkcyjno-Magazynowa (Zadymiona)',
    sector: 'B',
    type: 'BUILDING',
    coords: [52.2128, 20.7945],
    constructionType: 'STEEL',
    structuralDecayRisk: 42,
    roofIntact: false,
    polygon: [
      [52.2122, 20.7936],
      [52.2134, 20.7936],
      [52.2134, 20.7956],
      [52.2122, 20.7956],
    ],
    entrances: [
      { coords: [52.2124, 20.7942], label: 'Okno 1. Piętra (Odcięte 3 Osoby)', status: 'SMOKE_BLOCKED' },
      { coords: [52.2126, 20.7938], label: 'Brama Załadunkowa B-1', status: 'FIRE' },
      { coords: [52.2132, 20.7952], label: 'Drzwi Północne B-3', status: 'CLEAR' },
    ],
    hazards: ['Zagrożenie zawaleniem stalowego stropu', 'Gęsty dym toksyczny +580°C'],
    fireHydrants: [
      { coords: [52.2122, 20.7936], type: 'DN100' },
      { coords: [52.2134, 20.7956], type: 'DN80' },
    ],
  },
  {
    id: 'BLD-C2',
    name: 'Skład Techniczny Butli ze Sprężonym Gazem',
    sector: 'C',
    type: 'STORAGE',
    coords: [52.2105, 20.7915],
    constructionType: 'STEEL',
    structuralDecayRisk: 28,
    roofIntact: true,
    polygon: [
      [52.2101, 20.7910],
      [52.2109, 20.7910],
      [52.2109, 20.7922],
      [52.2101, 20.7922],
    ],
    entrances: [
      { coords: [52.2104, 20.7918], label: 'Brama Magazynu Gazów C-1', status: 'SMOKE_BLOCKED' },
    ],
    hazards: ['Zagrożenie wybuchem BLEVE (acetylen, tlen)'],
    fireHydrants: [{ coords: [52.2102, 20.7912], type: 'DN100' }],
  },
  {
    id: 'BLD-D1',
    name: 'Plac Logistyczny i Punkt Segregacji Poszkodowanych (TRIAGE)',
    sector: 'D',
    type: 'WATER_RESERVOIR',
    coords: [52.2140, 20.7910],
    constructionType: 'CONCRETE',
    structuralDecayRisk: 0,
    roofIntact: true,
    polygon: [
      [52.2136, 20.7904],
      [52.2144, 20.7904],
      [52.2144, 20.7918],
      [52.2136, 20.7918],
    ],
    entrances: [
      { coords: [52.2142, 20.7912], label: 'Brama Wjazdowa ZRM i Korytarz Karetkowy', status: 'CLEAR' },
    ],
    hazards: [],
    fireHydrants: [{ coords: [52.2138, 20.7906], type: 'DN80' }],
  },
];

export interface OfflineWaterBody {
  id: string;
  name: string;
  type: 'POND' | 'STREAM' | 'RESERVOIR';
  coords: [number, number];
  polygon: [number, number][];
  capacityLiters: number;
}

// Otwarte zbiorniki wodne i cieki do nieograniczonego zaopatrzenia wodnego wozów i motopomp
export const OFFLINE_WATER_BODIES: OfflineWaterBody[] = [
  {
    id: 'WATER-POND-01',
    name: 'Otwarte Lustro Wody - Zbiornik Przeciwpożarowy Północ (500 000 l)',
    type: 'POND',
    coords: [52.2148, 20.7960],
    polygon: [
      [52.2143, 20.7952],
      [52.2153, 20.7954],
      [52.2155, 20.7968],
      [52.2144, 20.7966],
    ],
    capacityLiters: 500000,
  },
  {
    id: 'WATER-STREAM-01',
    name: 'Kanał Melioracyjny / Rów Zaopatrzenia Wodnego (Ciągły Pobór)',
    type: 'STREAM',
    coords: [52.2098, 20.7942],
    polygon: [
      [52.2095, 20.7925],
      [52.2100, 20.7928],
      [52.2101, 20.7960],
      [52.2096, 20.7958],
    ],
    capacityLiters: 1200000,
  },
];

// Sprawdza, czy punkt znajduje się w pobliżu zbiornika wodnego (< thresholdMeters)
export function findNearestWaterBody(
  point: [number, number],
  thresholdMeters: number = 45
): {
  body: OfflineWaterBody | null;
  distance: number;
  shoreCoords: [number, number] | null;
} {
  let nearest: OfflineWaterBody | null = null;
  let minD = Infinity;

  for (const wb of OFFLINE_WATER_BODIES) {
    const dist = haversineDistanceMeters(point, wb.coords);
    if (dist < minD) {
      minD = dist;
      nearest = wb;
    }
  }

  if (nearest && minD <= thresholdMeters) {
    return {
      body: nearest,
      distance: minD,
      shoreCoords: nearest.coords,
    };
  }

  return { body: null, distance: minD, shoreCoords: null };
}

// Oblicza prostokąt ograniczający poligon
export function computePolygonBounds(polygon: [number, number][]): [[number, number], [number, number]] {
  if (!polygon || polygon.length === 0) return [[0, 0], [0, 0]];
  let minLat = polygon[0][0];
  let maxLat = polygon[0][0];
  let minLng = polygon[0][1];
  let maxLng = polygon[0][1];
  for (const p of polygon) {
    if (p[0] < minLat) minLat = p[0];
    if (p[0] > maxLat) maxLat = p[0];
    if (p[1] < minLng) minLng = p[1];
    if (p[1] > maxLng) maxLng = p[1];
  }
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Oblicza powierzchnię poligonu w m² (algorytm Gaussa z konwersją metryczną)
export function computePolygonAreaM2(polygon: [number, number][]): number {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = polygon[i][1] * 111000 * Math.cos((52.21 * Math.PI) / 180);
    const yi = polygon[i][0] * 111000;
    const xj = polygon[j][1] * 111000 * Math.cos((52.21 * Math.PI) / 180);
    const yj = polygon[j][0] * 111000;
    area += xi * yj - xj * yi;
  }
  return Math.round(Math.abs(area / 2));
}

// Środek masy (centroid) poligonu
export function getPolygonCentroid(polygon: [number, number][]): [number, number] {
  if (!polygon || polygon.length === 0) return [52.2120, 20.7930];
  let latSum = 0;
  let lngSum = 0;
  for (const p of polygon) {
    latSum += p[0];
    lngSum += p[1];
  }
  return [latSum / polygon.length, lngSum / polygon.length];
}

// Dynamiczne powiększanie poligonu pożaru przy braku jednostek (silnie uzależnione od siły wiatru)
export function expandFirePolygon(
  polygon: [number, number][],
  baseFactor: number = 0.045,
  windDeg: number = 225,
  windSpeedKmh: number = 18
): [number, number][] {
  if (!polygon || polygon.length < 3) return polygon;
  const [cLat, cLng] = getPolygonCentroid(polygon);
  const blowAngleRad = (((windDeg + 180) % 360) * Math.PI) / 180;

  // Im silniejszy wiatr, tym gwałtowniejsze rozprzestrzenianie frontu pożaru
  const windIntensityMultiplier = Math.max(1.0, 1.0 + (windSpeedKmh / 20) * 0.75);
  const effectiveFactor = baseFactor * windIntensityMultiplier;

  const windDriftLat = Math.cos(blowAngleRad) * (windSpeedKmh / 20) * 0.000028;
  const windDriftLng = Math.sin(blowAngleRad) * (windSpeedKmh / 20) * 0.000042;

  return polygon.map(([lat, lng]) => {
    const dLat = lat - cLat;
    const dLng = lng - cLng;
    return [
      lat + dLat * effectiveFactor + windDriftLat,
      lng + dLng * effectiveFactor + windDriftLng,
    ];
  });
}

// Dynamiczne kurczenie poligonu pożaru przy aktywnym natarciu jednostek gaśniczych
export function shrinkFirePolygon(
  polygon: [number, number][],
  factor: number = 0.08
): [number, number][] {
  if (!polygon || polygon.length < 3) return polygon;
  const [cLat, cLng] = getPolygonCentroid(polygon);

  return polygon.map(([lat, lng]) => {
    const dLat = lat - cLat;
    const dLng = lng - cLng;
    return [
      lat - dLat * factor,
      lng - dLng * factor,
    ];
  });
}

// Korytarze i węzły drogowe omijające bryły budynków
export const OFFLINE_ROAD_WAYPOINTS: [number, number][] = [
  [52.2100, 20.7890], // Brama Wjazdowa Główna
  [52.2108, 20.7895], // Sztab KDR / Parking Dyrekcji
  [52.2118, 20.7898], // Droga Zachodnia węzeł 1
  [52.2136, 20.7900], // Dojazd do Placu TRIAGE
  [52.2142, 20.7915], // Plac TRIAGE i Korytarz Karetkowy
  [52.2140, 20.7932], // Droga Północna nad Halą B4
  [52.2142, 20.7955], // Droga do Zbiornika Wodnego Północ
  [52.2148, 20.7960], // Brzeg Zbiornika Wodnego
  [52.2118, 20.7928], // Plac Centralny między Halą a Magazynem
  [52.2118, 20.7958], // Droga Wschodnia za Halą B4
  [52.2100, 20.7925], // Droga Południowa przy gazach
  [52.2100, 20.7950], // Droga Południowa Kanał
];

// Wyznaczanie trasy wozów i rot po korytarzach drogowych z omijaniem ścian
export function findRoadPath(
  start: [number, number],
  destination: [number, number]
): [number, number][] {
  // Sprawdź, czy linia prosta przecina wnętrza budynków
  const crossesBuilding = OFFLINE_FACILITY_BUILDINGS.some((bld) => {
    const mid1: [number, number] = [
      start[0] * 0.66 + destination[0] * 0.34,
      start[1] * 0.66 + destination[1] * 0.34,
    ];
    const mid2: [number, number] = [
      start[0] * 0.34 + destination[0] * 0.66,
      start[1] * 0.34 + destination[1] * 0.66,
    ];
    return isPointInPolygon(mid1, bld.polygon) || isPointInPolygon(mid2, bld.polygon);
  });

  if (!crossesBuilding) {
    return [start, destination];
  }

  // Wyszukaj najbliższe węzły drogowe
  let nearestStartWp = OFFLINE_ROAD_WAYPOINTS[0];
  let minStartDist = Infinity;
  for (const wp of OFFLINE_ROAD_WAYPOINTS) {
    const d = haversineDistanceMeters(start, wp);
    if (d < minStartDist) {
      minStartDist = d;
      nearestStartWp = wp;
    }
  }

  let nearestDestWp = OFFLINE_ROAD_WAYPOINTS[0];
  let minDestDist = Infinity;
  for (const wp of OFFLINE_ROAD_WAYPOINTS) {
    const d = haversineDistanceMeters(destination, wp);
    if (d < minDestDist) {
      minDestDist = d;
      nearestDestWp = wp;
    }
  }

  if (
    Math.abs(nearestStartWp[0] - nearestDestWp[0]) < 0.0001 &&
    Math.abs(nearestStartWp[1] - nearestDestWp[1]) < 0.0001
  ) {
    return [start, nearestStartWp, destination];
  }

  return [start, nearestStartWp, nearestDestWp, destination];
}
