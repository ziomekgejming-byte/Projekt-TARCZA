import {
  MacroThreat,
  DroneTelemetry,
  HotSwapStation,
  TacticalMarker,
  DecisionAlert,
  SopProcedure,
  Incident,
  ScannedDroneCandidate
} from '@/types/tarcza';
import { generateDynamicFireGrid } from './offline-maps-data';

export const INITIAL_MACRO_THREATS: MacroThreat[] = [
  {
    id: 'TR-01',
    title: 'Pożar kompleksu leśnego Puszcza Kampinoska',
    type: 'FIRE',
    region: 'Warszawa Zachód / Izabelin',
    voivodeship: 'Mazowieckie',
    coords: [52.332, 20.751],
    severity: 'HIGH',
    source: 'SENTINEL-2',
    timestamp: '10 min temu',
    description: 'Front ognia o długości 1.2 km w kierunku wschodnim. Prędkość wiatru 22 km/h. Ryzyko dotarcia do zabudowań.',
    activeUnits: 14,
  },
  {
    id: 'TR-02',
    title: 'Zablokowana droga S7 - Zawalenie wiaduktu technicznego',
    type: 'ROAD_BLOCK',
    region: 'Grójec / Tarczyn',
    voivodeship: 'Mazowieckie',
    coords: [51.982, 20.864],
    severity: 'CRITICAL',
    source: 'POLICJA',
    timestamp: '25 min temu',
    description: 'Wstrzymany korytarz zaopatrzeniowy i ewakuacyjny na południe. Wyznaczono objazdy przez DW722.',
    activeUnits: 8,
  },
  {
    id: 'TR-03',
    title: 'Wzrost stanu wód - rzeka Wisła (stan alarmowy +45cm)',
    type: 'FLOOD',
    region: 'Płock / Kępa Polska',
    voivodeship: 'Mazowieckie',
    coords: [52.541, 19.702],
    severity: 'MEDIUM',
    source: 'IMGW',
    timestamp: '42 min temu',
    description: 'Ryzyko podsiąków wałów przeciwpowodziowych w rejonie Radziwia. Zgromadzono zapory przeciwpowodziowe.',
    activeUnits: 22,
  },
];

// --- CZYSTY GENERATOR SCENARIUSZA (BEZ "ŚMIECI") ---
const generateIncident01Markers = (): TacticalMarker[] => {
  const markers: TacticalMarker[] = [];
  const baseLat = 52.2120;
  const baseLng = 20.7930;

  markers.push({
    id: `TM-VIC-IN-1`,
    type: 'VICTIM',
    sector: 'SEKTOR B-4',
    coords: [baseLat + 0.0009, baseLng + 0.0018],
    label: `Zgłoszenie zarządcy: Brak kontaktu z ludźmi (4 os.)`,
    details: `Informacja od administratora obiektu: Grupa osób nie opuściła strefy zagrożenia. Dokładna liczba uwięzionych nieznana. Wymagane wejście roty ODO, dron nie przenika przez stropy.`,
    severity: 'HIGH',
    trappedCount: 4,
    status: 'UNKNOWN',
    isInsideBuilding: true,
    buildingId: 'BLD-B4',
    isDiscovered: false, 
    detectionMethod: 'NONE',
    timeLimitSeconds: 240,
    survivalSecondsLeft: 240,
    survivalTimer: 240,
  });

  markers.push({
    id: `TM-VIC-FLIR-2`,
    type: 'VICTIM',
    sector: 'SEKTOR B-2',
    coords: [baseLat + 0.0004, baseLng + 0.0012],
    label: `3 osoby w strefie okiennej (Wykryto FLIR)`,
    details: 'Odcięci przez zadymienie klatki schodowej. Sygnatura ciepła stabilna. Wymagana ewakuacja z zewnątrz przy użyciu drabin.',
    severity: 'CRITICAL',
    trappedCount: 3,
    status: 'OCZEKUJE_EWAKUACJI',
    timeLimitSeconds: 150,
    survivalSecondsLeft: 150,
    survivalTimer: 150,
    isInsideBuilding: true,
    buildingId: 'BLD-B4',
    isDiscovered: true, 
    detectionMethod: 'FLIR',
  });

  markers.push({
    id: `TM-CLUE-5`,
    type: 'CLUE',
    sector: 'SEKTOR B-2',
    coords: [baseLat, baseLng + 0.0008],
    label: `Zwiad Dronowy (Optyka): Porzucony aparat ochrony dróg oddechowych (ODO)`,
    details: 'Rozpoznanie z drona wskazuje możliwy wektor ewakuacji poszkodowanych. Warto sprawdzić ten obszar.',
    clueType: 'PERSONAL_ITEM',
    severity: 'MEDIUM',
  });

  markers.push({
    id: 'KDR-01',
    type: 'KDR_STATION',
    sector: 'SEKTOR A-1',
    coords: [52.2108, 20.7895],
    label: 'Stanowisko Dowodzenia KDR',
    details: 'Główny punkt koordynacji radiowej i dyspozycji sił i środków.',
    severity: 'LOW',
  });

  return markers;
};

