'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Incident,
  DroneTelemetry,
  HotSwapStation,
  TacticalMarker,
  DecisionAlert,
  TacticalZone,
  WeatherCondition,
  FireCell,
} from '@/types/tarcza';
import {
  OFFLINE_FACILITY_BUILDINGS,
  OFFLINE_WATER_BODIES,
  isPointInPolygon,
  DroneSpatialHash,
  generateFireGridForBounds,
  propagateFireGrid,
  MAX_HOSE_LENGTH_METERS,
  haversineDistanceMeters,
  expandFirePolygon,
  shrinkFirePolygon,
  computePolygonAreaM2,
  getPolygonCentroid,
  findRoadPath,
  findNearestWaterBody,
} from '@/lib/offline-maps-data';
import QuickActionModal from './QuickActionModal';
import DroneFeedModal from './DroneFeedModal';
import {
  Eye,
  Zap,
  Search,
  Users,
  Send,
  Bot,
  Video,
  Truck,
  CheckCircle2,
  BatteryCharging,
  SlidersHorizontal,
  LogOut,
  ArrowLeft,
  ShieldAlert,
  Clock,
  AlertTriangle,
  Wind,
  Flame,
  PlusCircle,
  Building,
} from 'lucide-react';

const TacticalMicroMapDynamic = dynamic(
  () => import('./TacticalMicroMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-xs">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
          <span>Inicjalizacja mikro-mapy taktycznej...</span>
        </div>
      </div>
    ),
  }
);

// Krok 4: Generator Dynamicznych Jednostek Zewnętrznych (External Swarm)
function generateExternalSupport(incident: Incident): DroneTelemetry[] {
  const count = (incident.severity === 'CRITICAL' ? 5 : 2) + Math.floor(Math.random() * 3);
  const units: DroneTelemetry[] = [];
  const agencies = ['PSP', 'OSP', 'WOPR', 'SG'];

  for (let i = 0; i < count; i++) {
    const agency = agencies[i % agencies.length];
    const numStr = (i + 1).toString().padStart(2, '0');
    const callsign = `EXT-${agency}-${numStr}`;

    const angle = (i / count) * 2 * Math.PI + Math.random() * 0.25;
    const offsetLat = Math.sin(angle) * (0.0035 + (i % 2) * 0.0008);
    const offsetLng = Math.cos(angle) * (0.0045 + (i % 2) * 0.0008);

    const initialCoords: [number, number] = [
      incident.centerCoords[0] + offsetLat,
      incident.centerCoords[1] + offsetLng,
    ];

    const wp: [number, number] = [
      incident.centerCoords[0] + Math.sin(angle + 1.2) * 0.0038,
      incident.centerCoords[1] + Math.cos(angle + 1.2) * 0.0046,
    ];

    units.push({
      id: `DRON-EXT-${i + 1}`,
      callsign,
      model: 'Patrol-UAV Eksternalny (Wsparcie Zewnętrzne)',
      battery: 82 + Math.floor(Math.random() * 18),
      altitude: 45 + i * 4,
      speed: 38,
      status: 'PATROL',
      coords: initialCoords,
      vector: { dLat: 0.0001, dLng: -0.0001 },
      payload: i % 2 === 0 ? 'THERMAL_FLIR' : 'LIDAR_STRUCTURAL',
      pairingStatus: 'CONNECTED',
      isPaired: false,
      isExternalSupport: true,
      targetWaypoint: wp,
      hoverDurationRemaining: 0,
      headingDeg: Math.round((angle * 180) / Math.PI),
    });
  }

  return units;
}

interface DashboardScreenProps {
  commanderCallsign?: string;
  incident: Incident;
  initialDrones?: DroneTelemetry[];
  onBackToHub: () => void;
  onLogout?: () => void;
  onOpenSop?: () => void;
  onOpenSupport?: () => void;
}

