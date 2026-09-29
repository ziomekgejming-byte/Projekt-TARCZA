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
  {
    id: 'TR-04',
    title: 'Wyciek amoniaku w zakładzie przetwórczym (HAZMAT kat. 2)',
    type: 'HAZMAT',
    region: 'Ożarów Mazowiecki / Duchnice',
    voivodeship: 'Mazowieckie',
    coords: [52.212, 20.793],
    severity: 'CRITICAL',
    source: 'PSP',
    timestamp: '6 min temu',
    description: 'Obłok par amoniaku przemieszcza się na północny wschód. Zalecana natychmiastowa strefa izolacji 1500m.',
    activeUnits: 19,
  },
  {
    id: 'TR-05',
    title: 'Intensywny front burzowy z porywami wiatru do 95 km/h',
    type: 'STORM',
    region: 'Ciechanów / Mława',
    voivodeship: 'Mazowieckie',
    coords: [52.881, 20.615],
    severity: 'MEDIUM',
    source: 'IMGW',
    timestamp: '1 h temu',
    description: 'Liczne powalone drzewa na linie SN 15kV. Zakłócenia w odbiorze sygnałów LTE stacji bazowych.',
    activeUnits: 31,
  },
  {
    id: 'TR-06',
    title: 'Pożar składowiska chemikaliów i tworzyw sztucznych',
    type: 'FIRE',
    region: 'Dąbrowa Górnicza / Sosnowiec',
    voivodeship: 'Śląskie',
    coords: [50.324, 19.231],
    severity: 'HIGH',
    source: 'OSINT',
    timestamp: '18 min temu',
    description: 'Gęsty czarny dym toksyczny o wysokiej temperaturze. Drony termowizyjne monitorują rozprzestrzenianie.',
    activeUnits: 17,
  },
];

// DEDYKOWANE PAKIETY ZDARZEŃ DLA KONKRETNYCH INCYDENTÓW
const INCIDENT_01_MARKERS: TacticalMarker[] = [
  {
    id: 'TM-01',
    type: 'VICTIM',
    sector: 'SEKTOR B-2',
    coords: [52.2124, 20.7942],
    label: '3 osoby uwięzione (Wykryto FLIR)',
    details: 'Odcięci przez zadymienie klatki schodowej na 1. piętrze hali magazynowej. Sygnatura ciepła stabilna. Wymagana ewakuacja oknem północnym.',
    severity: 'CRITICAL',
    vitals: 'Tętno podwyższone, ruch w kierunku okna',
    trappedCount: 3,
    status: 'OCZEKUJE_EWAKUACJI',
    timeLimitSeconds: 120,
    survivalSecondsLeft: 120,
    survivalTimer: 120,
    isInsideBuilding: true,
    buildingId: 'BLD-B4',
    isDiscovered: true,
    detectionMethod: 'FLIR',
  },
  {
    id: 'TM-06',
    type: 'VICTIM',
    sector: 'SEKTOR B-4',
    coords: [52.2129, 20.7948],
    label: 'Pracownik techniczny w piwnicy hali (Status: NIEZNANY)',
    details: 'Zgłoszono brak kontaktu z pracownikiem utrzymania ruchu w hali B-4. Sygnał akustyczny (krzyki) na granicy słyszalności.',
    severity: 'HIGH',
    trappedCount: 1,
    status: 'UNKNOWN',
    isInsideBuilding: true,
    buildingId: 'BLD-B4',
    isDiscovered: false,
    detectionMethod: 'NONE',
    timeLimitSeconds: 180,
    survivalSecondsLeft: 180,
    survivalTimer: 180,
  },
  {
    id: 'TM-02',
    type: 'FIRE_ZONE',
    sector: 'SEKTOR B-4',
    coords: [52.2132, 20.7958],
    radiusMeters: 70,
    label: 'Główne zarzewie pożaru (+580°C)',
    details: 'Płomienie obejmują dach konstrukcji stalowej hali B-4. Ryzyko utraty nośności dźwigarów dachowych.',
    severity: 'HIGH',
    temperature: 580,
  },
  {
    id: 'TM-03',
    type: 'HAZMAT',
    sector: 'SEKTOR C-1',
    coords: [52.2105, 20.7915],
    radiusMeters: 100,
    label: 'Skupisko butli z acetylenem i tlenem (BLEVE)',
    details: 'Zagrożenie wybuchem odłamkowym (BLEVE). Wyznaczono strefę rażenia o promieniu 100m.',
    severity: 'CRITICAL',
    status: 'WYMAGANE_CHŁODZENIE',
  },
  {
    id: 'TM-04',
    type: 'FRIENDLY_UNIT',
    sector: 'SEKTOR A-1',
    coords: [52.2098, 20.7895],
    label: 'Rota Ratownicza PSP GBA-2.5/16',
    details: 'Rota 1 (Dowódca asp. sztab. Nowak) rozwija linię gaśniczą W-52. Łączność radiowa kanał B04.',
    status: 'W_DZIAŁANIU',
    currentTask: 'STANDBY',
    waterLevel: 84,
    crewCount: 4,
    reportStatus: 'Linia gaśnicza W-52 podana. Oczekiwanie na dyspozycję KDR.',
  },
  {
    id: 'TM-05',
    type: 'FRIENDLY_UNIT',
    sector: 'SEKTOR D-3',
    coords: [52.2140, 20.7910],
    label: 'Zespół Ratownictwa Medycznego (ZRM-04)',
    details: 'Punkt segregacji medycznej (TRIAGE) rozwinięty przy bramie wjazdowej nr 2.',
    status: 'GOTOWOŚĆ_TRIAGE',
    currentTask: 'STANDBY',
    waterLevel: 100,
    crewCount: 3,
    reportStatus: 'Punkt TRIAGE gotowy na przyjęcie 6 poszkodowanych.',
  },
];

