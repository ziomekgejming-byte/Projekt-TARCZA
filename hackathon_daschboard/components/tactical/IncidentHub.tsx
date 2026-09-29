'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Incident,
  DroneTelemetry,
  ScannedDroneCandidate,
  IncidentThreatType,
  ThreatLevel,
  TacticalMarker,
  HotSwapStation,
  TacticalZone,
  DecisionAlert,
} from '@/types/tarcza';
import { generateFireGridForBounds, computePolygonBounds } from '@/lib/offline-maps-data';

const CreationMapDynamic = dynamic(() => import('./CreationMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-xs">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
        <span>Ładowanie mapy dyspozycji operacyjnej...</span>
      </div>
    </div>
  ),
});
import {
  INITIAL_INCIDENTS,
  CANDIDATE_DRONES_POOL,
  createTelemetryFromCandidate
} from '@/lib/mock-data';
import {
  Shield,
  PlusCircle,
  FolderOpen,
  Zap,
  Radio,
  Wifi,
  Compass,
  MapPin,
  Clock,
  Users,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Cpu,
  Layers,
  Search,
  ArrowRight,
  LogOut,
  BookOpen,
  RefreshCw,
  Battery,
  HardDrive
} from 'lucide-react';

interface IncidentHubProps {
  commanderCallsign: string;
  onLaunchIncident: (incident: Incident, connectedDrones: DroneTelemetry[]) => void;
  onLogout: () => void;
  onOpenSop: () => void;
  onOpenSupport: () => void;
}