const INCIDENT_01_MARKERS: TacticalMarker[] = generateIncident01Markers();

const INCIDENT_01_ALERTS: DecisionAlert[] = [
  {
    id: 'DA-01',
    timestamp: '00:02:14',
    sector: 'SEKTOR B-4',
    title: 'Gwałtowny skok temperatury stropu (+120°C / min)',
    description: 'Algorytm wizyjny wykrył ugięcie konstrukcji o 14 cm. Bezpośrednie ryzyko zawalenia dachu nad sektorem.',
    severity: 'CRITICAL',
    recommendedAction: 'Wycofać natychmiast roty ratownicze z wnętrza obiektu na odległość minimum 30 m.',
    source: 'EDGE_AI',
    actionTaken: false,
  }
];

const INCIDENT_01_HOTSWAPS: HotSwapStation[] = [
  {
    id: 'HS-01',
    name: 'Strefa Lądowania / Hot-Swap PÓŁNOC (Baza KDR)',
    coords: [52.2152, 20.7938],
    radiusMeters: 35,
    availablePacks: 6,
    chargingPacks: 2,
    dronesInQueue: [],
  }
];

// REJESTR AKTYWNYCH INCYDENTÓW W REGIONIE
export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'INC-2026-049',
    code: 'POZAR-OBIEKT-2026',
    name: 'Pożar Obiektu Wielkopowierzchniowego',
    threatType: 'FIRE',
    status: 'ACTIVE',
    severity: 'CRITICAL',
    locationName: 'Ożarów Mazowiecki / Strefa Przemysłowa',
    centerCoords: [52.2120, 20.7930],
    createdAt: 'Dzisiaj, 06:14',
    commanderCallsign: 'KDR-WOLIN-04',
    assignedUnitsCount: 14,
    description: 'Rozwinięty pożar obiektu wielkopowierzchniowego. Prawdopodobnie uwięzieni ludzie wewnątrz (brak kontaktu). Zwiad dronowy w toku.',
    tacticalMarkers: INCIDENT_01_MARKERS,
    decisionAlerts: INCIDENT_01_ALERTS,
    hotSwapStations: INCIDENT_01_HOTSWAPS,
    suggestedEvacuationCorridor: 'K-1 (Klatka N-1 -> Brama D-1)',
    zones: [], // <--- USUNIĘTO STARE STREFY (ŚMIECI)
    weather: {
      windSpeedKmh: 18,
      windDirectionDeg: 225,
      windDirectionName: 'SW (Południowo-Zachodni)',
      temperatureC: 22,
      humidityPercent: 42,
    },
    hasHydrantAccess: true,
    kdrPosition: [52.2108, 20.7895],
    temperatureGrid: generateDynamicFireGrid([52.2128, 20.7945]),
  }
];

