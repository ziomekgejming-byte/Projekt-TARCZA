// START OF FILE lib/offline-maps-data.ts
import { FireCell } from '@/types/tarcza';

export interface OfflineFacilityObject {
  id: string;
  name: string;
  sector: 'A' | 'B' | 'C' | 'D';
  type: 'BUILDING' | 'STORAGE' | 'WATER_RESERVOIR' | 'GATE' | 'TRANSFORMER';
  coords: [number, number];
  polygon: [number, number][];
  constructionType: 'STEEL' | 'CONCRETE' | 'WOOD';
  structuralDecayRisk?: number;
  roofIntact?: boolean;
  entrances: Array<{ coords: [number, number]; label: string; status: 'CLEAR' | 'SMOKE_BLOCKED' | 'FIRE' }>;
  hazards: string[];
  fireHydrants: Array<{ coords: [number, number]; type: 'DN80' | 'DN100' }>;
}

export const MAX_HOSE_LENGTH_METERS = 150;

export function haversineDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371e3;
  const phi1 = (p1[0] * Math.PI) / 180;
  const phi2 = (p2[0] * Math.PI) / 180;
  const deltaPhi = ((p2[0] - p1[0]) * Math.PI) / 180;
  const deltaLambda = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class DroneSpatialHash {
  private cellSizeLat: number;
  private cellSizeLng: number;
  private grid: Map<string, string[]>;

  constructor(cellSizeMeters: number = 20) {
    this.cellSizeLat = cellSizeMeters / 111000;
    this.cellSizeLng = cellSizeMeters / (111000 * Math.cos((52.2 * Math.PI) / 180));
    this.grid = new Map();
  }
  private getKey(lat: number, lng: number): string { return `${Math.floor(lat / this.cellSizeLat)}:${Math.floor(lng / this.cellSizeLng)}`; }
  public clear(): void { this.grid.clear(); }
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
        const items = this.grid.get(`${gx + dx}:${gy + dy}`);
        if (items) neighbors.push(...items);
      }
    }
    return neighbors;
  }
}

// --- NOWY GENERATOR SIATKI Z FIZYKĄ MATERIAŁÓW ---
export function generateDynamicFireGrid(center: [number, number]): FireCell[] {
  const cells: FireCell[] = [];
  const gridSize = 36; // 36x36 komórek
  const stepLat = 0.0001; // ok. 11 metrów
  const stepLng = 0.00015; // ok. 10 metrów

  const startLat = center[0] - (gridSize / 2) * stepLat;
  const startLng = center[1] - (gridSize / 2) * stepLng;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const lat = startLat + row * stepLat;
      const lng = startLng + col * stepLng;
      const cellCenter: [number, number] = [lat + stepLat / 2, lng + stepLng / 2];

      // Detekcja materiału (Budynek = trudniej zapalić, Las/Trawa = łatwiej)
      const isBuilding = OFFLINE_FACILITY_BUILDINGS.some(b => isPointInPolygon(cellCenter, b.polygon));
      const terrainType = isBuilding ? 'TERRAIN:BUILDING' : 'TERRAIN:FOREST';
      
      // Inicjalne zarzewie pożaru w centrum
      const distFromCenter = Math.hypot(cellCenter[0] - center[0], cellCenter[1] - center[1]);
      const isInitialFire = distFromCenter < 0.0004;

      cells.push({
        id: `CELL-${row}-${col}`,
        coords: cellCenter,
        bounds: [[lat, lng], [lat + stepLat, lng + stepLng]],
        temperature: isInitialFire ? 800 : 20, // 20C = bezpieczne
        intensity: isInitialFire ? 1.0 : 0,
        fuelRemaining: isBuilding ? 1000 : 300, // Budynki palą się dłużej
        sector: terrainType, // Przechowujemy typ terenu w polu sector
        isExtinguished: false,
      });
    }
  }
  return cells;
}