export default function IncidentHub({
  commanderCallsign,
  onLaunchIncident,
  onLogout,
  onOpenSop,
  onOpenSupport,
}: IncidentHubProps) {
  // Navigation inside hub: Incidents list or New incident creation
  const [activeTab, setActiveTab] = useState<'JOIN' | 'CREATE'>('JOIN');

  // Incidents registry state (loads from localStorage or initial defaults)
  const [incidents, setIncidents] = useState<Incident[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tarcza_custom_incidents');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return INITIAL_INCIDENTS;
  });

  // Selected incident for swarm onboarding
  const [selectedIncidentForOnboarding, setSelectedIncidentForOnboarding] = useState<Incident | null>(null);

  // New action form state
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newCoords, setNewCoords] = useState<[number, number]>([52.2120, 20.7930]);
  const [newKdrCoords, setNewKdrCoords] = useState<[number, number]>([52.2108, 20.7895]);
  const [hasHydrantAccess, setHasHydrantAccess] = useState<boolean>(true);
  const [newThreatType, setNewThreatType] = useState<IncidentThreatType>('FIRE');
  const [newSeverity, setNewSeverity] = useState<ThreatLevel>('HIGH');
  const [newDescription, setNewDescription] = useState('');
  const [newUnitsCount, setNewUnitsCount] = useState<number>(6);
  const [formError, setFormError] = useState<string | null>(null);
  const [newZones, setNewZones] = useState<TacticalZone[]>([]);

  // Drone Onboarding State
  const [pairedDroneIds, setPairedDroneIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tarcza_paired_drone_ids');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    // Domyślnie zadeklarowane 2 maszyny jednostki w rejestrze
    return ['DRON-01', 'DRON-02'];
  });

  const [connectedDroneIds, setConnectedDroneIds] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredCandidates, setDiscoveredCandidates] = useState<ScannedDroneCandidate[]>(CANDIDATE_DRONES_POOL);

  // Save paired drone IDs to localStorage when modified
  const updatePairedDroneIds = (ids: string[]) => {
    setPairedDroneIds(ids);
    try {
      localStorage.setItem('tarcza_paired_drone_ids', JSON.stringify(ids));
    } catch {}
  };

  // Quick connect previously paired drones
  const handleQuickConnectAllPaired = () => {
    const idsToConnect = discoveredCandidates
      .filter((c) => pairedDroneIds.includes(c.id))
      .map((c) => c.id);
    setConnectedDroneIds(Array.from(new Set([...connectedDroneIds, ...idsToConnect])));
  };

  // Scan for nearby drones simulation
  const handleStartScanning = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      // Odśwież siłę sygnału i wykryj dodatkową maszynę
      setDiscoveredCandidates(
        CANDIDATE_DRONES_POOL.map((d) => ({
          ...d,
          signalRssi: Math.min(-42, d.signalRssi + Math.floor(Math.random() * 8) - 4),
        }))
      );
    }, 1200);
  };

  // Toggle single drone connection/pairing
  const handleToggleDroneConnection = (droneId: string) => {
    if (connectedDroneIds.includes(droneId)) {
      setConnectedDroneIds(connectedDroneIds.filter((id) => id !== droneId));
    } else {
      setConnectedDroneIds([...connectedDroneIds, droneId]);
      if (!pairedDroneIds.includes(droneId)) {
        updatePairedDroneIds([...pairedDroneIds, droneId]);
      }
    }
  };

  // Get GPS for new action form
  const handleDetectGps = () => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setNewCoords([pos.coords.latitude, pos.coords.longitude]);
          setNewLocation(`Bieżąca lokalizacja GPS [${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}]`);
        },
        () => {
          setNewLocation('Warszawa Śródmieście (Domyślne GPS)');
          setNewCoords([52.2297, 21.0122]);
        }
      );
    }
  };

  // Submit new action form
  const handleCreateIncidentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!newName.trim()) {
      setFormError('Podaj nazwę operacyjną nowej akcji.');
      return;
    }
    if (!newLocation.trim()) {
      setFormError('Określ lokalizację lub pobierz współrzędne GPS.');
      return;
    }

    const code = `INC-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    // Generowanie skali zdarzenia z obszaru stref (Poszkodowani wewnątrz i na zewnątrz, Ślady, Zniszczenia, Hydranty)
    const generatedMarkers: TacticalMarker[] = [
      {
        id: `M-SZTAB-${Date.now()}`,
        type: 'KDR_STATION',
        sector: 'SEKTOR A (SZTAB KDR)',
        coords: newKdrCoords,
        label: `Stanowisko Dowodzenia (${commanderCallsign})`,
        details: 'Główny punkt koordynacji radiowej KDR i dyspozycji sił i środków.',
        status: 'SZTAB_KDR',
        severity: 'LOW',
      },
      {
        id: `M-ROTA-${Date.now()}`,
        type: 'FRIENDLY_UNIT',
        sector: 'SEKTOR A-2',
        coords: [newCoords[0] - 0.0004, newCoords[1] - 0.0004],
        label: 'Rota Gaśnicza PSP GCBA-5/32',
        details: 'Pierwszy rzut ratowniczo-gaśniczy. Gotowość do natarcia z liniami gaśniczymi (zasięg węża max 150m).',
        status: 'W_DZIAŁANIU',
        currentTask: 'STANDBY',
        waterLevel: 92,
        crewCount: 4,
        reportStatus: 'Zasilanie wodne zabezpieczone. Oczekiwanie na rozkaz.',
      },
    ];

    // Hydranty (jeśli zaznaczono dostęp do sieci hydrantowej)
    if (hasHydrantAccess) {
      generatedMarkers.push({
        id: `M-HYD-${Date.now()}`,
        type: 'HYDRANT',
        sector: 'SEKTOR A-1',
        coords: [newCoords[0] - 0.0007, newCoords[1] - 0.0003],
        label: 'Hydrant zewnętrzny DN100 (6.0 bar)',
        details: 'Sprawny punkt zasilania sieciowego. Ciśnienie nominalne do zasilania wozów.',
        severity: 'LOW',
      });
    }

    // Dynamiczna liczba poszkodowanych (np. 2 do 5 osób - w tym na zewnątrz i ślady)
    const victimCount = Math.floor(Math.random() * 3) + 2;
    for (let v = 0; v < victimCount; v++) {
      const isInside = v % 2 === 0;
      const angle = (v / victimCount) * 2 * Math.PI;
      const dist = 0.0006 + (v % 3) * 0.0004;
      const vLat = newCoords[0] + Math.sin(angle) * dist;
      const vLng = newCoords[1] + Math.cos(angle) * dist;
      const timer = 110 + Math.floor(Math.random() * 70);

      generatedMarkers.push({
        id: `M-VIC-${Date.now()}-${v + 1}`,
        type: isInside ? 'VICTIM' : 'VICTIM_OUTSIDE',
        sector: `SEKTOR ${v < 2 ? 'B' : 'C'}-${v + 1}`,
        coords: [vLat, vLng],
        label: isInside
          ? `Uwięziony pracownik w budynku (Wnętrze - ${v + 1} os.)`
          : `Poszkodowany w terenie otwartym (${v + 1} os.)`,
        details: isInside
          ? 'Poszkodowany w strefie bezpośredniego zadymienia. Brak widoczności optycznej ze ścian/stropów.'
          : 'Osoba odnaleziona na zewnątrz z objawami poparzeń dróg oddechowych. Wymaga natychmiastowej ewakuacji.',
        severity: isInside ? 'CRITICAL' : 'HIGH',
        trappedCount: isInside ? 2 : 1,
        status: isInside ? 'UNKNOWN' : 'OCZEKUJE_EWAKUACJI',
        isInsideBuilding: isInside,
        buildingId: isInside ? 'BLD-B4' : undefined,
        isDiscovered: !isInside, // poszkodowany wewnątrz ukryty do czasu wejścia/LiDAR/FLIR
        detectionMethod: isInside ? 'NONE' : 'OPTIC',
        timeLimitSeconds: timer,
        survivalSecondsLeft: timer,
        survivalTimer: timer,
      });
    }

    // Ślad terenowy (CLUE) ułatwiający poszukiwania dronami
    generatedMarkers.push({
      id: `M-CLUE-${Date.now()}`,
      type: 'CLUE',
      sector: 'SEKTOR B-2',
      coords: [newCoords[0] + 0.0003, newCoords[1] - 0.0006],
      label: 'Ślad terenowy: Porzucona odzież ochronna i latarka',
      details: 'Wskazuje możliwy kierunek ucieczki poszkodowanych ku zachodniemu wyjściu ewakuacyjnemu.',
      clueType: 'PERSONAL_ITEM',
      severity: 'MEDIUM',
    });

    // Zniszczenie strukturalne (STRUCTURAL_DAMAGE) blokujące drogę
    generatedMarkers.push({
      id: `M-DMG-${Date.now()}`,
      type: 'STRUCTURAL_DAMAGE',
      sector: 'SEKTOR B-1',
      coords: [newCoords[0] + 0.0006, newCoords[1] - 0.0002],
      label: 'Zawał ściany i rumowisko - blokada przejazdu',
      details: 'Gruzowisko uniemożliwia dojazd wozów bojowych. Wymagane obejście piesze liniami gaśniczymi (zasięg węża max 150m).',
      damageLevel: 'COLLAPSED_WALL',
      severity: 'HIGH',
    });

    // Ogniska pożaru lub strefa zagrożenia
    const fireCount = newThreatType === 'FIRE' ? 2 : 1;
    for (let f = 0; f < fireCount; f++) {
      const fLat = newCoords[0] + 0.0004 * (f + 1);
      const fLng = newCoords[1] + 0.0005 * (f + 1);
      generatedMarkers.push({
        id: `M-FIRE-${Date.now()}-${f + 1}`,
        type: newThreatType === 'HAZMAT' ? 'HAZMAT' : 'FIRE_ZONE',
        sector: `SEKTOR B-${f + 1}`,
        coords: [fLat, fLng],
        radiusMeters: 55 + f * 25,
        label: newThreatType === 'HAZMAT' ? `Strefa Wycieku Toksycznego #${f + 1}` : `Zarzewie Pożaru #${f + 1} (+${560 + f * 70}°C)`,
        details: `Aktywny front zagrożenia ${newName}. Wysoka emisja termiczna.`,
        severity: 'CRITICAL',
        temperature: 560 + f * 70,
      });
    }

    // Punkt krytyczny (np. zbiornik ciśnieniowy / chemia / zawał)
    generatedMarkers.push({
      id: `M-CRIT-${Date.now()}`,
      type: 'HAZMAT',
      sector: 'SEKTOR C-PUNKT-KRYTYCZNY',
      coords: [newCoords[0] - 0.0005, newCoords[1] + 0.0009],
      radiusMeters: 80,
      label: 'Punkt Krytyczny: Zbiornik Przemysłowy BLEVE',
      details: 'Bezpośrednie zagrożenie wybuchem odłamkowym w razie rozprzestrzenienia ognia.',
      severity: 'CRITICAL',
      status: 'WYMAGANE_CHŁODZENIE',
    });

    const initialHotSwaps: HotSwapStation[] = [
      {
        id: `HS-NEW-1`,
        name: 'Strefa Lądowania i Hot-Swap Baza KDR',
        coords: [newKdrCoords[0] - 0.0004, newKdrCoords[1] + 0.0006],
        radiusMeters: 35,
        availablePacks: 8,
        chargingPacks: 2,
        dronesInQueue: [],
      }
    ];

    // Generowanie siatki temperatury 10m x 10m dla strefy pożarowej
    const firstZone = newZones[0];
    const fireGridBounds: [[number, number], [number, number]] =
      firstZone?.polygon && firstZone.polygon.length >= 3
        ? computePolygonBounds(firstZone.polygon)
        : firstZone?.bounds || [
            [newCoords[0] - 0.0008, newCoords[1] - 0.0008],
            [newCoords[0] + 0.0008, newCoords[1] + 0.0008],
          ];
    const generatedFireGrid = generateFireGridForBounds(
      fireGridBounds,
      newThreatType === 'FIRE' ? 680 : 380,
      'SEKTOR B-4'
    );

    const initialAlerts: DecisionAlert[] = [];
    if (!hasHydrantAccess) {
      initialAlerts.push({
        id: `DA-NO-HYDRANT-${Date.now()}`,
        timestamp: '00:00:10',
        sector: 'LOGISTYKA WODNA',
        title: 'BRAK SIECI HYDRANTOWEJ W STREFIE OPERACYJNEJ',
        description: 'Zadeklarowano brak dostępu do hydrantów naziemnych. Wymagany natychmiastowy dowóz wody beczkowozami lub budowa bufora magistralnego.',
        severity: 'CRITICAL',
        recommendedAction: 'Zadysponować dodatkowe cysterny GCBA oraz wyznaczyć punkt czerpania wody z otwartego akwenu.',
        source: 'EDGE_AI',
        actionTaken: false,
      });
    }

    const createdIncident: Incident = {
      id: code,
      code,
      name: newName.trim(),
      threatType: newThreatType,
      status: 'ACTIVE',
      severity: newSeverity,
      locationName: newLocation.trim(),
      centerCoords: newCoords,
      kdrPosition: newKdrCoords,
      hasHydrantAccess,
      temperatureGrid: generatedFireGrid,
      createdAt: 'Teraz',
      commanderCallsign,
      assignedUnitsCount: newUnitsCount,
      description: newDescription.trim() || `Akcja ratownicza: ${newName}. Zadysponowano ${newUnitsCount} zastępów.`,
      tacticalMarkers: generatedMarkers,
      decisionAlerts: initialAlerts,
      hotSwapStations: initialHotSwaps,
      zones: newZones,
      weather: {
        windSpeedKmh: 18,
        windDirectionDeg: 225,
        windDirectionName: 'SW (Południowo-Zachodni)',
        temperatureC: 22,
        humidityPercent: 42,
      },
    };

    const updatedIncidents = [createdIncident, ...incidents];
    setIncidents(updatedIncidents);
    try {
      localStorage.setItem('tarcza_custom_incidents', JSON.stringify(updatedIncidents));
    } catch {}

    // Przejdź natychmiast do konfiguracji roju dla tej nowej akcji
    setSelectedIncidentForOnboarding(createdIncident);
  };

  // Launch dashboard with configured swarm
  const handleLaunchDashboardWithSwarm = () => {
    if (!selectedIncidentForOnboarding) return;

    // Utwórz obiekty telemetryczne tylko dla podłączonych dronów
    const activeTelemetry: DroneTelemetry[] = discoveredCandidates
      .filter((c) => connectedDroneIds.includes(c.id))
      .map((candidate, idx) =>
        createTelemetryFromCandidate(
          candidate,
          selectedIncidentForOnboarding.centerCoords,
          idx
        )
      );

    onLaunchIncident(selectedIncidentForOnboarding, activeTelemetry);
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* Header Centrum Operacyjnego */}
      <header className="w-full bg-zinc-950 border-b border-zinc-800 px-5 py-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-widest text-base font-mono text-zinc-100">
                TARCZA
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded bg-emerald-950/40">
                CENTRUM OPERACYJNE
              </span>
              <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 border border-zinc-700/60 px-1.5 py-0.5 rounded bg-zinc-900">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                TRYB: OCZEKIWANIE (STANDBY)
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-tight">
              Stanowisko Dowódcy: <b className="text-zinc-200 font-mono">{commanderCallsign}</b>
            </p>
          </div>
        </div>

        {/* Prawo: Procedury SOP, Kontakt i Wyloguj */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onOpenSop}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden sm:inline">Procedury SOP</span>
          </button>

          <button
            onClick={onOpenSupport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">Wsparcie</span>
          </button>

          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/50 rounded text-xs text-rose-300 hover:text-rose-100 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Wyloguj</span>
          </button>
        </div>
      </header>

      {/* Main Hub Body */}
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 lg:p-8 max-w-7xl mx-auto w-full">
        {/* Navigation Tabs between Join and Create */}
        <div className="flex items-center justify-between pb-4 mb-6 border-b border-zinc-800/80">
          <div>
            <h1 className="text-lg lg:text-xl font-bold font-mono text-zinc-100 tracking-wide">
              ZARZĄDZANIE INCYDENTAMI I ROJEM DRONÓW
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Wybierz zarejestrowaną akcję ratowniczą lub zainicjuj nową dyspozycję KDR.
            </p>
          </div>

          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
            <button
              onClick={() => setActiveTab('JOIN')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
                activeTab === 'JOIN'
                  ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
              <span>Aktywne Akcje ({incidents.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('CREATE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
                activeTab === 'CREATE'
                  ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Utwórz Nową Akcję</span>
            </button>
          </div>
        </div>

        {/* WIDOK 1: LISTA AKTYWNYCH INCYDENTÓW W REGIONIE */}
        {activeTab === 'JOIN' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {incidents.map((incident) => {
                let badgeColor = 'bg-rose-950/60 text-rose-300 border-rose-500/40';
                let Icon = Flame;

                if (incident.threatType === 'HAZMAT') {
                  badgeColor = 'bg-purple-950/60 text-purple-300 border-purple-500/40';
                  Icon = AlertTriangle;
                } else if (incident.threatType === 'SEARCH_RESCUE') {
                  badgeColor = 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40';
                  Icon = Compass;
                }

                return (
                  <div
                    key={incident.id}
                    className="p-5 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg flex flex-col justify-between transition-all shadow-md group"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${badgeColor} flex items-center gap-1`}>
                          <Icon className="w-3 h-3" />
                          <span>{incident.threatType} · {incident.severity}</span>
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{incident.createdAt}</span>
                        </span>
                      </div>

                      {/* Incident Title */}
                      <h3 className="font-semibold text-sm text-zinc-100 group-hover:text-emerald-400 transition-colors mb-2 leading-snug">
                        {incident.name}
                      </h3>

                      {/* Location */}
                      <div className="flex items-start gap-1.5 text-xs text-zinc-400 mb-3">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-1">{incident.locationName}</span>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 mb-4">
                        {incident.description}
                      </p>
                    </div>

                    {/* Footer Info & Action */}
                    <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                      <div className="text-[11px] font-mono text-zinc-500">
                        Siły PSP: <b className="text-zinc-300">{incident.assignedUnitsCount} zastępów</b>
                      </div>

                      <button
                        onClick={() => setSelectedIncidentForOnboarding(incident)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition-colors cursor-pointer shadow-xs"
                      >
                        <span>Konfiguruj Rój</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* WIDOK 2: FORMULARZ TWORZENIA NOWEJ AKCJI Z INTERAKTYWNĄ MAPĄ */}
        {activeTab === 'CREATE' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full flex-1 min-h-[580px]">
            {/* Lewa kolumna: Formularz danych */}
            <div className="lg:col-span-5 bg-zinc-900/60 border border-zinc-800 rounded-lg p-5 shadow-xl flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold font-mono uppercase text-zinc-200 mb-3 pb-2 border-b border-zinc-800 flex items-center justify-between">
                  <span>Parametry Nowej Dyspozycji</span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
                    KROK 1/2
                  </span>
                </h2>

                {formError && (
                  <div className="mb-3 p-2.5 bg-rose-950/40 border border-rose-500/50 rounded flex items-center gap-2 text-rose-300 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{formError}</span>
                  </div>
                )}

                <form id="create-incident-form" onSubmit={handleCreateIncidentSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                      Nazwa Akcji / Kryptonim Zdarzenia
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="np. Pożar Magazynu Logistycznego Hala 3"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                        Typ Zagrożenia
                      </label>
                      <select
                        value={newThreatType}
                        onChange={(e) => setNewThreatType(e.target.value as IncidentThreatType)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="FIRE">Pożar (FIRE)</option>
                        <option value="HAZMAT">Wyciek Chemiczny (HAZMAT)</option>
                        <option value="COLLAPSE">Katastrofa Budowlana (COLLAPSE)</option>
                        <option value="SEARCH_RESCUE">Poszukiwawczo-Ratownicza (SAR)</option>
                        <option value="FLOOD">Zagrożenie Powodziowe (FLOOD)</option>
                        <option value="TRANSPORT">Wypadek Komunikacyjny (TRANSPORT)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                        Poziom Pilności (Severity)
                      </label>
                      <select
                        value={newSeverity}
                        onChange={(e) => setNewSeverity(e.target.value as ThreatLevel)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="CRITICAL">KRYTYCZNY (Zagrożenie życia)</option>
                        <option value="HIGH">WYSOKI (Rozprzestrzenianie)</option>
                        <option value="MEDIUM">ŚREDNI (Standardowy)</option>
                        <option value="LOW">NISKI (Lokalny)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-mono uppercase text-zinc-400">
                        Lokalizacja / Adres Zdarzenia
                      </label>
                      <button
                        type="button"
                        onClick={handleDetectGps}
                        className="text-[10px] font-mono text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Compass className="w-3 h-3" />
                        <span>GPS</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      placeholder="np. Warszawa, ul. Towarowa 12 / Rejon Woli"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans"
                    />
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">
                      Współrzędne centrum: [{newCoords[0].toFixed(4)}, {newCoords[1].toFixed(4)}] (kliknij na mapie, aby zmienić)
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                      Wstępny Opis Sytuacji i Zadania KDR
                    </label>
                    <textarea
                      rows={3}
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Krótki meldunek sytuacyjny: rozwój pożaru, odcięci poszkodowani, zagrożenia w sąsiedztwie..."
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans resize-none"
                    />
                  </div>

                  {/* Dostęp do sieci hydrantowej (Logistyka Wody i Zaopatrzenia) */}
                  <div className="p-2.5 bg-zinc-950/70 border border-zinc-800 rounded">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasHydrantAccess}
                        onChange={(e) => setHasHydrantAccess(e.target.checked)}
                        className="accent-blue-500 rounded cursor-pointer"
                      />
                      <span className="text-xs font-mono font-semibold text-zinc-200">
                        Dostęp do sieci hydrantowej (TAK / NIE)
                      </span>
                    </label>
                    <p className="text-[10px] font-mono text-zinc-400 mt-1 pl-6">
                      {hasHydrantAccess
                        ? '✓ Sprawne hydranty naziemne DN100 / magistrala zakładowa.'
                        : '⚠️ BRAK HYDRANTU: Wymagany dowóz wody z beczkowozów / bufor rzeki.'}
                    </p>
                  </div>

                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1">
                    <div className="text-zinc-200 font-semibold flex items-center justify-between">
                      <span>Generowanie Skali Zdarzenia:</span>
                      <span className="text-emerald-400 font-bold">{newZones.length} zdefiniowanych stref</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      Po zatwierdzeniu system wygeneruje poszkodowanych (z podziałem na wnętrza budynków i teren otwarty), ogniska pożaru oraz punkty krytyczne.
                    </p>
                  </div>
                </form>
              </div>

              <div className="pt-3 border-t border-zinc-800">
                <button
                  type="submit"
                  form="create-incident-form"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium text-xs rounded transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Start Akcji i Przejdź do Konfiguracji Roju</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Prawa kolumna: Interaktywna Mapa Tworzenia Stref Taktycznych */}
            <div className="lg:col-span-7 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 shadow-xl flex flex-col h-[580px] lg:h-auto min-h-[500px]">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-mono font-bold uppercase text-zinc-200">
                    Interaktywna Mapa Taktyczna Zdarzenia (Zaznaczanie Stref)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  Użyj narzędzia do wyznaczania stref gorących / No-Fly
                </span>
              </div>

              <div className="flex-1 w-full h-full min-h-0 relative">
                <CreationMapDynamic
                  centerCoords={newCoords}
                  onCenterChange={(coords) => {
                    setNewCoords(coords);
                    if (!newLocation || newLocation.startsWith('Współrzędne') || newLocation.startsWith('Bieżąca')) {
                      setNewLocation(`Współrzędne mapy [${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`);
                    }
                  }}
                  kdrCoords={newKdrCoords}
                  onKdrChange={setNewKdrCoords}
                  zones={newZones}
                  onAddZone={(zone) => setNewZones((prev) => [...prev, zone])}
                  onRemoveZone={(zoneId) => setNewZones((prev) => prev.filter((z) => z.id !== zoneId))}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL / KROK ONBOARDINGU: KONFIGURACJA I PAROWANIE ROJU DRONÓW */}
      {selectedIncidentForOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Header Onboardingu */}
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <h2 className="font-bold text-sm font-mono text-zinc-100 uppercase tracking-wide">
                    Konfiguracja i Parowanie Roju Bezzałogowego
                  </h2>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Akcja: <b className="text-zinc-200">{selectedIncidentForOnboarding.name}</b> ({selectedIncidentForOnboarding.locationName})
                </p>
              </div>

              <button
                onClick={() => setSelectedIncidentForOnboarding(null)}
                className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 cursor-pointer"
              >
                Anuluj
              </button>
            </div>

            {/* Treść Onboardingu */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
              {/* Sekcja 1: Uprzednio sparowane jednostki (localStorage) */}
              <div className="p-3.5 bg-zinc-900/50 border border-zinc-800 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold font-mono text-zinc-200">
                      Uprzednio Sparowane Jednostki KDR
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Pamięć rejestru: {pairedDroneIds.length} jednostek
                  </span>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
                  Wykryto maszyny z zapisanym kluczem kryptograficznym w rejestrze stanowiska dowodzenia. Możesz podłączyć je jednym kliknięciem.
                </p>

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
                  <div className="text-[11px] font-mono text-emerald-400">
                    Podłączone do akcji: <b>{connectedDroneIds.length} z {discoveredCandidates.length}</b>
                  </div>

                  <button
                    onClick={handleQuickConnectAllPaired}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-medium transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Szybkie podłączenie wszystkich sparowanych</span>
                  </button>
                </div>
              </div>

              {/* Sekcja 2: Skanowanie pasm radiowych i parowanie nowych urządzeń */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <span className="font-semibold font-mono text-zinc-200">
                      Skanowanie Pasma Radiowego (868 MHz FHSS / 2.4 GHz Mesh)
                    </span>
                  </div>

                  <button
                    onClick={handleStartScanning}
                    disabled={isScanning}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-zinc-200 font-mono text-[11px] transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>{isScanning ? 'Skanowanie pasm...' : 'Skanuj urządzenia w pobliżu'}</span>
                  </button>
                </div>

                {/* Lista wykrytych dronów */}
                <div className="space-y-2">
                  {discoveredCandidates.map((drone) => {
                    const isConnected = connectedDroneIds.includes(drone.id);
                    const isPaired = pairedDroneIds.includes(drone.id);

                    return (
                      <div
                        key={drone.id}
                        className={`p-3 rounded-md border flex items-center justify-between transition-colors ${
                          isConnected
                            ? 'bg-emerald-950/20 border-emerald-500/50'
                            : 'bg-zinc-900/60 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isConnected}
                            onChange={() => handleToggleDroneConnection(drone.id)}
                            className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-zinc-100 text-xs">
                                {drone.callsign}
                              </span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-zinc-800 text-zinc-300 rounded">
                                {drone.model}
                              </span>
                              {isPaired && (
                                <span className="text-[9px] font-mono px-1 rounded bg-zinc-800 text-emerald-400 border border-emerald-500/30">
                                  ZAPAMIĘTANY
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-400 mt-1">
                              <span>Ładunek: <b className="text-zinc-200">{drone.payload}</b></span>
                              <span>Pasmo: <b className="text-zinc-200">{drone.frequencyBand}</b></span>
                              <span>Sygnał: <b className="text-cyan-400">{drone.signalRssi} dBm</b></span>
                              <span className="flex items-center gap-0.5">
                                <Battery className="w-3 h-3 text-emerald-400" />
                                <b>{drone.battery}%</b>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <button
                            onClick={() => handleToggleDroneConnection(drone.id)}
                            className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                              isConnected
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                            }`}
                          >
                            {isConnected ? 'Dołączony do Roju' : 'Paruj i Dołącz'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer z przyciskiem startu Dashboardu */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between">
              <div className="text-xs text-zinc-400">
                {connectedDroneIds.length === 0 ? (
                  <span className="text-amber-400">Uwaga: Brak podłączonych dronów. Na mapie będą widoczne jednostki naziemne.</span>
                ) : (
                  <span>Gotowych do startu: <b className="text-emerald-400">{connectedDroneIds.length} maszyny</b></span>
                )}
              </div>

              <button
                onClick={handleLaunchDashboardWithSwarm}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs transition-colors shadow-md cursor-pointer"
              >
                <span>Uruchom Pulpit Operacyjny KDR</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