const INCIDENT_01_ALERTS: DecisionAlert[] = [
  {
    id: 'DA-01',
    timestamp: '00:02:14',
    sector: 'SEKTOR B-4',
    title: 'Gwałtowny skok temperatury stropu (+120°C / min)',
    description: 'Algorytm wizyjny wykrył ugięcie kratownicy dachowej o 14 cm. Bezpośrednie ryzyko zawalenia dachu nad sektorem montażu.',
    severity: 'CRITICAL',
    recommendedAction: 'Wycofać natychmiast roty ratownicze z wnętrza hali B-4 na odległość minimum 30 m.',
    source: 'EDGE_AI',
    actionTaken: false,
  },
  {
    id: 'DA-02',
    timestamp: '00:05:40',
    sector: 'SEKTOR B-2',
    title: 'Wykryto 3 poszkodowanych w oknie (Korytarz zadymiony)',
    description: 'Dron TARCZA-ALPHA-1 namierzył sygnaturę cieplną przez okno. Droga ucieczki przez hol główny odcięta płomieniem.',
    severity: 'HIGH',
    recommendedAction: 'Zadysponować drona ALPHA-2 do zrzutu transpondera/radiotelefonu oraz podać sygnał megafonem z drona BRAVO-1.',
    source: 'CLOUD_AI',
    actionTaken: false,
  },
  {
    id: 'DA-03',
    timestamp: '00:08:12',
    sector: 'SEKTOR ROJU',
    title: 'Krytyczny poziom baterii drona BRAVO-1 (18%)',
    description: 'Dron operuje w strefie megafonowej. Wyliczony czas do lądowania awaryjnego: 3 min 40 s.',
    severity: 'MEDIUM',
    recommendedAction: 'Autonomiczne przekierowanie do najbliższej strefy Hot-Swap w celu wymiany pakietu ogniw.',
    source: 'DRONE_SENSOR',
    actionTaken: true,
  },
  {
    id: 'DA-04',
    timestamp: '00:11:05',
    sector: 'ŁĄCZNOŚĆ TAKTYCZNA',
    title: 'Zakłócenia radiowe w paśmie 2.4 GHz (Współczynnik SNR < 6dB)',
    description: 'Wykryto interferencje elektromagnetyczne w pobliżu transformatorowni.',
    severity: 'LOW',
    recommendedAction: 'Przełączono automatycznie na pasmo 868 MHz w technologii Frequency Hopping (FHSS).',
    source: 'KDR_RADIO',
    actionTaken: true,
  },
];

const INCIDENT_01_HOTSWAPS: HotSwapStation[] = [
  {
    id: 'HS-01',
    name: 'Strefa Lądowania / Hot-Swap PÓŁNOC (Baza KDR)',
    coords: [52.2152, 20.7938],
    radiusMeters: 35,
    availablePacks: 6,
    chargingPacks: 2,
    dronesInQueue: ['DRON-03'],
  },
  {
    id: 'HS-02',
    name: 'Strefa Hot-Swap POŁUDNIE (Wóz Dowodzenia)',
    coords: [52.2088, 20.7918],
    radiusMeters: 30,
    availablePacks: 4,
    chargingPacks: 4,
    dronesInQueue: [],
  },
];

