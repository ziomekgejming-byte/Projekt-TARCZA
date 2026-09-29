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
  generateFireGridForBounds,
  propagateFireGrid,
  haversineDistanceMeters,
  expandFirePolygon,
  shrinkFirePolygon,
  computePolygonAreaM2,
  getPolygonCentroid,
  findRoadPath,
} from '@/lib/offline-maps-data';
import QuickActionModal from './QuickActionModal';
import DroneFeedModal from './DroneFeedModal';
import {
  Eye, Zap, Search, Users, Send, Bot, Video, Truck, CheckCircle2, BatteryCharging,
  SlidersHorizontal, LogOut, ArrowLeft, AlertTriangle, Wind, PlusCircle, Building,
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

// Różne punkty wjazdowe dla wozów strażackich
const ENTRY_GATES: [number, number][] = [
  [52.2100, 20.7890], // Południe
  [52.2145, 20.7960], // Północny Wschód
  [52.2120, 20.7850], // Zachód
  [52.2080, 20.7940], // Południowy Wschód
];

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

    units.push({
      id: `DRON-EXT-${i + 1}`,
      callsign,
      model: 'Patrol-UAV Eksternalny',
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
      targetWaypoint: [
        incident.centerCoords[0] + Math.sin(angle + 1.2) * 0.0038,
        incident.centerCoords[1] + Math.cos(angle + 1.2) * 0.0046,
      ] as [number, number],
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
  const [activeTab, setActiveTab] = useState<'RECON' | 'EVACUATION' | 'SWARM' | 'LOGISTICS'>('RECON');
  const [leftPanelPercent, setLeftPanelPercent] = useState<number>(35);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);

  const [drones, setDrones] = useState<DroneTelemetry[]>(() => {
    return [...initialDrones, ...generateExternalSupport(incident)];
  });

  useEffect(() => {
    if (initialDrones && initialDrones.length > 0) {
      setDrones((prev) => {
        const existingIds = new Set(prev.map(d => d.id));
        const newDrones = initialDrones.filter(d => !existingIds.has(d.id));
        if (newDrones.length === 0) return prev;
        return [...prev, ...newDrones];
      });
    }
  }, [initialDrones]);

  const [hotSwapStations, setHotSwapStations] = useState<HotSwapStation[]>(incident.hotSwapStations);

  const [markers, setMarkers] = useState<TacticalMarker[]>(() =>
    incident.tacticalMarkers.map((m) => {
      if (m.type === 'VICTIM' && m.severity === 'CRITICAL' && !m.survivalSecondsLeft) {
        return { ...m, timeLimitSeconds: 120, survivalSecondsLeft: 120 };
      }
      return m;
    })
  );

  const [weather, setWeather] = useState<WeatherCondition>(
    incident.weather || {
      windSpeedKmh: 18,
      windDirectionDeg: 225,
      windDirectionName: 'SW (Południowo-Zachodni)',
      temperatureC: 22,
      humidityPercent: 42,
    }
  );

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

  const [buildingDecayRisks, setBuildingDecayRisks] = useState<Record<string, number>>({
    'BLD-B4': 42, 'BLD-C2': 28, 'BLD-A1': 5, 'BLD-D1': 0,
  });

  const [incidentZones, setIncidentZones] = useState<TacticalZone[]>(incident.zones || []);

  const [isOnboardingUnitOpen, setIsOnboardingUnitOpen] = useState<boolean>(false);
  const [newUnitCallsign, setNewUnitCallsign] = useState<string>('GCBA-5/32 OSP Ożarów');
  const [newUnitType, setNewUnitType] = useState<'PSP_GBA' | 'PSP_GCBA' | 'OSP' | 'ZRM'>('PSP_GCBA');
  const [newUnitWater, setNewUnitWater] = useState<number>(5000);
  const [newUnitCrew, setNewUnitCrew] = useState<number>(4);

  const [mapCenterCoords, setMapCenterCoords] = useState<[number, number]>(incident.centerCoords);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [isDrawingHotSwap, setIsDrawingHotSwap] = useState<boolean>(false);
  const [activeEvacuationRoute, setActiveEvacuationRoute] = useState<string | null>(incident.suggestedEvacuationCorridor ? 'K-1' : null);

  const [activeLayers, setActiveLayers] = useState({
    victims: true, fires: true, drones: true, friendlyUnits: true, hotSwapZones: true, sectors: true,
  });
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [selectedDroneForFeed, setSelectedDroneForFeed] = useState<DroneTelemetry | null>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAssistantLogs, setAiAssistantLogs] = useState<Array<{ role: 'user' | 'assistant'; text: string; time: string }>>([
    {
      role: 'assistant',
      text: `Stanowisko dowodzenia KDR aktywne dla akcji: ${incident.name}. Zintegrowano maszyny własne oraz jednostki wsparcia obwodowego.`,
      time: '00:01',
    },
  ]);

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

  // GŁÓWNA PĘTLA SYMULACJI (Wozy strażackie, pożar, detekcja)
  useEffect(() => {
    let tickCount = 0;

    const simulationInterval = setInterval(() => {
      tickCount += 1;
      const curWeather = weatherRef.current;
      const curDrones = dronesRef.current;

      // 1. POJAWIANIE SIĘ JEDNOSTEK WSPARCIA (Z RÓŻNYCH STRON)
      if (tickCount === 2 || tickCount % 12 === 0) {
        setMarkers((prevMarkers) => {
          const currentUnitsCount = prevMarkers.filter((m) => m.type === 'FRIENDLY_UNIT').length;
          if (currentUnitsCount < 12) { 
            // Losujemy bramę wjazdową z dostępnej puli
            const randomGate = ENTRY_GATES[Math.floor(Math.random() * ENTRY_GATES.length)];
            const spawnOffsetLat = (Math.random() - 0.5) * 0.001;
            const spawnOffsetLng = (Math.random() - 0.5) * 0.001;
            const gateCoords: [number, number] = [randomGate[0] + spawnOffsetLat, randomGate[1] + spawnOffsetLng];
            
            const fireZones = incidentZonesRef.current.filter((z) => z.type === 'DANGER_ZONE' && !z.isExtinguished);

            const targetOffsetLat = (Math.random() - 0.5) * 0.0015;
            const targetOffsetLng = (Math.random() - 0.5) * 0.0015;
            let targetCoords: [number, number] = [52.2108 + targetOffsetLat, 20.7895 + targetOffsetLng];
            
            if (fireZones.length > 0 && fireZones[0].polygon) {
              const centroid = getPolygonCentroid(fireZones[0].polygon);
              targetCoords = [centroid[0] + targetOffsetLat, centroid[1] + targetOffsetLng];
            }

            const roadPath = findRoadPath(gateCoords, targetCoords);
            if (roadPath[roadPath.length - 1][0] !== targetCoords[0] || roadPath[roadPath.length - 1][1] !== targetCoords[1]) {
              roadPath.push(targetCoords);
            }

            const callsignId = Math.floor(10 + Math.random() * 90);
            const isOsp = Math.random() > 0.5;

            const newUnit: TacticalMarker = {
              id: `UNIT-AUTO-${Date.now()}-${Math.random()}`,
              type: 'FRIENDLY_UNIT',
              sector: 'SEKTOR B-4',
              coords: gateCoords,
              label: isOsp ? `OSP-${callsignId} (Wsparcie)` : `JRG-${callsignId} (Zastęp)`,
              details: 'Jednostka zadysponowana automatycznie do natarcia.',
              status: 'W drodze na miejsce zdarzenia',
              currentTask: 'FIRE_FIGHTING',
              unitStatus: 'ON_ROUTE',
              navigationPath: roadPath,
              waterLevel: 100,
              crewCount: isOsp ? 6 : 4,
              reportStatus: 'Wjazd na teren akcji.',
            };

            return [...prevMarkers, newUnit];
          }
          return prevMarkers;
        });
      }

      // 2. DYNAMICZNE PRZEGRUPOWANIE (Wozy szukają ognia, jeśli ugaszą swój kawałek)
      if (tickCount % 4 === 0) {
        setMarkers((prevMarkers) => {
          const hotCells = temperatureGridRef.current.filter(c => !c.isExtinguished && c.temperature > 150);
          
          if (hotCells.length === 0) return prevMarkers; // Pożar ugaszony

          let logsToAdd: string[] = [];

          const updated = prevMarkers.map(marker => {
            if (marker.type === 'FRIENDLY_UNIT' && marker.currentTask === 'FIRE_FIGHTING') {
              // Zasięg węża to 90 metrów
              const hasFireInRange = hotCells.some(c => haversineDistanceMeters(marker.coords, c.coords) < 90);

              // Jeśli ugasił swój kawałek i nie jest w trasie. 
              // Szansa 30% na ruch w danej turze (żeby ruszały pojedynczo, a nie wszystkie naraz)
              if (!hasFireInRange && (!marker.navigationPath || marker.navigationPath.length === 0) && Math.random() < 0.3) {
                // Wybierz losową gorącą komórkę, żeby wozy się rozproszyły po całym pożarze
                const targetCell = hotCells[Math.floor(Math.random() * hotCells.length)];
                
                // Nie jedź w sam środek ognia, zaparkuj obok
                const offsetLat = (Math.random() - 0.5) * 0.0008;
                const offsetLng = (Math.random() - 0.5) * 0.0008;
                const newTarget: [number, number] = [targetCell.coords[0] + offsetLat, targetCell.coords[1] + offsetLng];

                const newPath = findRoadPath(marker.coords, newTarget);
                newPath.push(newTarget);

                logsToAdd.push(`PRZEGRUPOWANIE: ${marker.label} zmienia stanowisko gaśnicze.`);

                return {
                  ...marker,
                  navigationPath: newPath,
                  unitStatus: 'ON_ROUTE' as const,
                  status: 'PRZEGRUPOWANIE',
                  reportStatus: 'Zmiana stanowiska gaśniczego - pożar zlokalizowany w nowym sektorze.'
                };
              }
            }
            return marker;
          });

          if (logsToAdd.length > 0) {
            setAiAssistantLogs(prev => [...prev, ...logsToAdd.map(t => ({ role: 'assistant' as const, text: t, time: new Date().toLocaleTimeString().slice(0, 5) }))]);
          }

          return updated;
        });
      }

      // 3. RUCH JEDNOSTEK NAZIEMNYCH
      setMarkers((prevMarkers) => {
        let discoveredNotice: string | null = null;

        const movedMarkers = prevMarkers.map((marker) => {
          if (marker.type === 'FRIENDLY_UNIT' && marker.navigationPath && marker.navigationPath.length > 0) {
            const path = [...marker.navigationPath];
            const nextWaypoint = path[0];
            const dist = haversineDistanceMeters(marker.coords, nextWaypoint);

            if (dist < 20) {
              path.shift();
              if (path.length === 0) {
                if (marker.currentTask === 'FIRE_FIGHTING') {
                  return { ...marker, coords: nextWaypoint, navigationPath: undefined, unitStatus: 'EXTINGUISHING' as const, status: 'NATARCIE GAŚNICZE', reportStatus: 'Trwa gaszenie pożaru.' };
                }
                return { ...marker, coords: nextWaypoint, navigationPath: undefined, unitStatus: 'STANDBY' as const, status: 'W PUNKCIE ZBORNM' };
              }
              return { ...marker, coords: nextWaypoint, navigationPath: path };
            } else {
              const dLat = nextWaypoint[0] - marker.coords[0];
              const dLng = nextWaypoint[1] - marker.coords[1];
              const distDeg = Math.hypot(dLat, dLng) || 0.00001;
              const moveDeg = 35 / 111000; // Szybki dojazd (ok. 35 m/s)
              const ratio = Math.min(1, moveDeg / distDeg);

              return {
                ...marker,
                coords: [marker.coords[0] + dLat * ratio, marker.coords[1] + dLng * ratio] as [number, number],
                navigationPath: path,
              };
            }
          }
          return marker;
        });

        // Detekcja poszkodowanych przez drony
        const updated = movedMarkers.map((marker) => {
          if (marker.type === 'VICTIM' && !marker.isDiscovered) {
            const detectingDrone = curDrones.find((d) => haversineDistanceMeters(d.coords, marker.coords) < 35 && (d.payload === 'THERMAL_FLIR' || d.payload === 'LIDAR_STRUCTURAL'));
            if (detectingDrone) {
              discoveredNotice = `DETEKCJA SENSORA (${detectingDrone.payload === 'THERMAL_FLIR' ? 'FLIR' : 'LIDAR'}): Zlokalizowano uwięzionych poszkodowanych w ${marker.sector}!`;
              return { ...marker, isDiscovered: true, detectionMethod: detectingDrone.payload === 'THERMAL_FLIR' ? 'FLIR' : 'LIDAR' as any, status: 'OCZEKUJE_EWAKUACJI' };
            }
          }
          return marker;
        });

        if (discoveredNotice) {
          setAiAssistantLogs((prev) => [...prev, { role: 'assistant', text: discoveredNotice!, time: new Date().toLocaleTimeString().slice(0, 5) }]);
        }

        return updated;
      });

      // 4. CHŁODZENIE POŻARU (Co 1 sekundę)
      setTemperatureGrid((prevGrid) => {
        const latestMarkers = markersRef.current;
        const extinguishingUnits = latestMarkers.filter(
          (m) => m.type === 'FRIENDLY_UNIT' && m.unitStatus === 'EXTINGUISHING'
        );

        if (extinguishingUnits.length === 0) return prevGrid;

        let gridChanged = false;
        const nextGrid = prevGrid.map((cell) => {
          if (cell.isExtinguished && cell.temperature <= 40) return cell;

          // Wóz gasi komórki w promieniu zasięgu węża (90m)
          const affectingUnits = extinguishingUnits.filter((u) => haversineDistanceMeters(u.coords, cell.coords) < 90);

          if (affectingUnits.length > 0) {
            gridChanged = true;
            const totalCooling = affectingUnits.length * 45; // 45 stopni w dół na sekundę per wóz
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

      // 5. DYNAMIKA POLIGONU POŻARU (Co 15 sekund)
      if (tickCount % 15 === 0) {
        setIncidentZones((prevZones) => {
          const latestMarkers = markersRef.current;
          let hasZoneUpdates = false;

          const updatedZones = prevZones.map((zone) => {
            if (zone.type !== 'DANGER_ZONE' || zone.isExtinguished || !zone.polygon) return zone;
            const activeFightingUnits = latestMarkers.filter((m) => m.type === 'FRIENDLY_UNIT' && m.unitStatus === 'EXTINGUISHING');
            hasZoneUpdates = true;

            if (activeFightingUnits.length > 0) {
              const shrinkFactor = 0.05 + (activeFightingUnits.length * 0.04);
              const newPoly = shrinkFirePolygon(zone.polygon, shrinkFactor);
              const newArea = computePolygonAreaM2(newPoly);
              if (newArea < 100) return { ...zone, isExtinguished: true, areaM2: 0, color: '#10b981' };
              return { ...zone, polygon: newPoly, areaM2: newArea };
            } else {
              const newPoly = expandFirePolygon(zone.polygon, 0.06, curWeather.windDirectionDeg, curWeather.windSpeedKmh);
              return { ...zone, polygon: newPoly, areaM2: computePolygonAreaM2(newPoly) };
            }
          });
          return hasZoneUpdates ? updatedZones : prevZones;
        });
        
        setTemperatureGrid((prevGrid) => propagateFireGrid(prevGrid, curWeather.windDirectionDeg, curWeather.windSpeedKmh));
      }
    }, 1000);

    return () => clearInterval(simulationInterval);
  }, []);

  // PĘTLA DRONÓW (Fizyka lotu, szukanie celów)
  useEffect(() => {
    if (drones.length === 0) return;

    const interval = setInterval(() => {
      setDrones((prevDrones) =>
        prevDrones.map((drone) => {
          const isLowBattery = drone.battery < 25 || drone.status === 'BATTERY_CRITICAL' || drone.status === 'RETURNING_HOTSWAP';

          if (isLowBattery && hotSwapStations.length > 0) {
            let nearestStation = hotSwapStations[0];
            let minDistance = Infinity;
            hotSwapStations.forEach((hs) => {
              const dist = haversineDistanceMeters(drone.coords, hs.coords);
              if (dist < minDistance) { minDistance = dist; nearestStation = hs; }
            });

            if (minDistance < 20) {
              return { ...drone, battery: 100, status: 'PATROL', coords: [...nearestStation.coords] as [number, number], speed: 34 };
            }
            const dLat = nearestStation.coords[0] - drone.coords[0];
            const dLng = nearestStation.coords[1] - drone.coords[1];
            const totalDiff = Math.hypot(dLat, dLng) || 0.0001;
            const step = 0.00016;
            return { ...drone, status: drone.battery < 20 ? 'BATTERY_CRITICAL' : 'RETURNING_HOTSWAP', coords: [drone.coords[0] + (dLat / totalDiff) * step, drone.coords[1] + (dLng / totalDiff) * step] as [number, number], battery: Math.max(4, drone.battery - 0.04) };
          }

          let currentTarget: [number, number] | undefined = drone.targetWaypoint;

          if (!currentTarget || Math.random() < 0.15) {
            const undiscoveredVictims = markersRef.current.filter((m) => m.type === 'VICTIM' && !m.isDiscovered);
            const hotCells = temperatureGridRef.current.filter((c) => c.temperature > 300 && !c.isExtinguished);

            if (undiscoveredVictims.length > 0 && drone.payload !== 'FIRST_AID_DROP') {
              const v = undiscoveredVictims[Math.floor(Math.random() * undiscoveredVictims.length)];
              currentTarget = [v.coords[0] + (Math.random() - 0.5) * 0.0015, v.coords[1] + (Math.random() - 0.5) * 0.0015] as [number, number];
            } else if (hotCells.length > 0) {
              const targetCell = hotCells[Math.floor(Math.random() * hotCells.length)];
              currentTarget = [targetCell.coords[0] + (Math.random() - 0.5) * 0.002, targetCell.coords[1] + (Math.random() - 0.5) * 0.002] as [number, number];
            } else {
              currentTarget = [incident.centerCoords[0] + (Math.random() - 0.5) * 0.006, incident.centerCoords[1] + (Math.random() - 0.5) * 0.006] as [number, number];
            }
          }

          if (drone.status === 'HOVERING') {
            const remainingHover = drone.hoverDurationRemaining ?? 0;
            if (remainingHover > 1) return { ...drone, hoverDurationRemaining: remainingHover - 1, speed: 0, battery: Math.max(5, drone.battery - 0.02) };
            return { ...drone, status: 'PATROL', targetWaypoint: undefined, hoverDurationRemaining: 0, speed: 36 };
          }

          const distToWaypoint = haversineDistanceMeters(drone.coords, currentTarget);
          if (distToWaypoint < 14) {
            return { ...drone, status: 'HOVERING', hoverDurationRemaining: 3, speed: 0, battery: Math.max(5, drone.battery - 0.02) };
          }

          const dLat = currentTarget[0] - drone.coords[0];
          const dLng = currentTarget[1] - drone.coords[1];
          const distDegrees = Math.hypot(dLat, dLng) || 0.0001;
          const speedMs = (drone.speed * 1000) / 3600; 
          const moveDeg = speedMs / 111000;
          const ratio = Math.min(1, moveDeg / distDegrees);

          const heading = Math.round(((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360);

          return {
            ...drone,
            status: 'PATROL',
            coords: [drone.coords[0] + dLat * ratio, drone.coords[1] + dLng * ratio] as [number, number],
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
      window.dispatchEvent(new Event('resize'));
    }
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.dispatchEvent(new Event('resize'));
  };

  const handleForceReturnDrone = (droneId: string) => {
    setDrones((prev) => prev.map((d) => d.id === droneId ? { ...d, status: 'RETURNING_HOTSWAP' } : d));
    setAiAssistantLogs((prev) => [...prev, { role: 'assistant', text: `ROZKAZ PRZYJĘTY: Dron został skierowany do lądowania.`, time: new Date().toLocaleTimeString().slice(0, 5) }]);
  };

  const handleFinishDrawingHotSwap = (newStation: HotSwapStation) => {
    setHotSwapStations((prev) => [...prev, newStation]);
    setIsDrawingHotSwap(false);
    setAiAssistantLogs((prev) => [...prev, { role: 'assistant', text: `ZATWIERDZONO NOWĄ STREFĘ HOT-SWAP: ${newStation.name}.`, time: new Date().toLocaleTimeString().slice(0, 5) }]);
  };

  const handleExecuteCommand = useCallback((cmdText?: string) => {
    const text = (cmdText || aiPrompt).trim();
    if (!text) return;

    const userEntry = { role: 'user' as const, text, time: new Date().toLocaleTimeString().slice(0, 5) };
    let replyText = 'Rozkaz zarejestrowany w dzienniku zdarzeń KDR.';
    const lower = text.toLowerCase();

    if (lower.includes('ewakuac') || lower.includes('ratuj') || lower.includes('poszkodowan')) {
      setActiveEvacuationRoute('K-1');
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => m.type === 'VICTIM' && !m.isLost ? { ...m, status: 'W_TRAKCIE_EWAKUACJI', survivalSecondsLeft: undefined } : m)
      );
      replyText = 'SUKCES OPERACYJNY: Korytarz K-1 otwarty. Status poszkodowanych zmieniony na: W TRAKCIE EWAKUACJI.';
    } else if (lower.includes('wycof') || lower.includes('rot')) {
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => m.type === 'FRIENDLY_UNIT' ? { ...m, coords: [m.coords[0] - 0.0016, m.coords[1] - 0.0014] as [number, number], status: 'WYCOFANI_DO_STREFY_BEZPIECZNEJ' } : m)
      );
      replyText = 'ROZKAZ WYKONANY: Rota PSP została fizycznie wycofana poza strefę zagrożenia.';
    } else if (lower.includes('chłodz') || lower.includes('pian') || lower.includes('gaś')) {
      setMarkers((prevMarkers) =>
        prevMarkers.map((m) => m.type === 'FIRE_ZONE' ? { ...m, temperature: Math.max(120, (m.temperature || 580) - 180), status: 'CHŁODZENIE_AKTYWNE' } : m)
      );
      replyText = 'ROZKAZ WYKONANY: Uruchomiono działka gaśnicze i zrzut piany. Temperatura płaszcza obniżona.';
    } else if (lower.includes('hot-swap') || lower.includes('bater')) {
      setDrones((prev) => prev.map((d) => (d.battery < 45 && !d.isExternalSupport ? { ...d, status: 'RETURNING_HOTSWAP' } : d)));
      replyText = 'ROZKAZ WYKONANY: Wszystkie drony z poziomem baterii poniżej 45% skierowano do najbliższych stref Hot-Swap.';
    }

    setAiAssistantLogs((prev) => [...prev, userEntry, { role: 'assistant', text: replyText, time: new Date().toLocaleTimeString().slice(0, 5) }]);
    setAiPrompt('');
  }, [aiPrompt]);

  const handleUnitCommand = useCallback((markerId: string, cmd: 'FIRE_FIGHTING' | 'EVACUATION' | 'REPORT' | 'STANDBY') => {
    setMarkers((prevMarkers) => {
      const targetUnit = prevMarkers.find((m) => m.id === markerId);
      if (!targetUnit) return prevMarkers;

      if (cmd === 'FIRE_FIGHTING') {
        const fireMarker = prevMarkers.find((m) => m.type === 'FIRE_ZONE');
        const targetCoords: [number, number] = fireMarker ? [fireMarker.coords[0] - 0.0002, fireMarker.coords[1] - 0.0002] : [targetUnit.coords[0] + 0.0004, targetUnit.coords[1] + 0.0004];
        const roadPath = findRoadPath(targetUnit.coords, targetCoords);

        setAiAssistantLogs((prev) => [...prev, { role: 'assistant', text: `ROZKAZ DLA ${targetUnit.label}: ZADANIE: GASZENIE. Jednostka przemieszcza się do strefy pożaru.`, time: new Date().toLocaleTimeString().slice(0, 5) }]);
        return prevMarkers.map((m) => m.id === markerId ? { ...m, navigationPath: roadPath, currentTask: 'FIRE_FIGHTING', unitStatus: 'ON_ROUTE', status: 'W drodze do pożaru' } : m);
      }
      return prevMarkers;
    });
  }, []);

  const handleQuickActionSelected = (actionId: string) => {
    if (actionId === 'EVACUATE_SECTOR_B') { setActiveTab('EVACUATION'); handleExecuteCommand('Ewakuacja sektor B'); }
    else if (actionId === 'START_DRAW_HOTSWAP') { setActiveTab('SWARM'); setIsDrawingHotSwap(true); }
    else if (actionId === 'RETREAT_FIREFIGHTERS') handleExecuteCommand('Wycofaj roty ze strefy');
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      <nav className="w-full bg-zinc-950 border-b border-zinc-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-2">
          <button onClick={onBackToHub} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer mr-1">
            <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono hidden sm:inline">Centrum Operacyjne</span>
          </button>
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
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${isActive ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700 shadow-xs' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'}`}>
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] font-mono text-zinc-300">
            <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{weather.windSpeedKmh} km/h {weather.windDirectionName.split(' ')[0]}</span>
          </div>
          <button onClick={() => setIsOnboardingUnitOpen(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-700/80 rounded text-xs text-blue-200 hover:text-white transition-colors cursor-pointer">
            <PlusCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Dysponuj zastęp</span>
          </button>
          <button onClick={() => setIsQuickActionOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-200 hover:text-white transition-colors cursor-pointer">
            <Search className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Szybka akcja</span>
            <kbd className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400">Ctrl+K</kbd>
          </button>
          {onLogout && (
            <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/50 rounded text-xs text-rose-300 hover:text-rose-100 transition-colors cursor-pointer">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wyloguj</span>
            </button>
          )}
        </div>
      </nav>

      <div ref={containerRef} className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden relative">
        <div style={{ width: `${leftPanelPercent}%` }} className="h-full flex flex-col min-h-0 overflow-hidden bg-zinc-950 border-r border-zinc-800/80 shrink-0">
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
            {activeTab === 'RECON' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">Zagrożenia i Meldunki ({markers.length})</span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {markers.map((marker) => {
                    const isCritical = marker.severity === 'CRITICAL';
                    const isVictim = marker.type === 'VICTIM';
                    const hasTimer = isVictim && marker.survivalSecondsLeft !== undefined && marker.survivalSecondsLeft > 0;
                    return (
                      <div key={marker.id} onClick={() => setMapCenterCoords(marker.coords)} className={`p-3 rounded-md border transition-colors cursor-pointer group ${isCritical ? 'bg-rose-950/30 border-rose-500/50' : 'bg-zinc-900/60 border-zinc-800'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${isCritical ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>{marker.sector} · {marker.type}</span>
                          {hasTimer && <span className="text-[10px] font-mono font-bold text-rose-300 animate-pulse">PRZEŻYCIE: {marker.survivalSecondsLeft}s</span>}
                        </div>
                        <div className="font-semibold text-xs text-zinc-100 mb-1">{marker.label}</div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed mb-2.5">{marker.details}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                          {drones.length > 0 ? (
                            <button onClick={(e) => { e.stopPropagation(); setSelectedDroneForFeed(drones[0]); }} className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-200 cursor-pointer">
                              <Video className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Przejmij obraz</span>
                            </button>
                          ) : <span className="text-[10px] font-mono text-zinc-500">Status: {marker.status}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'SWARM' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">Telemetria Roju ({drones.length})</span>
                  </div>
                  <button onClick={() => setIsDrawingHotSwap(!isDrawingHotSwap)} className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${isDrawingHotSwap ? 'bg-amber-500 text-zinc-950 font-bold border-amber-400' : 'bg-zinc-900 hover:bg-zinc-800 text-amber-300 border-amber-500/40'}`}>
                    <BatteryCharging className="w-3.5 h-3.5" />
                    <span>{isDrawingHotSwap ? 'Anuluj' : 'Rysuj Hot-Swap'}</span>
                  </button>
                </div>
                <div className="space-y-2.5">
                  {drones.map((drone) => (
                    <div key={drone.id} className={`p-3 rounded-md border transition-colors ${drone.battery < 25 ? 'bg-rose-950/30 border-rose-500/50' : drone.isExternalSupport ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-zinc-900/60 border-zinc-800'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-zinc-100">{drone.callsign}</span>
                          {drone.isExternalSupport && <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/40">WSPARCIE ZEWNĘTRZNE</span>}
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30">{drone.status}</span>
                      </div>
                      <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-2">
                        <div style={{ width: `${Math.round(drone.battery)}%` }} className="h-full bg-emerald-500 transition-all duration-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400 mb-2">
                        <div>Bateria: <b className="text-zinc-200">{Math.round(drone.battery)}%</b></div>
                        <div>Prędkość: <b className="text-zinc-200">{drone.speed} km/h</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {activeTab === 'EVACUATION' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">Triage i Korytarze Ewakuacji</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {markers.filter((m) => m.type === 'VICTIM').map((m) => (
                    <div key={m.id} className="p-3 border rounded-md flex items-start gap-3 bg-rose-950/20 border-rose-500/40">
                      <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 bg-rose-500 animate-pulse" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs text-rose-300">{m.label}</span>
                          <span className="text-[10px] font-mono text-zinc-400">{m.sector}</span>
                        </div>
                        <p className="text-[11px] text-zinc-300 mt-1">{m.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'LOGISTICS' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">Zasoby i Hot-Swap</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md">
                    <div className="font-semibold text-xs text-zinc-200 mb-2">Stacje Hot-Swap (Akumulatory):</div>
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

          <div className="border-t border-zinc-800 bg-zinc-950 p-3 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-zinc-300">
                <Bot className="w-3.5 h-3.5 text-emerald-400" />
                <span>Asystent Taktyczny KDR</span>
              </div>
            </div>
            {aiAssistantLogs.length > 0 && (
              <div className="max-h-20 overflow-y-auto p-2 bg-zinc-900/70 border border-zinc-800 rounded text-[11px] text-zinc-300 font-sans leading-relaxed">
                {aiAssistantLogs[aiAssistantLogs.length - 1].text}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleExecuteCommand(); }} className="flex items-center gap-1.5">
              <input type="text" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Wydaj polecenie (np. 'Ewakuacja sektor B')..." className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans" />
              <button type="submit" className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition-colors shrink-0 cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
            </form>
          </div>
        </div>

        <div onPointerDown={handlePointerDown} className="w-2.5 bg-zinc-900 hover:bg-emerald-500/40 active:bg-emerald-500 transition-colors flex items-center justify-center cursor-col-resize select-none shrink-0 z-20 group">
          <div className="w-0.5 h-8 bg-zinc-700 group-hover:bg-emerald-400 rounded-full" />
        </div>

        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative">
          <div className="absolute top-14 right-4 z-[1000] pointer-events-auto">
            <button onClick={() => setShowLayerMenu(!showLayerMenu)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950/90 backdrop-blur-md hover:bg-zinc-900 border border-zinc-800 rounded-md text-xs font-medium text-zinc-200 shadow-xl transition-colors cursor-pointer">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Warstwy Taktyczne</span>
            </button>
            {showLayerMenu && (
              <div className="absolute right-0 mt-1.5 w-60 bg-zinc-950 border border-zinc-800 rounded-md shadow-2xl p-2.5 z-50 text-xs space-y-2">
                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input type="checkbox" checked={activeLayers.drones} onChange={(e) => setActiveLayers({ ...activeLayers, drones: e.target.checked })} className="accent-cyan-500 rounded" />
                  <span>Drony w powietrzu</span>
                </label>
                <label className="flex items-center gap-2 text-zinc-200 cursor-pointer hover:text-white">
                  <input type="checkbox" checked={activeLayers.friendlyUnits} onChange={(e) => setActiveLayers({ ...activeLayers, friendlyUnits: e.target.checked })} className="accent-blue-500 rounded" />
                  <span>Zespoły ratownicze PSP / ZRM</span>
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
            onAddZone={(newZone) => setIncidentZones((prev) => [...prev, newZone])}
            onRemoveZone={(zoneId) => setIncidentZones((prev) => prev.filter((z) => z.id !== zoneId))}
            onUnitCommand={handleUnitCommand}
            buildingDecayRisks={buildingDecayRisks}
            temperatureGrid={temperatureGrid}
          />
        </div>
      </div>

      {isOnboardingUnitOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="font-mono font-bold text-sm text-zinc-100 uppercase">Dyspozycja Zastępu</h3>
              <button onClick={() => setIsOnboardingUnitOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer">✕ Zamknij</button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const newUnit: TacticalMarker = {
                id: `UNIT-PSP-${Date.now()}`, type: 'FRIENDLY_UNIT', sector: 'SEKTOR A-3',
                coords: [52.2100 + (Math.random() - 0.5) * 0.001, 20.7890 + (Math.random() - 0.5) * 0.001] as [number, number], 
                label: newUnitCallsign, details: 'Wóz zadysponowany ręcznie.',
                status: 'W drodze', currentTask: 'STANDBY', unitStatus: 'ON_ROUTE',
                navigationPath: findRoadPath([52.2100, 20.7890], [52.2108 + (Math.random() - 0.5) * 0.001, 20.7895 + (Math.random() - 0.5) * 0.001] as [number, number]),
                waterLevel: 100, crewCount: newUnitCrew, reportStatus: 'Wjazd na teren akcji.'
              };
              setMarkers((prev) => [...prev, newUnit]);
              setIsOnboardingUnitOpen(false);
            }} className="space-y-3.5">
              <input type="text" value={newUnitCallsign} onChange={(e) => setNewUnitCallsign(e.target.value)} placeholder="Znak wywoławczy" className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 outline-none" required />
              <button type="submit" className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold cursor-pointer shadow-lg">Zintegruj i Dodaj do Siatki KDR</button>
            </form>
          </div>
        </div>
      )}

      <QuickActionModal isOpen={isQuickActionOpen} onClose={() => setIsQuickActionOpen(false)} onExecuteAction={handleQuickActionSelected} />
      <DroneFeedModal isOpen={Boolean(selectedDroneForFeed)} drone={selectedDroneForFeed} onClose={() => setSelectedDroneForFeed(null)} />
    </div>
  );
}