export const CANDIDATE_DRONES_POOL: ScannedDroneCandidate[] = [
  {
    id: 'DRON-01',
    callsign: 'TARCZA-ALPHA-1',
    model: 'Recon-Hexacopter Jetson TX2',
    macAddress: 'E4:5F:01:88:B2:1A',
    signalRssi: -52,
    battery: 84,
    payload: 'THERMAL_FLIR',
    frequencyBand: '868 MHz FHSS + 2.4G',
    isPairedPreviously: true,
  },
  {
    id: 'DRON-02',
    callsign: 'TARCZA-ALPHA-2',
    model: 'Heavy-Lift Medic Dropper',
    macAddress: 'E4:5F:01:88:C4:02',
    signalRssi: -58,
    battery: 78,
    payload: 'FIRST_AID_DROP',
    frequencyBand: '868 MHz FHSS',
    isPairedPreviously: true,
  },
  {
    id: 'DRON-03',
    callsign: 'TARCZA-BRAVO-1',
    model: 'Acoustic Evacuation Guide',
    macAddress: 'B8:27:EB:14:9A:F0',
    signalRssi: -66,
    battery: 48,
    payload: 'ACOUSTIC_MEGAPHONE',
    frequencyBand: '868 MHz FHSS',
    isPairedPreviously: false,
  },
  {
    id: 'DRON-04',
    callsign: 'TARCZA-BRAVO-2',
    model: 'LiDAR Structural Mapper',
    macAddress: 'DC:A6:32:71:09:88',
    signalRssi: -61,
    battery: 92,
    payload: 'LIDAR_STRUCTURAL',
    frequencyBand: '5.8 GHz Mesh',
    isPairedPreviously: false,
  },
];

export function createTelemetryFromCandidate(
  candidate: ScannedDroneCandidate,
  centerCoords: [number, number],
  index: number
): DroneTelemetry {
  const offsetLat = (index % 2 === 0 ? 1 : -1) * (0.0008 + index * 0.0004);
  const offsetLng = (index % 3 === 0 ? 1 : -1) * (0.0010 + index * 0.0005);

  const initialCoords: [number, number] = [
    centerCoords[0] + offsetLat,
    centerCoords[1] + offsetLng,
  ];

  const initialWaypoint: [number, number] = [
    centerCoords[0] + (index % 2 === 0 ? 0.001 : -0.001),
    centerCoords[1] + (index % 3 === 0 ? 0.002 : -0.002),
  ];

  const altitudeTier = 42 + (index % 4) * 8;

  return {
    id: candidate.id,
    callsign: candidate.callsign,
    model: candidate.model,
    battery: candidate.battery,
    altitude: altitudeTier,
    speed: 32 + (index % 3) * 3,
    status: 'PATROL',
    coords: initialCoords,
    vector: { dLat: 0.0001, dLng: -0.0001 },
    payload: candidate.payload,
    pairingStatus: 'CONNECTED',
    isPaired: true,
    signalRssi: candidate.signalRssi,
    frequencyBand: candidate.frequencyBand,
    targetWaypoint: initialWaypoint,
    hoverDurationRemaining: 0,
    headingDeg: 45 + index * 60,
  };
}

export const SOP_PROCEDURES: SopProcedure[] = [
  {
    id: 'SOP-01',
    code: 'SOP-KDR-01',
    title: 'Zarządzanie Rujem Dronów w Pożarze Obiektów',
    category: 'ROZPOZNANIE & BEZPIECZEŃSTWO',
    priority: 'KRYTYCZNY',
    lastUpdate: '2026-03-12',
    steps: [
      '1. Ustanowienie strefy zakazu lotów (No-Fly Zone) dla dronów cywilnych.',
      '2. Wyznaczenie minimalnie 2 stref lądowania Hot-Swap poza strefą zagrożenia.',
      '3. Utrzymywanie w powietrzu nie mniej niż 1 maszyny z kamerą termowizyjną FLIR.',
      '4. Automatyczny powrót dronów do gniazda przy baterii < 20%.',
      '5. Raportowanie ugięć dachu z sensora LiDAR bezpośrednio do KDR.'
    ]
  }
];

export const TECHNICAL_SUPPORT_INFO = {
  phonePrimary: '+48 22 599 00 11 (Centrala Łączności PSP / MSWiA)',
  phoneDirectKDR: '+48 22 599 00 99 (Infolinia Wsparcia KDR 24/7)',
  satelliteIridium: '+8816 314 88 201',
  radioEmergencyChannel: 'Krajowy Kanał Ratowniczy KRG-01 (148.825 MHz)',
  cryptoDeskEmail: 'kdr-bezpieczenstwo@tarcza.gov.pl',
  meshNetworkSSID: 'TARCZA-TACTICAL-MESH-SECURE-802.11s',
  encryptionStandard: 'AES-256-GCM / ChaCha20-Poly1305 / Hardware Token FIDO2'
};