export default function DashboardScreen({
  commanderCallsign = 'KDR-WOLIN-04',
  incident,
  initialDrones = [],
  onBackToHub,
  onLogout,
}: DashboardScreenProps) {
  // Operational Tabs: Rozpoznanie, Ewakuacja, Zarządzanie Rojem, Logistyka
  const [activeTab, setActiveTab] = useState<'RECON' | 'EVACUATION' | 'SWARM' | 'LOGISTICS'>('RECON');

  // Resizable Splitter State (Range: 25% - 75%, double click resets to 35%)
  const [leftPanelPercent, setLeftPanelPercent] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tarcza_dashboard_splitter_pct');
        if (saved) {
          const val = parseFloat(saved);
          if (val >= 25 && val <= 75) return val;
        }
      } catch {}
    }
    return 35;
  });
  const isDraggingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Krok 4: Initialize Drones with Paired Fleet + Dynamic External Support Swarm
  const [drones, setDrones] = useState<DroneTelemetry[]>(() => {
    const externalUnits = generateExternalSupport(incident);
    return [...initialDrones, ...externalUnits];
  });

  const [hotSwapStations, setHotSwapStations] = useState<HotSwapStation[]>(incident.hotSwapStations);

  // Markers initialized with survival countdown timers (Krok 2)
  const [markers, setMarkers] = useState<TacticalMarker[]>(() =>
    incident.tacticalMarkers.map((m) => {
      if (m.type === 'VICTIM' && m.severity === 'CRITICAL' && !m.survivalSecondsLeft) {
        return {
          ...m,
          timeLimitSeconds: 120,
          survivalSecondsLeft: 120,
        };
      }
      return m;
    })
  );

  const [alerts, setAlerts] = useState<DecisionAlert[]>(incident.decisionAlerts);

  // Moduł 3: Stan Warunków Atmosferycznych (Wiatr, Kierunek, Temperatura)
  const [weather, setWeather] = useState<WeatherCondition>(
    incident.weather || {
      windSpeedKmh: 18,
      windDirectionDeg: 225,
      windDirectionName: 'SW (Południowo-Zachodni)',
      temperatureC: 22,
      humidityPercent: 42,
    }
  );

  // Moduł 2: Siatka Temperatury Pożaru 10m x 10m (Heatmapa Całopowierzchniowa)
  const [temperatureGrid, setTemperatureGrid] = useState<FireCell[]>(() => {
    if (incident.temperatureGrid && incident.temperatureGrid.length > 0) {
      return incident.temperatureGrid;
    }
    return generateFireGridForBounds(
      incident.zones?.[0]?.bounds || [
        [incident.centerCoords[0] - 0.0008, incident.centerCoords[1] - 0.0008],
        [incident.centerCoords[0] + 0.0008, incident.centerCoords[1] + 0.0008],
      ],
      680,
      'SEKTOR B-4'
    );
  });

  // Moduł 3: Analiza Strukturalna (Drone Assessment) - Ryzyko Zawalenia Stropów
  const [buildingDecayRisks, setBuildingDecayRisks] = useState<Record<string, number>>({
    'BLD-B4': 42,
    'BLD-C2': 28,
    'BLD-A1': 5,
    'BLD-D1': 0,
  });
  const hasTriggeredCollapseAlertRef = useRef<boolean>(false);

  // Strefy operacyjne incydentu
  const [incidentZones, setIncidentZones] = useState<TacticalZone[]>(incident.zones || []);

  // Moduł 4: Onboarding Nowej Jednostki Dojeżdżającej (PSP / OSP / ZRM)
  const [isOnboardingUnitOpen, setIsOnboardingUnitOpen] = useState<boolean>(false);
  const [newUnitCallsign, setNewUnitCallsign] = useState<string>('GCBA-5/32 OSP Ożarów');
  const [newUnitType, setNewUnitType] = useState<'PSP_GBA' | 'PSP_GCBA' | 'OSP' | 'ZRM'>('PSP_GCBA');
  const [newUnitWater, setNewUnitWater] = useState<number>(5000);
  const [newUnitCrew, setNewUnitCrew] = useState<number>(4);
  const [newUnitZone, setNewUnitZone] = useState<string>('Odcinek Bojowy nr 2 (Kurtyny Wodne)');
  const [selectedFriendlyUnit, setSelectedFriendlyUnit] = useState<TacticalMarker | null>(null);

  // Map Controls
  const [mapCenterCoords, setMapCenterCoords] = useState<[number, number]>(incident.centerCoords);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [isDrawingHotSwap, setIsDrawingHotSwap] = useState<boolean>(false);
  const [activeEvacuationRoute, setActiveEvacuationRoute] = useState<string | null>(incident.suggestedEvacuationCorridor ? 'K-1' : null);

  // Active Layers Toggles
  const [activeLayers, setActiveLayers] = useState({
    victims: true,
    fires: true,
    drones: true,
    friendlyUnits: true,
    hotSwapZones: true,
    sectors: true,
  });
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);

  // Modals
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [selectedDroneForFeed, setSelectedDroneForFeed] = useState<DroneTelemetry | null>(null);

  // Tactical Assistant Text Input & Messages
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAssistantLogs, setAiAssistantLogs] = useState<Array<{ role: 'user' | 'assistant'; text: string; time: string }>>([
    {
      role: 'assistant',
      text: `Stanowisko dowodzenia KDR aktywne dla akcji: ${incident.name}. Zintegrowano ${initialDrones.length} maszyn własnych oraz jednostki wsparcia obwodowego. Aktywne procedury krytyczne.`,
      time: '00:01',
    },
  ]);

  // Keyboard shortcut Ctrl+K / Cmd+K for Quick Action
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsQuickActionOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Synchronizowane referencje do stanu symulacji dla uniknięcia resetowania pętli
  const dronesRef = useRef(drones);
  const weatherRef = useRef(weather);
  const markersRef = useRef(markers);
  const incidentZonesRef = useRef(incidentZones);
  const temperatureGridRef = useRef(temperatureGrid);

  useEffect(() => {
    dronesRef.current = drones;
    weatherRef.current = weather;
    markersRef.current = markers;
    incidentZonesRef.current = incidentZones;
    temperatureGridRef.current = temperatureGrid;
  }, [drones, weather, markers, incidentZones, temperatureGrid]);

  // KROK 2 & MODUŁ 1, 2, 3: ZSYNCHRONIZOWANY SILNIK SYMULACJI OPERACYJNEJ (Live-Action Simulation Loop)
  useEffect(() => {
    let tickCount = 0;

    const simulationInterval = setInterval(() => {
      tickCount += 1;
      const curWeather = weatherRef.current;
      const curDrones = dronesRef.current;

      // --- NOWOŚĆ: AUTOMATYCZNE PRZYBYWANIE JEDNOSTEK (Co ok. 35 sekund) ---
      if (tickCount % 35 === 0) {
        setMarkers((prevMarkers) => {
          const currentUnitsCount = prevMarkers.filter((m) => m.type === 'FRIENDLY_UNIT').length;
          // Limitujemy do max 15 jednostek na mapie, żeby nie zrobić tłoku
          if (currentUnitsCount < 15) {
            const gateCoords: [number, number] = [52.2100, 20.7890];
            const fireZones = incidentZonesRef.current.filter((z) => z.type === 'DANGER_ZONE' && !z.isExtinguished);

            // Domyślny cel - sztab, chyba że jest pożar, to jedzie w pobliże pożaru
            let targetCoords: [number, number] = [52.2108, 20.7895];
            if (fireZones.length > 0) {
              const centroid = getPolygonCentroid(fireZones[0].polygon);
              targetCoords = [centroid[0] - 0.0008, centroid[1] - 0.0008]; // Odległość bezpieczna
            }

            const roadPath = findRoadPath(gateCoords, targetCoords);
            const callsignId = Math.floor(10 + Math.random() * 90);
            const isOsp = Math.random() > 0.5;

            const newUnit: TacticalMarker = {
              id: `UNIT-AUTO-${Date.now()}`,
              type: 'FRIENDLY_UNIT',
              sector: 'SEKTOR A-3',
              coords: gateCoords,
              label: isOsp ? `OSP-${callsignId} (Wsparcie)` : `JRG-${callsignId} (Zastęp)`,
              details: 'Jednostka zadysponowana automatycznie z rejonu operacyjnego.',
              status: 'jednostka w drodze na miejsce zdarzenia',
              currentTask: 'FIRE_FIGHTING',
              unitStatus: 'ON_ROUTE',
              navigationPath: roadPath,
              waterLevel: 100,
              crewCount: isOsp ? 6 : 4,
              reportStatus: 'Wjazd na teren akcji. Udaję się na wyznaczony odcinek bojowy.',
            };

            setAiAssistantLogs((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `WSPARCIE ZEWNĘTRZNE: Zastęp ${newUnit.label} przybył na miejsce akcji i dołącza do natarcia.`,
                time: new Date().toLocaleTimeString().slice(0, 5),
              },
            ]);

            return [...prevMarkers, newUnit];
          }
          return prevMarkers;
        });
      }

      // 1. Occlusion & Visibility Discovery System + Liczniki Przeżycia + Nawigacja Drogowa Jednostek
      setMarkers((prevMarkers) => {
        const buildingsWithFriendly = OFFLINE_FACILITY_BUILDINGS.filter((bld) =>
          prevMarkers.some(
            (m) =>
              m.type === 'FRIENDLY_UNIT' &&
              (isPointInPolygon(m.coords, bld.polygon) || m.unitStatus === 'INSIDE_BUILDING' || m.insideBuildingId === bld.id)
          )
        ).map((b) => b.id);

        let discoveredNotice: string | null = null;
        let evacuatedVictimIdToRemove: string | null = null;

        const movedMarkers = prevMarkers.map((marker) => {
          if (marker.type === 'FRIENDLY_UNIT' && marker.navigationPath && marker.navigationPath.length > 0) {
            const path = [...marker.navigationPath];
            const nextWaypoint = path[0];
            const dist = haversineDistanceMeters(marker.coords, nextWaypoint);

            if (dist < 5) {
              path.shift();
              if (path.length === 0) {
                // Wejście do obiektu przy ewakuacji
                const targetBld = OFFLINE_FACILITY_BUILDINGS.find((bld) =>
                  isPointInPolygon(marker.coords, bld.polygon) ||
                  bld.entrances.some((e) => haversineDistanceMeters(marker.coords, e.coords) < 22)
                );
                if (targetBld && marker.currentTask === 'EVACUATION') {
                  return {
                    ...marker,
                    navigationPath: undefined,
                    unitStatus: 'INSIDE_BUILDING' as const,
                    insideBuildingId: targetBld.id,
                    status: `WEJŚCIE DO OBIEKTU (${targetBld.name})`,
                    reportStatus: `Rota ratownicza weszła do obiektu ${targetBld.name} w aparatach ODO. Trwa lokalizacja poszkodowanych.`,
                  };
                }

                // Dotarcie do TRIAGE z poszkodowanym
                const isAtTriage = haversineDistanceMeters(marker.coords, [52.2140, 20.7910]) < 45;
                if (isAtTriage && marker.targetMarkerId) {
                  evacuatedVictimIdToRemove = marker.targetMarkerId;
                  return {
                    ...marker,
                    navigationPath: undefined,
                    targetMarkerId: undefined,
                    currentTask: 'STANDBY' as const,
                    unitStatus: 'STANDBY' as const,
                    status: 'W PUNKCIE TRIAGE (GOTOWOŚĆ BOJOWA)',
                    reportStatus: 'Poszkodowani przekazani ZRM. Rota ratownicza w pełnej gotowości.',
                  };
                }

                if (marker.currentTask === 'FIRE_FIGHTING') {
                  return {
                    ...marker,
                    navigationPath: undefined,
                    unitStatus: 'EXTINGUISHING' as const,
                    status: 'NATARCIE GAŚNICZE (DZIAŁANIE)',
                    reportStatus: 'Osiągnięto pozycję. Trwa gaszenie frontu pożaru.',
                  };
                }
                return {
                  ...marker,
                  navigationPath: undefined,
                  unitStatus: 'STANDBY' as const,
                  status: 'W PUNKCIE ZBORNM (GOTOWOŚĆ BOJOWA)',
                };
              }
            } else {
              const step = 0.32;
              const nextCoords: [number, number] = [
                marker.coords[0] + (nextWaypoint[0] - marker.coords[0]) * step,
                marker.coords[1] + (nextWaypoint[1] - marker.coords[1]) * step,
              ];
              return {
                ...marker,
                coords: nextCoords,
                navigationPath: path,
              };
            }
          }
          return marker;
        });

        // Detekcja poszkodowanych
        const updated = movedMarkers.map((marker) => {
          if (marker.type === 'VICTIM') {
            let newlyDiscovered = false;
            let method = marker.detectionMethod || 'NONE';

            if (!marker.isDiscovered) {
              const detectingDrone = curDrones.find((d) => {
                const dist = haversineDistanceMeters(d.coords, marker.coords);
                return dist < 35 && (d.payload === 'THERMAL_FLIR' || d.payload === 'LIDAR_STRUCTURAL');
              });
              if (detectingDrone) {
                newlyDiscovered = true;
                method = detectingDrone.payload === 'THERMAL_FLIR' ? 'FLIR' : 'LIDAR';
              }
            }

            if (newlyDiscovered) {
              discoveredNotice = `DETEKCJA SENSORA (${method}): Zlokalizowano uwięzionych poszkodowanych w ${marker.sector}!`;
              return { ...marker, isDiscovered: true, detectionMethod: method as any, status: 'OCZEKUJE_EWAKUACJI' };
            }
          }
          return marker;
        });

        if (discoveredNotice) {
          setAiAssistantLogs((prev) => [...prev, { role: 'assistant', text: discoveredNotice!, time: new Date().toLocaleTimeString().slice(0, 5) }]);
        }

        if (evacuatedVictimIdToRemove) {
          return updated.filter((m) => m.id !== evacuatedVictimIdToRemove);
        }

        return updated.filter(
          (m) =>
            !(
              (m.type === 'VICTIM' || m.type === 'VICTIM_OUTSIDE') &&
              (m.status === 'EWAKUOWANY' || m.status === 'URATOWANY' || m.status === 'URATOWANI')
            )
        );
      });

      // 2. DYNAMICZNA REDUKCJA ZAGROŻENIA (Wpływ strażaków na ogień)
      setTemperatureGrid((prevGrid) => {
        const latestMarkers = markersRef.current;
        const extinguishingUnits = latestMarkers.filter(
          (m) => m.type === 'FRIENDLY_UNIT' && m.unitStatus === 'EXTINGUISHING'
        );

        let gridChanged = false;
        const nextGrid = prevGrid.map((cell) => {
          if (cell.isExtinguished && cell.temperature <= 40) return cell;

          const affectingUnits = extinguishingUnits.filter((u) => haversineDistanceMeters(u.coords, cell.coords) < 85); // Zwiększony zasięg węża

          if (affectingUnits.length > 0) {
            gridChanged = true;
            const totalCooling = affectingUnits.length * 25; // Szybsze gaszenie
            const newTemp = Math.max(20, cell.temperature - totalCooling);

            return {
              ...cell,
              temperature: Math.round(newTemp),
              isExtinguished: newTemp < 150,
              intensity: Math.max(0, (newTemp - 150) / 750),
              fuelRemaining: Math.max(0, cell.fuelRemaining - 0.5),
            };
          }
          return cell;
        });

        return gridChanged ? nextGrid : prevGrid;
      });

      // --- NOWOŚĆ: DYNAMIKA POŻARU CO 15 SEKUND & RUCH STRAŻAKÓW ---
      if (tickCount % 15 === 0) {
        setIncidentZones((prevZones) => {
          const latestMarkers = markersRef.current;
          let hasZoneUpdates = false;

          const updatedZones = prevZones.map((zone) => {
            if (zone.type !== 'DANGER_ZONE' || zone.isExtinguished) return zone;

            const activeFightingUnits = latestMarkers.filter(
              (m) => m.type === 'FRIENDLY_UNIT' && (m.unitStatus === 'EXTINGUISHING' || m.currentTask === 'FIRE_FIGHTING')
            );

            hasZoneUpdates = true;

            if (activeFightingUnits.length > 0) {
              // STRAŻACY GASZĄ -> POŻAR SIĘ KURCZY
              const newPoly = shrinkFirePolygon(zone.polygon, 0.12);
              const newArea = computePolygonAreaM2(newPoly);

              // Strażacy "gonią" kurczący się pożar (podchodzą bliżej)
              setMarkers((prevM) =>
                prevM.map((m) => {
                  if (m.type === 'FRIENDLY_UNIT' && m.unitStatus === 'EXTINGUISHING') {
                    const centroid = getPolygonCentroid(newPoly);
                    // Strażak podchodzi na 40 metrów do nowego środka pożaru
                    const angle = Math.atan2(m.coords[1] - centroid[1], m.coords[0] - centroid[0]);
                    const newCoords: [number, number] = [
                      centroid[0] + Math.cos(angle) * 0.0004,
                      centroid[1] + Math.sin(angle) * 0.0004,
                    ];
                    return { ...m, navigationPath: [newCoords], unitStatus: 'ON_ROUTE' };
                  }
                  return m;
                })
              );

              if (newArea < 80) {
                return { ...zone, isExtinguished: true, areaM2: 0, color: '#10b981' };
              }
              return { ...zone, polygon: newPoly, areaM2: newArea };
            } else {
              // BRAK STRAŻAKÓW -> POŻAR ROŚNIE
              const newPoly = expandFirePolygon(zone.polygon, 0.06, curWeather.windDirectionDeg, curWeather.windSpeedKmh);
              const newArea = computePolygonAreaM2(newPoly);

              // Jeśli strażacy są zbyt blisko rosnącego pożaru, wycofują się
              setMarkers((prevM) =>
                prevM.map((m) => {
                  if (m.type === 'FRIENDLY_UNIT' && m.currentTask === 'FIRE_FIGHTING') {
                    const centroid = getPolygonCentroid(newPoly);
                    const dist = haversineDistanceMeters(m.coords, centroid);
                    if (dist < 30) {
                      // Zbyt blisko!
                      const angle = Math.atan2(m.coords[1] - centroid[1], m.coords[0] - centroid[0]);
                      const retreatCoords: [number, number] = [
                        m.coords[0] + Math.cos(angle) * 0.0008,
                        m.coords[1] + Math.sin(angle) * 0.0008,
                      ];
                      return {
                        ...m,
                        navigationPath: [retreatCoords],
                        unitStatus: 'ON_ROUTE',
                        reportStatus: 'Wycofanie taktyczne przed rosnącym frontem!',
                      };
                    }
                  }
                  return m;
                })
              );

              return { ...zone, polygon: newPoly, areaM2: newArea };
            }
          });

          return hasZoneUpdates ? updatedZones : prevZones;
        });

        // Naturalna propagacja siatki temperatury z wiatrem
        setTemperatureGrid((prevGrid) => propagateFireGrid(prevGrid, curWeather.windDirectionDeg, curWeather.windSpeedKmh));
      }
    }, 1000);

    return () => clearInterval(simulationInterval);
  }, []);

  // MODUŁ 2: FIZYKA ROJU I INTELIGENTNE DRONY (Szukają pożaru i ludzi)
  useEffect(() => {
    if (drones.length === 0) return;

    const interval = setInterval(() => {
      setDrones((prevDrones) =>
        prevDrones.map((drone) => {
          const isLowBattery = drone.battery < 25 || drone.status === 'BATTERY_CRITICAL' || drone.status === 'RETURNING_HOTSWAP';

          // Logika powrotu do bazy na ładowanie
          if (isLowBattery && hotSwapStations.length > 0) {
            let nearestStation = hotSwapStations[0];
            let minDistance = Infinity;
            hotSwapStations.forEach((hs) => {
              const dist = haversineDistanceMeters(drone.coords, hs.coords);
              if (dist < minDistance) {
                minDistance = dist;
                nearestStation = hs;
              }
            });

            if (minDistance < 20) {
              return {
                ...drone,
                battery: 100,
                status: 'PATROL',
                coords: [...nearestStation.coords],
                assignedHotSwapId: undefined,
                targetWaypoint: undefined,
                speed: 34,
              };
            }

            const dLat = nearestStation.coords[0] - drone.coords[0];
            const dLng = nearestStation.coords[1] - drone.coords[1];
            const totalDiff = Math.hypot(dLat, dLng);
            const step = 0.00016;

            return {
              ...drone,
              status: drone.battery < 20 ? 'BATTERY_CRITICAL' : 'RETURNING_HOTSWAP',
              coords: [drone.coords[0] + (dLat / totalDiff) * step, drone.coords[1] + (dLng / totalDiff) * step],
              battery: Math.max(4, drone.battery - 0.04),
            };
          }

          // --- NOWOŚĆ: INTELIGENTNE WYZNACZANIE CELU DLA DRONA ---
          let currentTarget = drone.targetWaypoint;

          // Dron decyduje co robić co kilka sekund lub gdy nie ma celu
          if (!currentTarget || Math.random() < 0.05) {
            const undiscoveredVictims = markersRef.current.filter((m) => m.type === 'VICTIM' && !m.isDiscovered);
            const hotCells = temperatureGridRef.current.filter((c) => c.temperature > 300 && !c.isExtinguished);

            if (undiscoveredVictims.length > 0 && drone.payload !== 'FIRST_AID_DROP') {
              // Priorytet 1: Szukaj ludzi (Leci w stronę markera z lekkim odchyleniem by symulować szukanie)
              const v = undiscoveredVictims[0];
              currentTarget = [v.coords[0] + (Math.random() - 0.5) * 0.0005, v.coords[1] + (Math.random() - 0.5) * 0.0005];
            } else if (hotCells.length > 0) {
              // Priorytet 2: Monitoruj pożar (Wybiera jedną z najgorętszych komórek)
              const targetCell = hotCells[Math.floor(Math.random() * Math.min(5, hotCells.length))];
              currentTarget = [targetCell.coords[0] + (Math.random() - 0.5) * 0.0002, targetCell.coords[1] + (Math.random() - 0.5) * 0.0002];
            } else {
              // Priorytet 3: Zwykły patrol wokół centrum
              currentTarget = [
                incident.centerCoords[0] + (Math.random() - 0.5) * 0.004,
                incident.centerCoords[1] + (Math.random() - 0.5) * 0.004,
              ];
            }
          }

          if (drone.status === 'HOVERING') {
            const remainingHover = drone.hoverDurationRemaining ?? 0;
            if (remainingHover > 1) {
              return { ...drone, hoverDurationRemaining: remainingHover - 1, speed: 0, battery: Math.max(5, drone.battery - 0.02) };
            }
            return { ...drone, status: 'PATROL', targetWaypoint: undefined, hoverDurationRemaining: 0, speed: 36 };
          }

          const distToWaypoint = haversineDistanceMeters(drone.coords, currentTarget);
          if (distToWaypoint < 14) {
            return { ...drone, status: 'HOVERING', hoverDurationRemaining: 3, speed: 0, battery: Math.max(5, drone.battery - 0.02) };
          }

          const dLat = currentTarget[0] - drone.coords[0];
          const dLng = currentTarget[1] - drone.coords[1];
          const distDegrees = Math.hypot(dLat, dLng) || 0.0001;
          const stepDegrees = Math.min(distDegrees, 0.00014);
          const ratio = stepDegrees / distDegrees;

          const newLat = drone.coords[0] + dLat * ratio;
          const newLng = drone.coords[1] + dLng * ratio;
          const heading = Math.round(((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360);

          return {
            ...drone,
            status: 'PATROL',
            coords: [newLat, newLng],
            targetWaypoint: currentTarget,
            headingDeg: heading,
            speed: Math.round(36 + Math.random() * 8),
            battery: Math.max(5, drone.battery - 0.03),
          };
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [drones.length, hotSwapStations, incident.centerCoords]);

  // Splitter Drag Handlers (25% - 75%)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newPercent = ((e.clientX - rect.left) / rect.width) * 100;
    if (newPercent >= 25 && newPercent <= 75) {
      setLeftPanelPercent(newPercent);
      try {
        localStorage.setItem('tarcza_dashboard_splitter_pct', newPercent.toString());
      } catch {}
      window.dispatchEvent(new Event('resize'));
    }
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.dispatchEvent(new Event('resize'));
  };

  const handleResetSplitter = () => {
    setLeftPanelPercent(35);
    try {
      localStorage.setItem('tarcza_dashboard_splitter_pct', '35');
    } catch {}
    window.dispatchEvent(new Event('resize'));
  };

  // Force Drone to Return to Hot-Swap
  const handleForceReturnDrone = (droneId: string) => {
    setDrones((prev) =>
      prev.map((d) =>
        d.id === droneId
          ? {
              ...d,
              status: 'RETURNING_HOTSWAP',
            }
          : d
      )
    );

    const targetDrone = drones.find((d) => d.id === droneId);
    const newLog = {
      role: 'assistant' as const,
      text: `ROZKAZ PRZYJĘTY: Dron ${targetDrone?.callsign || droneId} został skierowany do natychmiastowego lądowania w najbliższej strefie Hot-Swap.`,
      time: new Date().toLocaleTimeString().slice(0, 5),
    };
    setAiAssistantLogs((prev) => [...prev, newLog]);
  };

  // Add newly drawn hot swap station
  const handleFinishDrawingHotSwap = (newStation: HotSwapStation) => {
    setHotSwapStations((prev) => [...prev, newStation]);
    setIsDrawingHotSwap(false);

    const newLog = {
      role: 'assistant' as const,
      text: `ZATWIERDZONO NOWĄ STREFĘ HOT-SWAP: ${newStation.name}. Uwzględniono w siatce autonomicznego lądowania roju.`,
      time: new Date().toLocaleTimeString().slice(0, 5),
    };
    setAiAssistantLogs((prev) => [...prev, newLog]);
  };

  // Usunięcie strefy przez KDR
  const handleRemoveZone = useCallback((zoneId: string) => {
    setIncidentZones((prev) => prev.filter((z) => z.id !== zoneId));
    setAiAssistantLogs((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: `USUNIĘTO STREFĘ: Zniesiono wyznaczoną strefę operacyjną. Jednostki wznowiły standardowy reżim.`,
        time: new Date().toLocaleTimeString().slice(0, 5),
      },
    ]);
  }, []);

  // Podłączenie jednostki do zbiornika wodnego (nieskończony zasób wody)
  const handleConnectUnitToWater = useCallback((unitId: string, waterBodyId: string) => {
    const wb = OFFLINE_WATER_BODIES.find((w) => w.id === waterBodyId) || OFFLINE_WATER_BODIES[0];

    setMarkers((prevMarkers) => {
      const unit = prevMarkers.find((m) => m.id === unitId);
      if (!unit) return prevMarkers;

      const path = findRoadPath(unit.coords, wb.coords);

      setAiAssistantLogs((prevLogs) => [
        ...prevLogs,
        {
          role: 'assistant',
          text: `ROZKAZ DLA ${unit.label}: Przejazd korytarzem drogowym do ${wb.name}. Rozwinięcie linii ssawnej — zasilanie wodne 100% nieograniczone!`,
          time: new Date().toLocaleTimeString().slice(0, 5),
        },
      ]);

      return prevMarkers.map((m) => {
        if (m.id === unitId) {
          return {
            ...m,
            navigationPath: path,
            hasInfiniteWaterSupply: true,
            connectedWaterSourceId: wb.id,
            waterLevel: 100,
            unitStatus: 'WATER_PUMPING' as const,
            currentTask: 'STANDBY' as const,
            status: 'DOJAZD DO ZBIORNIKA WODNEGO',
            reportStatus: `Budowa punktu czerpania wody przy ${wb.name}.`,
          };
        }
        return m;
      });
    });
  }, []);

  // MODUŁ 4: Polecenia dla Oddziałów z Logiką Dróg (GASZENIE / EWAKUACJA / RAPORT)
  const handleUnitCommand = useCallback(
    (markerId: string, cmd: 'FIRE_FIGHTING' | 'EVACUATION' | 'REPORT' | 'STANDBY') => {
      setMarkers((prevMarkers) => {
        const targetUnit = prevMarkers.find((m) => m.id === markerId);
        if (!targetUnit) return prevMarkers;

        if (cmd === 'FIRE_FIGHTING') {
          // Szukaj strefy pożaru lub markera
          const activeDangerZone = incidentZones.find((z) => z.type === 'DANGER_ZONE' && !z.isExtinguished);
          const fireMarker = prevMarkers.find((m) => m.type === 'FIRE_ZONE');

          let targetCoords: [number, number];
          if (activeDangerZone && activeDangerZone.polygon.length >= 3) {
            targetCoords = getPolygonCentroid(activeDangerZone.polygon);
          } else if (fireMarker) {
            targetCoords = [fireMarker.coords[0] - 0.0002, fireMarker.coords[1] - 0.0002];
          } else {
            targetCoords = [targetUnit.coords[0] + 0.0004, targetUnit.coords[1] + 0.0004];
          }

          // Trasa drogowa omijająca bryły budynków
          const roadPath = findRoadPath(targetUnit.coords, targetCoords);

          setAiAssistantLogs((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `ROZKAZ DLA ${targetUnit.label}: ZADANIE: GASZENIE. Jednostka przemieszcza się wyznaczonymi drogami do strefy pożaru.`,
              time: new Date().toLocaleTimeString().slice(0, 5),
            },
          ]);

          return prevMarkers.map((m) => {
            if (m.id === markerId) {
              return {
                ...m,
                navigationPath: roadPath,
                currentTask: 'FIRE_FIGHTING',
                unitStatus: 'ON_ROUTE' as const,
                status: 'jednostka w drodze na miejsce zdarzenia',
                reportStatus: 'Zadysponowano do natarcia gaśniczego. Nawigacja korytarzami drogowymi do strefy pożaru.',
              };
            }
            return m;
          });
        } else if (cmd === 'EVACUATION') {
          const victim = prevMarkers.find((m) => (m.type === 'VICTIM' || m.type === 'VICTIM_OUTSIDE') && m.status !== 'EWAKUOWANY' && m.status !== 'URATOWANY');
          if (!victim) {
            setAiAssistantLogs((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `KOMUNIKAT DLA ${targetUnit.label}: Brak oczekujących poszkodowanych w strefie operacyjnej!`,
                time: new Date().toLocaleTimeString().slice(0, 5),
              },
            ]);
            return prevMarkers;
          }

          let targetCoords = victim.coords;
          if (victim.isInsideBuilding && victim.buildingId) {
            const bld = OFFLINE_FACILITY_BUILDINGS.find((b) => b.id === victim.buildingId);
            if (bld && bld.entrances.length > 0) {
              targetCoords = bld.entrances[0].coords;
            }
          }

          const roadPath = findRoadPath(targetUnit.coords, targetCoords);
          setActiveEvacuationRoute('K-1');

          setAiAssistantLogs((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `ROZKAZ DLA ${targetUnit.label}: ZADANIE: KORYTARZ EWAKUACYJNY. Rota ratownicza w drodze na miejsce zdarzenia (${victim.isInsideBuilding ? 'wejście do obiektu kubaturowego' : 'strefa poszkodowanych'}).`,
              time: new Date().toLocaleTimeString().slice(0, 5),
            },
          ]);

          return prevMarkers.map((m) => {
            if (m.id === markerId) {
              return {
                ...m,
                navigationPath: roadPath,
                targetMarkerId: victim.id,
                currentTask: 'EVACUATION',
                unitStatus: 'ON_ROUTE' as const,
                status: 'jednostka w drodze na miejsce zdarzenia',
                reportStatus: 'Przejazd korytarzem drogowym do pozycji uwięzionych.',
              };
            }
            if (m.id === victim.id) {
              return {
                ...m,
                status: 'W_TRAKCIE_EWAKUACJI',
                survivalSecondsLeft: undefined,
                isDiscovered: true,
                detectionMethod: 'RESCUE_TEAM',
              };
            }
            return m;
          });
        } else if (cmd === 'REPORT') {
          const isWaterInf = targetUnit.hasInfiniteWaterSupply || targetUnit.unitStatus === 'WATER_PUMPING';
          setAiAssistantLogs((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `MELDUNEK OD ${targetUnit.label}: Rota ratownicza w komplecie (${targetUnit.crewCount || 4} ratowników ODO). Zapas wody: ${isWaterInf ? '100% (MAGISTRALA WODNA x2.5)' : `${targetUnit.waterLevel ?? 85}%`}. Zadanie: ${targetUnit.currentTask}. Status: ${targetUnit.status || 'DZIAŁANIE'}.`,
              time: new Date().toLocaleTimeString().slice(0, 5),
            },
          ]);

          return prevMarkers.map((m) =>
            m.id === markerId
              ? {
                  ...m,
                  reportStatus: `Meldunek radiowy roty złożony o ${new Date().toLocaleTimeString().slice(0, 5)}`,
                }
              : m
          );
        } else {
          setAiAssistantLogs((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `ROZKAZ DLA ${targetUnit.label}: Przejście na stanowisko w tryb GOTOWOŚCI (STANDBY).`,
              time: new Date().toLocaleTimeString().slice(0, 5),
            },
          ]);

          return prevMarkers.map((m) =>
            m.id === markerId ? { ...m, currentTask: 'STANDBY', unitStatus: 'STANDBY' as const, navigationPath: undefined, status: 'GOTOWOŚĆ BOJOWA' } : m
          );
        }
      });
    },
    [incidentZones]
  );

  // MODUŁ 4: Onboarding Nowej Jednostki Dojeżdżającej (Zgłoś przybycie)
  const handleOnboardNewUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitCallsign.trim()) return;

    // Obrzeża mapy: Brama Wjazdowa Główna -> Punkt Zborny KDR
    const gateCoords: [number, number] = [52.2100, 20.7890];
    const stagingCoords: [number, number] = [52.2108, 20.7895];
    const roadPath = findRoadPath(gateCoords, stagingCoords);

    const newMarker: TacticalMarker = {
      id: `UNIT-PSP-${Date.now()}`,
      type: 'FRIENDLY_UNIT',
      sector: 'SEKTOR A-3',
      coords: [
        gateCoords[0] + (Math.random() - 0.5) * 0.0001,
        gateCoords[1] + (Math.random() - 0.5) * 0.0001,
      ],
      label: newUnitCallsign.trim(),
      details: `Zastęp PSP/OSP (${newUnitType}) w drodze na miejsce zdarzenia. Obsada: ${newUnitCrew} ratowników. Zapas wody: ${newUnitWater} L. Przypisany odcinek: ${newUnitZone}.`,
      status: 'jednostka w drodze na miejsce zdarzenia (Brama -> Punkt Zborny)',
      currentTask: 'STANDBY',
      unitStatus: 'ON_ROUTE',
      navigationPath: roadPath,
      waterLevel: Math.round((newUnitWater / 5000) * 100),
      crewCount: newUnitCrew,
      reportStatus: 'Wóz wjechał przez bramę główną. Przejazd korytarzem drogowym do punktu zbornego KDR.',
    };

    setMarkers((prev) => [...prev, newMarker]);
    setIsOnboardingUnitOpen(false);

    setAiAssistantLogs((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: `WPROWADZENIE JEDNOSTKI: Zastęp ${newUnitCallsign.trim()} przekroczył bramę główną (jednostka w drodze na miejsce zdarzenia). Wyznaczono trasę do placu zbornego KDR.`,
        time: new Date().toLocaleTimeString().slice(0, 5),
      },
    ]);
  };

  // KROK 3: INTERAKTYWNE POLECENIA (ACTION -> EFFECT W STANIE APLIKACJI)
  const handleExecuteCommand = useCallback((cmdText?: string) => {
    const text = (cmdText || aiPrompt).trim();
    if (!text) return;

    const userEntry = {
      role: 'user' as const,
      text,
      time: new Date().toLocaleTimeString().slice(0, 5),
    };

    let replyText = 'Rozkaz zarejestrowany w dzienniku zdarzeń KDR.';
    const lower = text.toLowerCase();

    // 1. Polecenie EWAKUACJA: Zmiana stanu poszkodowanych, zatrzymanie licznika, zrzut drona
    if (lower.includes('ewakuac') || lower.includes('ratuj') || lower.includes('poszkodowan') || lower.includes('zrzut') || lower.includes('sektor b')) {
      setActiveEvacuationRoute('K-1');

      // Zmień status poszkodowanych z OCZEKUJE na W TRAKCIE EWAKUACJI i zatrzymaj licznik czasu
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => {
          if (m.type === 'VICTIM' && !m.isLost) {
            return {
              ...m,
              status: 'W_TRAKCIE_EWAKUACJI',
              survivalSecondsLeft: undefined, // Usunięcie presji czasu - ratunek rozpoczęty!
              details: `${m.details} | Korytarz K-1 rozwinięty. Rota RIT podaje aparaty ucieczkowe.`,
            };
          }
          return m;
        })
      );

      // Skieruj najbliższego drona ratowniczego (ALPHA-2 lub innego) bezpośrednio na współrzędne poszkodowanych
      const victimMarker = markers.find((m) => m.type === 'VICTIM');
      if (victimMarker) {
        setDrones((prevDrones) =>
          prevDrones.map((d, idx) => {
            if (d.payload === 'FIRST_AID_DROP' || idx === 0) {
              return {
                ...d,
                status: 'PATROL',
                targetWaypoint: [...victimMarker.coords],
                hoverDurationRemaining: 0,
                speed: 48,
              };
            }
            return d;
          })
        );
      }

      // Po kilku sekundach ewakuacja zakończona sukcesem
      setTimeout(() => {
        setMarkers((prev) =>
          prev.map((m) =>
            m.type === 'VICTIM' && m.status === 'W_TRAKCIE_EWAKUACJI'
              ? {
                  ...m,
                  status: 'EWAKUOWANY',
                  label: `${m.label} (EWAKUACJA ZAKOŃCZONA SUKCESEM)`,
                  details: 'Poszkodowani przekazani ZRM-04 w punkcie segregacji TRIAGE.',
                }
              : m
          )
        );
      }, 7000);

      replyText = 'SUKCES OPERACYJNY: Korytarz K-1 otwarty. Status poszkodowanych zmieniony na: W TRAKCIE EWAKUACJI. Licznik zagrożenia zatrzymany. Dron ALPHA-2 realizuje zrzut masek.';
    }

    // 2. Polecenie WYCOFANIE ROT: Zmiana statusu jednostek na WYCOFANI i fizyczne przesunięcie współrzędnych
    else if (lower.includes('wycof') || lower.includes('rot') || lower.includes('bleve')) {
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => {
          if (m.type === 'FRIENDLY_UNIT') {
            // Fizycznie przesuń jednostkę poza obrys zagrożenia (np. 150m na południowy zachód do strefy bezpiecznej)
            const safeCoords: [number, number] = [
              m.coords[0] - 0.0016,
              m.coords[1] - 0.0014,
            ];
            return {
              ...m,
              coords: safeCoords,
              status: 'WYCOFANI_DO_STREFY_BEZPIECZNEJ',
              details: 'Rota wycofana na pozycję buforową na rozkaz KDR. Stan załogi pełny.',
            };
          }
          return m;
        })
      );

      replyText = 'ROZKAZ WYKONANY: Rota PSP została fizycznie wycofana poza strefę zagrożenia wybuchem BLEVE na obrzeża bazy.';
    }

    // 3. Polecenie CHŁODZENIE / ZBIJANIE TEMPERATURY
    else if (lower.includes('chłodz') || lower.includes('pian') || lower.includes('działk') || lower.includes('gaś')) {
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => {
          if (m.type === 'FIRE_ZONE') {
            return {
              ...m,
              temperature: Math.max(120, (m.temperature || 580) - 180),
              status: 'CHŁODZENIE_AKTYWNE',
              details: `${m.details} | Podano prądy piany ciężkiej. Obniżono temperaturę o 180°C.`,
            };
          }
          return m;
        })
      );

      replyText = 'ROZKAZ WYKONANY: Uruchomiono działka gaśnicze i zrzut piany. Temperatura płaszcza obniżona o 180°C.';
    }

    // 4. Polecenie HOT-SWAP
    else if (lower.includes('hot-swap') || lower.includes('bater') || lower.includes('ląd')) {
      setDrones((prev) =>
        prev.map((d) => (d.battery < 45 && !d.isExternalSupport ? { ...d, status: 'RETURNING_HOTSWAP' } : d))
      );
      replyText = 'ROZKAZ WYKONANY: Wszystkie drony z poziomem baterii poniżej 45% skierowano do najbliższych stref Hot-Swap.';
    }

    const assistantEntry = {
      role: 'assistant' as const,
      text: replyText,
      time: new Date().toLocaleTimeString().slice(0, 5),
    };

    setAiAssistantLogs((prev) => [...prev, userEntry, assistantEntry]);
    setAiPrompt('');
  }, [aiPrompt, markers]);

  // Quick Action Modal Action execution
  const handleQuickActionSelected = (actionId: string) => {
    switch (actionId) {
      case 'EVACUATE_SECTOR_B':
        setActiveTab('EVACUATION');
        handleExecuteCommand('Ewakuacja sektor B - zrzut masek i otwarcie korytarza');
        break;
      case 'START_DRAW_HOTSWAP':
        setActiveTab('SWARM');
        setIsDrawingHotSwap(true);
        break;
      case 'RETREAT_FIREFIGHTERS':
        handleExecuteCommand('Wycofaj roty ze strefy bezpośredniego rażenia');
        break;
      case 'SWITCH_FHSS_868':
        handleExecuteCommand('Przełączono automatycznie pasmo FHSS na 868 MHz');
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* GÓRNE MENU: Powrót do Centrum Operacyjnego + Zakładki + Szybka Akcja + Nazwa Akcji + Wyloguj */}
      <nav className="w-full bg-zinc-950 border-b border-zinc-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-2">
          {/* Przycisk powrotu do Centrum Operacyjnego */}
          <button
            onClick={onBackToHub}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer mr-1"
            title="Wróć do Centrum Operacyjnego"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono hidden sm:inline">Centrum Operacyjne</span>
          </button>

          {/* Zakładki operacyjne */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { id: 'RECON', label: 'Rozpoznanie', icon: Eye },
              { id: 'EVACUATION', label: 'Ewakuacja', icon: Users },
              { id: 'SWARM', label: 'Zarządzanie Rojem', icon: Zap },
              { id: 'LOGISTICS', label: 'Logistyka', icon: Truck },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700 shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prawo: Pogoda + Stan Obiektów + Zgłoś Przybycie + Szybka akcja (Ctrl+K) + Nazwa Akcji + Wyloguj */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Pogoda & Wiatr */}
          <div
            className="hidden xl:flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] font-mono text-zinc-300"
            title="Warunki atmosferyczne: prędkość i kierunek wiatru (rozprzestrzenianie pożaru)"
          >
            <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{weather.windSpeedKmh} km/h {weather.windDirectionName.split(' ')[0]}</span>
          </div>

          {/* Ryzyko zawalenia stropu hali B-4 */}
          <div
            className="hidden lg:flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] font-mono"
            title="Analiza degradacji dźwigarów dachowych hali B-4 z sensora LiDAR"
          >
            <Building className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-zinc-400 hidden xl:inline">Hala B-4:</span>
            <span className={buildingDecayRisks['BLD-B4'] >= 80 ? 'text-rose-400 font-bold animate-pulse' : 'text-amber-400 font-semibold'}>
              {buildingDecayRisks['BLD-B4']}% ryzyka
            </span>
          </div>

          {/* Przycisk Wprowadzenia Zastępu PSP/OSP */}
          <button
            onClick={() => setIsOnboardingUnitOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-700/80 rounded text-xs text-blue-200 hover:text-white transition-colors cursor-pointer"
            title="Dysponuj zastęp PSP / OSP (jednostka w drodze na miejsce zdarzenia)"
          >
            <PlusCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Dysponuj zastęp</span>
          </button>

          {/* Szybka akcja (skrót Ctrl+K) */}
          <button
            onClick={() => setIsQuickActionOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-200 hover:text-white transition-colors cursor-pointer"
            title="Szybka Akcja Taktyczna (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Szybka akcja</span>
            <kbd className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400">
              Ctrl+K
            </kbd>
          </button>

          {/* Dynamiczna nazwa akcji powiązana z Incydentem */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-zinc-800 text-xs">
            <span className="text-zinc-500 font-mono">AKCJA:</span>
            <span className="font-mono text-zinc-200 font-semibold truncate max-w-[220px]">
              {incident.name}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          </div>

          {/* Wyloguj po prawej */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/50 rounded text-xs text-rose-300 hover:text-rose-100 transition-colors cursor-pointer"
              title="Wyloguj ze stanowiska dowodzenia"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wyloguj</span>
            </button>
          )}
        </div>
      </nav>

      {/* Podział lewy/prawy z przesuwanym separatorem w OBU kierunkach (25% - 75%) */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden relative"
      >
        {/* LEWY PANEL (Zakres 25% - 75%, domyślnie 35%) */}
        <div
          style={{ width: `${leftPanelPercent}%` }}
          className="h-full flex flex-col min-h-0 overflow-hidden bg-zinc-950 border-r border-zinc-800/80 shrink-0"
        >
          {/* Treść lewego panelu w zależności od aktywnej zakładki */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
            {/* ZAKŁADKA 1: ROZPOZNANIE */}
            {activeTab === 'RECON' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                      Zagrożenia i Meldunki ({markers.length})
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Kliknij, aby wyśrodkować
                  </span>
                </div>

                {/* Lista posortowana wg pilności */}
                <div className="space-y-2.5">
                  {markers.map((marker) => {
                    const isCritical = marker.severity === 'CRITICAL';
                    const isHigh = marker.severity === 'HIGH';
                    const isVictim = marker.type === 'VICTIM';
                    const hasTimer = isVictim && marker.survivalSecondsLeft !== undefined && marker.survivalSecondsLeft > 0;
                    const isLost = marker.isLost || marker.status === 'STRATA';
                    const isSaved = marker.status === 'EWAKUOWANY';

                    return (
                      <div
                        key={marker.id}
                        onClick={() => setMapCenterCoords(marker.coords)}
                        className={`p-3 rounded-md border transition-colors cursor-pointer group ${
                          isLost
                            ? 'bg-zinc-950 border-zinc-800 opacity-60'
                            : isSaved
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : isCritical
                            ? 'bg-rose-950/30 hover:bg-rose-950/50 border-rose-500/50'
                            : isHigh
                            ? 'bg-amber-950/20 hover:bg-amber-950/40 border-amber-500/40'
                            : 'bg-zinc-900/60 hover:bg-zinc-900 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                              isLost
                                ? 'bg-zinc-800 text-zinc-400'
                                : isSaved
                                ? 'bg-emerald-900/80 text-emerald-300'
                                : isCritical
                                ? 'bg-rose-600 text-white'
                                : isHigh
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {marker.sector} · {marker.type}
                          </span>

                          {hasTimer ? (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/60 text-[10px] font-mono font-bold text-rose-300 animate-pulse">
                              <Clock className="w-3 h-3 text-rose-400" />
                              <span>PRZEŻYCIE: {marker.survivalSecondsLeft}s</span>
                            </div>
                          ) : marker.temperature ? (
                            <span className="text-[11px] font-mono font-bold text-rose-400">
                              {marker.temperature}°C
                            </span>
                          ) : null}
                        </div>

                        {/* Red Countdown Progress Bar for Victims (Krok 2) */}
                        {hasTimer && (
                          <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden my-2 border border-rose-950">
                            <div
                              style={{ width: `${Math.round((marker.survivalSecondsLeft! / (marker.timeLimitSeconds || 120)) * 100)}%` }}
                              className="h-full bg-rose-500 transition-all duration-1000"
                            />
                          </div>
                        )}

                        <div className="font-semibold text-xs text-zinc-100 group-hover:text-emerald-300 mb-1">
                          {marker.label}
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed mb-2.5">
                          {marker.details}
                        </p>

                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                          {isVictim && !isLost && !isSaved ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExecuteCommand('Ewakuacja sektor B natychmiast');
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-bold shadow-xs cursor-pointer"
                            >
                              <span>Rozpocznij Ratunek (K-1)</span>
                            </button>
                          ) : drones.length > 0 ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDroneForFeed(drones[0]);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-200 cursor-pointer"
                            >
                              <Video className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Przejmij obraz</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-zinc-500">Status: {marker.status}</span>
                          )}

                          <span className="text-[10px] font-mono text-zinc-400 group-hover:text-emerald-400">
                            Wyśrodkuj na mapie →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ZAKŁADKA 2: EWAKUACJA */}
            {activeTab === 'EVACUATION' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                      Triage i Korytarze Ewakuacji
                    </span>
                  </div>

                  <button
                    onClick={() => handleExecuteCommand('Ewakuacja sektor B')}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Ewakuuj Wszystkich</span>
                  </button>
                </div>

                {/* Lista poszkodowanych ze statusem triage */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase text-zinc-400">
                    Poszkodowani i Triage:
                  </div>

                  {markers
                    .filter((m) => m.type === 'VICTIM')
                    .map((m) => {
                      const isLost = m.isLost || m.status === 'STRATA';
                      const isSaved = m.status === 'EWAKUOWANY';
                      const isEvacuating = m.status === 'W_TRAKCIE_EWAKUACJI';

                      return (
                        <div
                          key={m.id}
                          className={`p-3 border rounded-md flex items-start gap-3 ${
                            isLost
                              ? 'bg-zinc-900/60 border-zinc-800 opacity-60'
                              : isSaved
                              ? 'bg-emerald-950/30 border-emerald-500/50'
                              : isEvacuating
                              ? 'bg-cyan-950/30 border-cyan-500/50'
                              : 'bg-rose-950/20 border-rose-500/40'
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 ${
                              isLost ? 'bg-zinc-600' : isSaved ? 'bg-emerald-500' : isEvacuating ? 'bg-cyan-400' : 'bg-rose-500 animate-pulse'
                            }`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-semibold text-xs ${
                                  isLost ? 'text-zinc-400' : isSaved ? 'text-emerald-300' : isEvacuating ? 'text-cyan-300' : 'text-rose-300'
                                }`}
                              >
                                {m.label}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-400">{m.sector}</span>
                            </div>
                            <p className="text-[11px] text-zinc-300 mt-1">{m.details}</p>
                            <div className="text-[10px] font-mono text-emerald-400 mt-1">Status: {m.status}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Sugerowane korytarze ucieczki */}
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-zinc-400">
                      Sugerowane Korytarze Ucieczki:
                    </span>
                    <button
                      onClick={() => setActiveEvacuationRoute(activeEvacuationRoute ? null : 'K-1')}
                      className="text-[10px] font-mono text-emerald-400 hover:underline cursor-pointer"
                    >
                      {activeEvacuationRoute ? 'Ukryj na mapie' : 'Wyświetl na mapie'}
                    </button>
                  </div>

                  <div className="p-3 bg-zinc-900/60 border border-zinc-700 rounded text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-medium text-emerald-400">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Korytarz Północny K-1 (Zalecany)
                      </span>
                      <span className="text-[10px] font-mono bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30">
                        DROŻNY
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300">
                      {incident.suggestedEvacuationCorridor || 'Wyznaczony bezpieczny wektor ewakuacji przez bramę logistyczną.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ZAKŁADKA 3: ZARZĄDZANIE ROJEM */}
            {activeTab === 'SWARM' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                      Telemetria Roju i Flota Zewnętrzna ({drones.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Narzędzie „Rysuj strefę wymiany baterii” */}
                    <button
                      onClick={() => setIsDrawingHotSwap(!isDrawingHotSwap)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                        isDrawingHotSwap
                          ? 'bg-amber-500 text-zinc-950 font-bold border-amber-400'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      <BatteryCharging className="w-3.5 h-3.5" />
                      <span>{isDrawingHotSwap ? 'Anuluj' : 'Rysuj Hot-Swap'}</span>
                    </button>
                  </div>
                </div>

                {/* Karty dronów (Własne + Krok 4: Jednostki Zewnętrzne EXT-PSP) */}
                <div className="space-y-2.5">
                  {drones.map((drone) => {
                    const isLowBattery = drone.battery < 25;
                    const isHovering = drone.status === 'HOVERING';
                    const isExternal = drone.isExternalSupport === true;

                    return (
                      <div
                        key={drone.id}
                        className={`p-3 rounded-md border transition-colors ${
                          isLowBattery
                            ? 'bg-rose-950/30 border-rose-500/50'
                            : isExternal
                            ? 'bg-indigo-950/20 border-indigo-500/40 hover:border-indigo-500'
                            : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-zinc-100">
                              {drone.callsign}
                            </span>
                            {isExternal ? (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/40">
                                WSPARCIE ZEWNĘTRZNE
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
                                {drone.model}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                              isLowBattery
                                ? 'bg-rose-600 text-white animate-pulse'
                                : isHovering
                                ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                : isExternal
                                ? 'bg-indigo-900 text-indigo-200'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {isHovering ? `HOVER (${drone.hoverDurationRemaining || 0}s)` : drone.status}
                          </span>
                        </div>

                        {/* Battery Level Bar */}
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-2">
                          <div
                            style={{ width: `${Math.round(drone.battery)}%` }}
                            className={`h-full transition-all duration-500 ${
                              isLowBattery ? 'bg-rose-500' : isExternal ? 'bg-indigo-500' : 'bg-emerald-500'
                            }`}
                          />
                        </div>

                        {/* Telemetria */}
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400 mb-2">
                          <div>
                            Bateria: <b className={isLowBattery ? 'text-rose-400' : 'text-zinc-200'}>{Math.round(drone.battery)}%</b>
                          </div>
                          <div>
                            Pułap: <b className="text-zinc-200">{drone.altitude} m</b>
                          </div>
                          <div>
                            Prędkość: <b className="text-zinc-200">{drone.speed} km/h</b>
                          </div>
                          <div>
                            Kurs (Heading): <b className="text-zinc-200">{drone.headingDeg || 0}°</b>
                          </div>
                        </div>

                        {/* Przyciski operacyjne */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800">
                          {!isExternal ? (
                            <button
                              onClick={() => handleForceReturnDrone(drone.id)}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/40 hover:bg-amber-950/70 border border-amber-500/40 rounded text-[11px] text-amber-300 cursor-pointer"
                            >
                              <BatteryCharging className="w-3.5 h-3.5" />
                              <span>Ląduj w Hot-Swap</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-indigo-400">Autonomiczny zwiad obwodowy</span>
                          )}

                          <button
                            onClick={() => setSelectedDroneForFeed(drone)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[11px] text-zinc-200 cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Podgląd kamery</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ZAKŁADKA 4: LOGISTYKA */}
            {activeTab === 'LOGISTICS' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                      Zasoby Operacyjne i Hot-Swap
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Wozy bojowe */}
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md space-y-2">
                    <div className="font-semibold text-xs text-zinc-200 flex items-center justify-between">
                      <span>Wozy bojowe PSP i rezerwa wody:</span>
                      <span className="text-[10px] font-mono text-cyan-400">Zadysponowano: {incident.assignedUnitsCount}</span>
                    </div>

                    <div className="space-y-1.5 text-xs text-zinc-300">
                      <div className="flex justify-between text-[11px] font-mono">
                        <span>Rota 1 (GBA-2.5/16):</span>
                        <span className="text-emerald-400 font-bold">2 100 L (84%)</span>
                      </div>
                      <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                        <div className="w-[84%] bg-cyan-500 h-full" />
                      </div>

                      <div className="flex justify-between text-[11px] font-mono pt-1">
                        <span>Rota 2 (GCBA-5/32):</span>
                        <span className="text-emerald-400 font-bold">4 800 L (96%)</span>
                      </div>
                      <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                        <div className="w-[96%] bg-cyan-500 h-full" />
                      </div>
                    </div>
                  </div>

                  {/* Stacje wymiany akumulatorów Hot-Swap */}
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md">
                    <div className="font-semibold text-xs text-zinc-200 mb-2 flex items-center justify-between">
                      <span>Stacje Hot-Swap (Akumulatory):</span>
                      <span className="text-[10px] font-mono text-amber-400">{hotSwapStations.length} LĄDOWISKA</span>
                    </div>

                    <div className="space-y-2">
                      {hotSwapStations.map((hs) => (
                        <div key={hs.id} className="p-2 bg-zinc-950/60 rounded border border-zinc-800 text-xs">
                          <div className="font-medium text-zinc-200 mb-1">{hs.name}</div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                            <span className="text-emerald-400">Pakiety gotowe: <b>{hs.availablePacks} szt.</b></span>
                            <span className="text-amber-400">W ładowaniu: <b>{hs.chargingPacks} szt.</b></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* DOLNY PASEK LEWEGO PANELU: Asystent Taktyczny z polem tekstowym i podpowiedziami */}
          <div className="border-t border-zinc-800 bg-zinc-950 p-3 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-zinc-300">
                <Bot className="w-3.5 h-3.5 text-emerald-400" />
                <span>Asystent Taktyczny KDR</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400">
                GOTOWY DO ROZKAZÓW
              </span>
            </div>

            {/* Ostatnia odpowiedź asystenta */}
            {aiAssistantLogs.length > 0 && (
              <div className="max-h-20 overflow-y-auto p-2 bg-zinc-900/70 border border-zinc-800 rounded text-[11px] text-zinc-300 font-sans leading-relaxed">
                {aiAssistantLogs[aiAssistantLogs.length - 1].text}
              </div>
            )}

            {/* Klikalne podpowiedzi komend wywołujące realny wpływ na stan (Krok 3) */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {[
                { label: 'Ewakuacja sektor B (Ratuj)', text: 'Ewakuacja sektor B - zrzut masek i otwarcie korytarza' },
                { label: 'Wycofaj roty ze strefy BLEVE', text: 'Wycofaj roty ze strefy bezpośredniego rażenia' },
                { label: 'Chłodzenie zarzewia pożaru', text: 'Podaj prądy piany i rozpocznij chłodzenie zbiornika' },
                { label: 'Ląduj drony w Hot-Swap', text: 'odeślij drona z niską baterią do najbliższej strefy Hot-Swap' },
              ].map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleExecuteCommand(chip.text)}
                  className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 rounded whitespace-nowrap transition-colors cursor-pointer shrink-0"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Pole tekstowe do wydawania poleceń naturalnym językiem */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExecuteCommand();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Wydaj polecenie (np. 'Ewakuacja sektor B', 'Wycofaj roty', 'Chłodzenie')..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded text-xs transition-colors shrink-0 cursor-pointer"
                title="Wyślij rozkaz"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* PRZESUWANY SEPARATOR (SPLITTER) W OBU KIERUNKACH (25% - 75%, double click -> 35%) */}
        <div
          onPointerDown={handlePointerDown}
          onDoubleClick={handleResetSplitter}
          title="Przeciągnij, aby zmienić proporcje (25%-75%). Podwójny klik resetuje do 35/65."
          className="w-2.5 bg-zinc-900 hover:bg-emerald-500/40 active:bg-emerald-500 transition-colors flex items-center justify-center cursor-col-resize select-none shrink-0 z-20 group"
        >
          <div className="w-0.5 h-8 bg-zinc-700 group-hover:bg-emerald-400 rounded-full" />
        </div>

        {/* PRAWY PANEL = MIKRO-MAPA TAKTYCZNA Z LEAFLETEM */}
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative">
          {/* Warstwy (checkboxy) */}
          <div className="absolute top-14 right-4 z-[1000] pointer-events-auto">
            <button
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950/90 backdrop-blur-md hover:bg-zinc-900 border border-zinc-800 rounded-md text-xs font-medium text-zinc-200 shadow-xl transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Warstwy Taktyczne</span>
            </button>

            {showLayerMenu && (
              <div className="absolute right-0 mt-1.5 w-60 bg-zinc-950 border border-zinc-800 rounded-md shadow-2xl p-2.5 z-50 text-xs space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 pb-1 border-b border-zinc-800">
                  Przełączniki Obiektów
                </div>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.victims}
                    onChange={(e) => setActiveLayers({ ...activeLayers, victims: e.target.checked })}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Wykryci ludzie (zielone / liczniki)</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.fires}
                    onChange={(e) => setActiveLayers({ ...activeLayers, fires: e.target.checked })}
                    className="accent-rose-500 rounded"
                  />
                  <span>Pożary i BLEVE (czerwone okręgi)</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.drones}
                    onChange={(e) => setActiveLayers({ ...activeLayers, drones: e.target.checked })}
                    className="accent-cyan-500 rounded"
                  />
                  <span>Drony w powietrzu (Własne + Zewnętrzne)</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.friendlyUnits}
                    onChange={(e) => setActiveLayers({ ...activeLayers, friendlyUnits: e.target.checked })}
                    className="accent-blue-500 rounded"
                  />
                  <span>Zespoły ratownicze PSP / ZRM</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.hotSwapZones}
                    onChange={(e) => setActiveLayers({ ...activeLayers, hotSwapZones: e.target.checked })}
                    className="accent-amber-500 rounded"
                  />
                  <span>Strefy Hot-Swap (baterie)</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={activeLayers.sectors}
                    onChange={(e) => setActiveLayers({ ...activeLayers, sectors: e.target.checked })}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Siatka sektorów (A, B, C, D)</span>
                </label>
              </div>
            )}
          </div>

          <TacticalMicroMapDynamic
            drones={drones}
            hotSwapStations={hotSwapStations}
            markers={markers}
            activeLayers={activeLayers}
            onSelectDrone={(drone) => setSelectedDroneId(drone.id)}
            selectedDroneId={selectedDroneId || undefined}
            isDrawingHotSwap={isDrawingHotSwap}
            onFinishDrawingHotSwap={handleFinishDrawingHotSwap}
            onCancelDrawingHotSwap={() => setIsDrawingHotSwap(false)}
            activeEvacuationRoute={activeEvacuationRoute}
            centerCoords={mapCenterCoords}
            incidentZones={incidentZones}
            onAddZone={(newZone) => {
              setIncidentZones((prev) => [...prev, newZone]);
              setAiAssistantLogs((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  text: `NOWA STREFA TAKTYCZNA: "${newZone.name}". Zaktualizowano ograniczenia operacyjne dla jednostek i dronów.`,
                  time: new Date().toLocaleTimeString().slice(0, 5),
                },
              ]);
            }}
            onRemoveZone={handleRemoveZone}
            onUnitCommand={handleUnitCommand}
            onWaterConnect={handleConnectUnitToWater}
            buildingDecayRisks={buildingDecayRisks}
            temperatureGrid={temperatureGrid}
          />
        </div>
      </div>

      {/* MODUŁ 4: Modal Onboardingu Nowej Jednostki Dojeżdżającej (Zgłoś przybycie) - z-[2000] */}
      {isOnboardingUnitOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-400" />
                <h3 className="font-mono font-bold text-sm text-zinc-100 uppercase tracking-wider">
                  Dyspozycja Zastępu (Jednostka w Drodze na Miejsce Zdarzenia)
                </h3>
              </div>
              <button
                onClick={() => setIsOnboardingUnitOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
              >
                ✕ Zamknij
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Wprowadzenie dodatkowego zastępu ratowniczego (PSP / OSP / ZRM) do działań KDR.
              Wóz zostanie postawiony na obrzeżach terenu akcji (brama wjazdowa główna) ze statusem <b>jednostka w drodze na miejsce zdarzenia</b> i przejedzie korytarzem drogowym do wyznaczonego punktu zbornego.
            </p>

            <form onSubmit={handleOnboardNewUnit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-mono text-zinc-400 mb-1">
                  Oznaczenie / Znak wywoławczy wozu:
                </label>
                <input
                  type="text"
                  value={newUnitCallsign}
                  onChange={(e) => setNewUnitCallsign(e.target.value)}
                  placeholder="np. GCBA-5/32 OSP Ożarów"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    Typ pojazdu / zastępu:
                  </label>
                  <select
                    value={newUnitType}
                    onChange={(e) => setNewUnitType(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-2 text-xs text-zinc-200 font-mono focus:border-blue-500 outline-none"
                  >
                    <option value="PSP_GCBA">GCBA (Ciężki gaśniczy)</option>
                    <option value="PSP_GBA">GBA (Średni gaśniczy)</option>
                    <option value="OSP">OSP (Zastęp ochotniczy)</option>
                    <option value="ZRM">ZRM (Zespół Rat. Medycznego)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    Obsada ratowników (ODO):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={newUnitCrew}
                    onChange={(e) => setNewUnitCrew(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-zinc-400 mb-1">
                  Zapas środka gaśniczego (litry):
                </label>
                <input
                  type="number"
                  step="500"
                  min="0"
                  max="10000"
                  value={newUnitWater}
                  onChange={(e) => setNewUnitWater(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-zinc-400 mb-1">
                  Własna Strefa / Odcinek Bojowy jednostki:
                </label>
                <input
                  type="text"
                  value={newUnitZone}
                  onChange={(e) => setNewUnitZone(e.target.value)}
                  placeholder="np. Odcinek Bojowy nr 2 (Kurtyny Wodne)"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 outline-none"
                />
              </div>

              <div className="p-2.5 bg-blue-950/30 border border-blue-800/40 rounded text-[11px] font-mono text-blue-300">
                ✓ Przesyłanie danych: <b>Aktualny Snapshot Roju ({drones.length} dronów) + Strefy Zagrożenia + Współrzędne Poszkodowanych</b>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOnboardingUnitOpen(false)}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 cursor-pointer"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded text-xs font-semibold cursor-pointer shadow-lg"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Zintegruj i Dodaj do Siatki KDR</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Szybka Akcja Modal (skrót Ctrl+K) - z-[2000] */}
      <QuickActionModal
        isOpen={isQuickActionOpen}
        onClose={() => setIsQuickActionOpen(false)}
        onExecuteAction={handleQuickActionSelected}
      />

      {/* Drone Video & Sensor Feed Modal - z-[2000] */}
      <DroneFeedModal
        isOpen={Boolean(selectedDroneForFeed)}
        drone={selectedDroneForFeed}
        onClose={() => setSelectedDroneForFeed(null)}
      />
    </div>
  );
}