// REJESTR AKTYWNYCH INCYDENTÓW W REGIONIE
export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'INC-2026-049',
    code: 'KOMB-POŁUDNIE-2026',
    name: 'Pożar Kompleksu Przemysłowego Kombinat B-4',
    threatType: 'FIRE',
    status: 'ACTIVE',
    severity: 'CRITICAL',
    locationName: 'Ożarów Mazowiecki / Duchnice (Kombinat Przemysłowy)',
    centerCoords: [52.2120, 20.7930],
    createdAt: 'Dzisiaj, 06:14',
    commanderCallsign: 'KDR-WOLIN-04',
    assignedUnitsCount: 14,
    description: 'Pożar dachu hali magazynowo-produkcyjnej B-4. Uwięzione 3 osoby w oknie na 1. piętrze. W sektorze C skład butli acetylenowych (zagrożenie BLEVE).',
    tacticalMarkers: INCIDENT_01_MARKERS,
    decisionAlerts: INCIDENT_01_ALERTS,
    hotSwapStations: INCIDENT_01_HOTSWAPS,
    suggestedEvacuationCorridor: 'K-1 (Okno B-2 -> Klatka N-1 -> Brama D-1)',
    zones: [
      {
        id: 'ZONE-01',
        name: 'Strefa Gorąca B-4 (Wysoka Temperatura)',
        type: 'DANGER_ZONE',
        bounds: [[52.2120, 20.7932], [52.2136, 20.7960]],
        color: '#ef4444',
        createdAt: '06:20',
      },
      {
        id: 'ZONE-02',
        name: 'Strefa Zagrożenia BLEVE (Acetylen C-1)',
        type: 'NO_FLY',
        bounds: [[52.2100, 20.7905], [52.2112, 20.7925]],
        color: '#f59e0b',
        createdAt: '06:25',
      },
    ],
    weather: {
      windSpeedKmh: 18,
      windDirectionDeg: 225,
      windDirectionName: 'SW (Południowo-Zachodni)',
      temperatureC: 22,
      humidityPercent: 42,
    },
  },
  {
    id: 'INC-2026-050',
    code: 'S7-CYSTERNA-GROJEC',
    name: 'Rozszczelnienie Cysterny LPG na Trasie Ekspresowej S7',
    threatType: 'HAZMAT',
    status: 'ACTIVE',
    severity: 'HIGH',
    locationName: 'Trasa S7 km 24.8 / węzeł Tarczyn-Południe',
    centerCoords: [51.9820, 20.8640],
    createdAt: 'Dzisiaj, 07:45',
    commanderCallsign: 'KDR-MAZ-12',
    assignedUnitsCount: 8,
    description: 'Kolizja ciągnika siodłowego z naczepą-cysterną przewożącą 20 ton gazu propan-butan. Wyciek z zaworu dennego. Ruch wstrzymany w obu kierunkach.',
    tacticalMarkers: [
      {
        id: 'S7-M-01',
        type: 'HAZMAT',
        sector: 'SEKTOR S7-A',
        coords: [51.9820, 20.8640],
        radiusMeters: 250,
        label: 'Cysterna LPG - Wyciek w fazie ciekłej',
        details: 'Chmura par gazu ściele się w zagłębieniu terenu przy rowie melioracyjnym.',
        severity: 'CRITICAL',
      },
      {
        id: 'S7-M-02',
        type: 'FRIENDLY_UNIT',
        sector: 'SEKTOR S7-B',
        coords: [51.9805, 20.8610],
        label: 'Posterunek Blokadowy Policja / OSP',
        details: 'Blokada zjazdu Tarczyn Północ, kierowanie na DW722.',
        status: 'BLOKADA_DROGI',
      },
      {
        id: 'S7-M-03',
        type: 'FRIENDLY_UNIT',
        sector: 'SEKTOR S7-A',
        coords: [51.9835, 20.8660],
        label: 'JRG Grójec GCBA 5/32 (Kurtyna wodna)',
        details: 'Rozstawiono 3 kurtyny wodne celem zbijania oparów gazu.',
        status: 'W_DZIAŁANIU',
      }
    ],
    decisionAlerts: [
      {
        id: 'S7-DA-01',
        timestamp: '00:04:12',
        sector: 'S7-A',
        title: 'Przekroczenie DGW (Dolnej Granicy Wybuchowości) o 30%',
        description: 'Czujniki drona rozpoznawczego wykryły stężenie 1.2% vol w promieniu 80m.',
        severity: 'CRITICAL',
        recommendedAction: 'Zakaz używania urządzeń nieiskrobezpiecznych, wycofanie pojazdów spalinowych.',
        source: 'DRONE_SENSOR',
        actionTaken: true,
      }
    ],
    hotSwapStations: [
      {
        id: 'HS-S7-1',
        name: 'Strefa Lądowiska Hot-Swap MOP Tarczyn',
        coords: [51.9790, 20.8590],
        radiusMeters: 40,
        availablePacks: 8,
        chargingPacks: 2,
        dronesInQueue: [],
      }
    ]
  },
  {
    id: 'INC-2026-051',
    code: 'SAR-KAMPINOS-03',
    name: 'Poszukiwanie Zaginionych Turystów (Puszcza Kampinoska)',
    threatType: 'SEARCH_RESCUE',
    status: 'ACTIVE',
    severity: 'MEDIUM',
    locationName: 'Rezerwat Sieraków / Izabelin',
    centerCoords: [52.3320, 20.7510],
    createdAt: 'Dzisiaj, 05:20',
    commanderCallsign: 'KDR-KAMP-01',
    assignedUnitsCount: 19,
    description: 'Dwie osoby zaginione (matka z 10-letnim dzieckiem) po zmroku na szlaku czerwonym. Spadek temperatury do +3°C. Priorytetowe przeszukiwanie dronami FLIR.',
    tacticalMarkers: [
      {
        id: 'SAR-M-01',
        type: 'VICTIM',
        sector: 'SEKTOR SIERAKÓW-3',
        coords: [52.3340, 20.7560],
        label: 'Prawdopodobna sygnatura cieplna FLIR',
        details: 'Dron ALPHA-1 namierzył anomalię cieplną pod koronami sosen na wydmie.',
        severity: 'HIGH',
        vitals: 'Ruch wykryty',
        trappedCount: 2,
        status: 'WERYFIKACJA_NAZIEMNA',
      },
      {
        id: 'SAR-M-02',
        type: 'FRIENDLY_UNIT',
        sector: 'SEKTOR BAZA',
        coords: [52.3300, 20.7480],
        label: 'Sztab Poszukiwawczy OSP Izabelin / Grupa Przewodników Psów',
        details: 'Stanowisko dowodzenia, rozwinięta sieć radiowa KRG-01.',
        status: 'SZTAB_AKTYWNY',
      }
    ],
    decisionAlerts: [
      {
        id: 'SAR-DA-01',
        timestamp: '00:15:30',
        sector: 'SEKTOR SIERAKÓW-3',
        title: 'Wykrycie sygnału telefonu komórkowego (IMSI Catcher)',
        description: 'Dron z transponderem zlokalizował urządzenie w odległości 320m od szlaku.',
        severity: 'MEDIUM',
        recommendedAction: 'Skierować grupę naziemną z psem tropiącym na współrzędne 52.3340, 20.7560.',
        source: 'EDGE_AI',
        actionTaken: false,
      }
    ],
    hotSwapStations: [
      {
        id: 'HS-SAR-1',
        name: 'Punkt Zasilania Dronów Polana Jakubów',
        coords: [52.3295, 20.7470],
        radiusMeters: 35,
        availablePacks: 12,
        chargingPacks: 4,
        dronesInQueue: [],
      }
    ]
  }
];

