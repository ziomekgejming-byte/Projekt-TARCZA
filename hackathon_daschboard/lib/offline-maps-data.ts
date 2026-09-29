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
      { coords: [52.2134, 20.7956], type: 'DN80' }
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