// --- NOWY SILNIK PROPAGACJI POŻARU (Wiatr + Przeskakiwanie) ---
export function propagateFireGrid(cells: FireCell[], windDeg: number, windSpeedKmh: number): FireCell[] {
  const blowAngleRad = (((windDeg + 180) % 360) * Math.PI) / 180;
  const windVectorLat = Math.cos(blowAngleRad);
  const windVectorLng = Math.sin(blowAngleRad);

  // Tworzymy kopię do odczytu, żeby symulacja była jednoczesna dla wszystkich komórek
  const oldCells = [...cells];

  return cells.map((cell, idx) => {
    if (cell.isExtinguished && cell.temperature <= 40) return cell;
    if (cell.fuelRemaining <= 0) return { ...cell, temperature: Math.max(20, cell.temperature - 20), isExtinguished: true, intensity: 0 };

    let heatReceived = 0;
    const isBuilding = (cell.sector || '').includes('BUILDING');
    const ignitionThreshold = isBuilding ? 350 : 120; // Las zapala się przy 120C, budynek przy 350C

    // Szukamy sąsiadów w promieniu ~25 metrów
    for (let i = 0; i < oldCells.length; i++) {
      if (i === idx) continue;
      const neighbor = oldCells[i];
      if (neighbor.temperature < 200) continue; // Sąsiad musi płonąć, żeby grzać

      const dLat = cell.coords[0] - neighbor.coords[0];
      const dLng = cell.coords[1] - neighbor.coords[1];
      const dist = Math.hypot(dLat, dLng);

      if (dist < 0.0003) { // Promień oddziaływania
        // Wpływ wiatru (czy komórka jest z wiatrem od sąsiada?)
        const dot = (dLat * windVectorLat + dLng * windVectorLng) / (dist || 0.0001);
        const windMultiplier = dot > 0 ? 1 + (windSpeedKmh / 15) * dot : 0.2; // Z wiatrem grzeje mocniej, pod wiatr słabiej

        heatReceived += (neighbor.temperature / 10) * windMultiplier;
      }
    }

    let newTemp = cell.temperature;
    
    // Jeśli płonie, to sam generuje ciepło i zużywa paliwo
    if (cell.temperature >= ignitionThreshold) {
      newTemp = Math.min(isBuilding ? 1000 : 700, cell.temperature + 20);
      const consumption = isBuilding ? 2 : 8; // Las wypala się szybciej
      return {
        ...cell,
        temperature: newTemp,
        intensity: Math.min(1.0, newTemp / 800),
        fuelRemaining: Math.max(0, cell.fuelRemaining - consumption),
      };
    } else {
      // Jeśli nie płonie, ale otrzymuje ciepło - nagrzewa się (Zagrożenie)
      newTemp = Math.min(ignitionThreshold + 10, cell.temperature + heatReceived - 5); // -5 to naturalne stygnięcie
      newTemp = Math.max(20, newTemp);
      return {
        ...cell,
        temperature: newTemp,
        intensity: 0,
      };
    }
  });
}

// Reszta starych funkcji pomocniczych
export function computePolygonBounds(polygon: [number, number][]): [[number, number], [number, number]] {
  if (!polygon || polygon.length === 0) return [[0, 0], [0, 0]];
  let minLat = polygon[0][0], maxLat = polygon[0][0], minLng = polygon[0][1], maxLng = polygon[0][1];
  for (const p of polygon) {
    if (p[0] < minLat) minLat = p[0];
    if (p[0] > maxLat) maxLat = p[0];
    if (p[1] < minLng) minLng = p[1];
    if (p[1] > maxLng) maxLng = p[1];
  }
  return [[minLat, minLng], [maxLat, maxLng]];
}

export function computePolygonAreaM2(polygon: [number, number][]): number {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const xi = polygon[i][1] * 111000 * Math.cos((52.21 * Math.PI) / 180);
    const yi = polygon[i][0] * 111000;
    const xj = polygon[j][1] * 111000 * Math.cos((52.21 * Math.PI) / 180);
    const yj = polygon[j][0] * 111000;
    area += xi * yj - xj * yi;
  }
  return Math.round(Math.abs(area / 2));
}