// KANDYDACI DO PAROWANIA DRONÓW (FLOTA SPRZĘTOWA)
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
  {
    id: 'DRON-05',
    callsign: 'TARCZA-CHARLIE-1',
    model: 'Fast-Scout Optical 8K Zoom x30',
    macAddress: 'DC:A6:32:89:FE:11',
    signalRssi: -72,
    battery: 95,
    payload: 'THERMAL_FLIR',
    frequencyBand: '868 MHz FHSS',
    isPairedPreviously: false,
  },
];

// Helper: Konwersja kandydata na aktywny obiekt telemetryczny
export function createTelemetryFromCandidate(
  candidate: ScannedDroneCandidate,
  centerCoords: [number, number],
  index: number
): DroneTelemetry {
  // Rozstaw maszyny wokół centrum incydentu
  const offsetLat = (index % 2 === 0 ? 1 : -1) * (0.0008 + index * 0.0004);
  const offsetLng = (index % 3 === 0 ? 1 : -1) * (0.0010 + index * 0.0005);

  const initialCoords: [number, number] = [
    centerCoords[0] + offsetLat,
    centerCoords[1] + offsetLng,
  ];

  // Wygeneruj pierwszy waypoint w obrębie sektora
  const initialWaypoint: [number, number] = [
    centerCoords[0] + (Math.random() - 0.5) * 0.003,
    centerCoords[1] + (Math.random() - 0.5) * 0.004,
  ];

  return {
    id: candidate.id,
    callsign: candidate.callsign,
    model: candidate.model,
    battery: candidate.battery,
    altitude: 35 + index * 6,
    speed: 32,
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

// Procedury SOP
export const SOP_PROCEDURES: SopProcedure[] = [
  {
    id: 'SOP-01',
    code: 'SOP-KDR-01',
    title: 'Zarządzanie Rujem Dronów w Pożarze Kompleksu Przemysłowego',
    category: 'ROZPOZNANIE & BEZPIECZEŃSTWO',
    priority: 'KRYTYCZNY',
    lastUpdate: '2026-03-12',
    steps: [
      '1. Ustanowienie strefy zakazu lotów (No-Fly Zone) dla dronów cywilnych (zgłoszenie do PAŻP / airspace guard).',
      '2. Wyznaczenie minimalnie 2 stref lądowania Hot-Swap poza strefą zagrożenia toksycznego.',
      '3. Utrzymywanie w powietrzu nie mniej niż 1 maszyny z kamerą termowizyjną FLIR pod kątem 45° do frontu pożaru.',
      '4. W przypadku spadku baterii poniżej 20% system ma prawo automatycznego odesłania drona do najbliższego gniazda Hot-Swap bez zgody KDR.',
      '5. Raportowanie temperatur powyżej 450°C bezpośrednio na terminale rot ratowniczych.'
    ]
  },
  {
    id: 'SOP-02',
    code: 'SOP-KDR-02',
    title: 'Procedura Odciętych Poszkodowanych i Zrzut Pakietu Ratunkowego',
    category: 'EWAKUACJA',
    priority: 'KRYTYCZNY',
    lastUpdate: '2026-02-28',
    steps: [
      '1. Potwierdzenie obecności ludzi kamerą FLIR oraz sensorem akustycznym drona.',
      '2. Zbliżenie drona wyposażonego w mechanizm zrzutowy (ALPHA-2) na pułap bezpieczny (10-15m od okna/dachu).',
      '3. Zrzut pakietu zawierającego: maskę ucieczkową z pochłaniaczem tlenkowym, opatrunek hydrożelowy oraz radiotelefon na kanale KDR-SOS.',
      '4. Uruchomienie syntezatora mowy na dronie megafonowym (BRAVO-1) z poleceniem: "Pozostańcie przy oknie, pomoc jest w drodze, uszczelnijcie drzwi tkaniną".',
      '5. Wyznaczenie wektora dojścia dla roty RIT (Rapid Intervention Team).'
    ]
  },
  {
    id: 'SOP-03',
    code: 'SOP-KDR-03',
    title: 'Przełączanie Łączności w Przypadku Zagłuszenia (FHSS & Mesh)',
    category: 'ŁĄCZNOŚĆ & DUAL-USE',
    priority: 'WYSOKI',
    lastUpdate: '2026-01-15',
    steps: [
      '1. System monitoruje wskaźnik utraty pakietów (Packet Loss > 15%).',
      '2. W przypadku zakłóceń celowych lub awarii infrastruktury naziemnej, węzły przechodzą w tryb Ad-Hoc Mesh.',
      '3. Wykorzystanie Frequency Hopping Spread Spectrum (FHSS) na 16 kanałach pseudolosowych.',
      '4. Przejście AI z trybu Chmury na Edge AI (lokalny moduł Jetson w dronach i wozie dowodzenia).',
      '5. Zachowanie bufora zapisu wideo na kartach kryptograficznych w dronach.'
    ]
  },
  {
    id: 'SOP-04',
    code: 'SOP-KDR-04',
    title: 'Zagrożenie Wybuchem Fizycznym i Termicznym (BLEVE)',
    category: 'HAZMAT',
    priority: 'KRYTYCZNY',
    lastUpdate: '2026-03-01',
    steps: [
      '1. Wyznaczenie strefy bezwzględnego wycofania ludzi (min. 300m dla zbiorników powyżej 1000L).',
      '2. Zastosowanie dronów bezzałogowych do ciągłego pomiaru temperatury płaszcza zbiornika.',
      '3. Uruchomienie bezzałogowych działek gaśniczych chłodzących.',
      '4. Wycofanie stanowisk dowodzenia za osłony naturalne lub wały ziemne.'
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