export function getPolygonCentroid(polygon: [number, number][]): [number, number] {
  if (!polygon || polygon.length === 0) return [52.2120, 20.7930];
  let latSum = 0, lngSum = 0;
  for (const p of polygon) { latSum += p[0]; lngSum += p[1]; }
  return [latSum / polygon.length, lngSum / polygon.length];
}

export function expandFirePolygon(polygon: [number, number][], baseFactor: number, windDeg: number, windSpeedKmh: number): [number, number][] { return polygon; }
export function shrinkFirePolygon(polygon: [number, number][], factor: number): [number, number][] { return polygon; }

export const OFFLINE_FACILITY_BUILDINGS: OfflineFacilityObject[] = [
  {
    id: 'BLD-A1', name: 'Budynek Dyrekcji', sector: 'A', type: 'BUILDING', coords: [52.2110, 20.7905], constructionType: 'CONCRETE',
    polygon: [[52.2106, 20.7898], [52.2114, 20.7898], [52.2114, 20.7912], [52.2106, 20.7912]], entrances: [], hazards: [], fireHydrants: []
  },
  {
    id: 'BLD-B4', name: 'Główna Hala Magazynowa', sector: 'B', type: 'BUILDING', coords: [52.2128, 20.7945], constructionType: 'STEEL',
    polygon: [[52.2122, 20.7936], [52.2134, 20.7936], [52.2134, 20.7956], [52.2122, 20.7956]], entrances: [], hazards: [], fireHydrants: []
  },
  {
    id: 'BLD-C2', name: 'Skład Techniczny', sector: 'C', type: 'STORAGE', coords: [52.2105, 20.7915], constructionType: 'STEEL',
    polygon: [[52.2101, 20.7910], [52.2109, 20.7910], [52.2109, 20.7922], [52.2101, 20.7922]], entrances: [], hazards: [], fireHydrants: []
  }
];

export interface OfflineWaterBody { id: string; name: string; type: string; coords: [number, number]; polygon: [number, number][]; capacityLiters: number; }
export const OFFLINE_WATER_BODIES: OfflineWaterBody[] = [];
export function findNearestWaterBody(point: [number, number], thresholdMeters: number = 45): any { return { body: null, distance: Infinity, shoreCoords: null }; }

export const OFFLINE_ROAD_WAYPOINTS: [number, number][] = [
  [52.2100, 20.7890], [52.2108, 20.7895], [52.2118, 20.7898], [52.2136, 20.7900], [52.2142, 20.7915],
  [52.2140, 20.7932], [52.2142, 20.7955], [52.2148, 20.7960], [52.2118, 20.7928], [52.2118, 20.7958],
  [52.2100, 20.7925], [52.2100, 20.7950],
];

export function findRoadPath(start: [number, number], destination: [number, number]): [number, number][] {
  const crossesBuilding = OFFLINE_FACILITY_BUILDINGS.some((bld) => {
    const mid1: [number, number] = [start[0] * 0.66 + destination[0] * 0.34, start[1] * 0.66 + destination[1] * 0.34];
    return isPointInPolygon(mid1, bld.polygon);
  });
  if (!crossesBuilding) return [start, destination];

  let nearestStartWp = OFFLINE_ROAD_WAYPOINTS[0];
  let minStartDist = Infinity;
  for (const wp of OFFLINE_ROAD_WAYPOINTS) {
    const d = haversineDistanceMeters(start, wp);
    if (d < minStartDist) { minStartDist = d; nearestStartWp = wp; }
  }

  let nearestDestWp = OFFLINE_ROAD_WAYPOINTS[0];
  let minDestDist = Infinity;
  for (const wp of OFFLINE_ROAD_WAYPOINTS) {
    const d = haversineDistanceMeters(destination, wp);
    if (d < minDestDist) { minDestDist = d; nearestDestWp = wp; }
  }

  return [start, nearestStartWp, nearestDestWp, destination];
}