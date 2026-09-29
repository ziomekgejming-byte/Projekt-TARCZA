'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Incident, DroneTelemetry, HotSwapStation, TacticalMarker, TacticalZone, WeatherCondition, FireCell } from '@/types/tarcza';
import { OFFLINE_FACILITY_BUILDINGS, generateDynamicFireGrid, propagateFireGrid, haversineDistanceMeters, getPolygonCentroid, findRoadPath } from '@/lib/offline-maps-data';
import QuickActionModal from './QuickActionModal';
import DroneFeedModal from './DroneFeedModal';
import { Eye, Zap, Search, Users, Send, Bot, Video, Truck, BatteryCharging, SlidersHorizontal, LogOut, ArrowLeft, Wind, PlusCircle, BookOpen, Radio } from 'lucide-react';

const TacticalMicroMapDynamic = dynamic(() => import('./TacticalMicroMap'), { ssr: false });

const ENTRY_GATES: [number, number][] = [
  [52.2100, 20.7890], // Południe
  [52.2145, 20.7960], // Północny Wschód
  [52.2120, 20.7850], // Zachód
  [52.2080, 20.7940], // Południowy Wschód
];

const SAFE_PARKING_NODES: [number, number][] = [
  [52.2118, 20.7928], // Plac Centralny (Zachód B4)
  [52.2140, 20.7932], // Droga Północna (Północ B4)
  [52.2118, 20.7958], // Droga Wschodnia (Wschód B4)
  [52.2100, 20.7925], // Droga Południowa (Południe B4)
  [52.2118, 20.7898], // Droga Zachodnia (Dalsza)
];

function generateExternalSupport(incident: Incident): DroneTelemetry[] {
  const count = 3 + Math.floor(Math.random() * 2);
  const units: DroneTelemetry[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    units.push({
      id: `DRON-EXT-${i + 1}`, callsign: `EXT-PSP-0${i + 1}`, model: 'Patrol-UAV Eksternalny', battery: 85, altitude: 45 + i * 4, speed: 38, status: 'PATROL',
      coords: [incident.centerCoords[0] + Math.sin(angle) * 0.003, incident.centerCoords[1] + Math.cos(angle) * 0.003] as [number, number],
      vector: { dLat: 0, dLng: 0 }, payload: 'THERMAL_FLIR', pairingStatus: 'CONNECTED', isPaired: false, isExternalSupport: true,
      targetWaypoint: [incident.centerCoords[0], incident.centerCoords[1]] as [number, number], hoverDurationRemaining: 0, headingDeg: 0,
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
  onOpenSop,
  onOpenSupport
}: DashboardScreenProps) {
  const [activeTab, setActiveTab] = useState<'RECON' | 'EVACUATION' | 'SWARM' | 'LOGISTICS'>('RECON');
  const [leftPanelPercent, setLeftPanelPercent] = useState<number>(35);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);

  const [drones, setDrones] = useState<DroneTelemetry[]>(() => [...initialDrones, ...generateExternalSupport(incident)]);
  const [hotSwapStations, setHotSwapStations] = useState<HotSwapStation[]>(incident.hotSwapStations);
  const [markers, setMarkers] = useState<TacticalMarker[]>(() => incident.tacticalMarkers);
  const [weather, setWeather] = useState<WeatherCondition>(incident.weather || { windSpeedKmh: 18, windDirectionDeg: 225, windDirectionName: 'SW', temperatureC: 22, humidityPercent: 42 });
  
  const [temperatureGrid, setTemperatureGrid] = useState<FireCell[]>(() => generateDynamicFireGrid(incident.centerCoords));
  const [incidentZones, setIncidentZones] = useState<TacticalZone[]>(incident.zones || []);
  
  const [isOnboardingUnitOpen, setIsOnboardingUnitOpen] = useState<boolean>(false);
  const [newUnitCallsign, setNewUnitCallsign] = useState<string>('GCBA-5/32 OSP Ożarów');
  const [newUnitCrew, setNewUnitCrew] = useState<number>(4);

  // PRZYWRÓCONE ZMIENNE STANU
  const [mapCenterCoords, setMapCenterCoords] = useState<[number, number]>(incident.centerCoords);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [selectedDroneForFeed, setSelectedDroneForFeed] = useState<DroneTelemetry | null>(null);
  const [isDrawingHotSwap, setIsDrawingHotSwap] = useState<boolean>(false);
  const [activeEvacuationRoute, setActiveEvacuationRoute] = useState<string | null>(incident.suggestedEvacuationCorridor ? 'K-1' : null);

  const [activeLayers, setActiveLayers] = useState({ victims: true, fires: true, drones: true, friendlyUnits: true, hotSwapZones: true, sectors: true });
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAssistantLogs, setAiAssistantLogs] = useState<Array<{ role: 'user' | 'assistant'; text: string; time: string }>>([{ role: 'assistant', text: `Stanowisko dowodzenia KDR aktywne. Zintegrowano maszyny.`, time: '00:01' }]);

  const dronesRef = useRef(drones);
  const weatherRef = useRef(weather);
  const markersRef = useRef(markers);
  const temperatureGridRef = useRef(temperatureGrid);
  const hasReportedExtinguished = useRef(false);

  useEffect(() => {
    dronesRef.current = drones; weatherRef.current = weather; markersRef.current = markers; temperatureGridRef.current = temperatureGrid;
  }, [drones, weather, markers, temperatureGrid]);

  // GŁÓWNA PĘTLA SYMULACJI (1 sekunda)
  useEffect(() => {
    let tickCount = 0;
    const simulationInterval = setInterval(() => {
      tickCount += 1;
      const curWeather = weatherRef.current;
      const curDrones = dronesRef.current;

      // 1. POJAWIANIE SIĘ JEDNOSTEK (Z RÓŻNYCH BRAM)
      if (tickCount === 2 || tickCount % 12 === 0) {
        setMarkers((prevMarkers) => {
          if (prevMarkers.filter((m) => m.type === 'FRIENDLY_UNIT').length >= 10) return prevMarkers;
          
          const randomGate = ENTRY_GATES[Math.floor(Math.random() * ENTRY_GATES.length)];
          const gateCoords: [number, number] = [randomGate[0] + (Math.random() - 0.5) * 0.001, randomGate[1] + (Math.random() - 0.5) * 0.001];
          
          const hotCells = temperatureGridRef.current.filter(c => !c.isExtinguished && c.temperature > 150);
          let bestParking: [number, number] = SAFE_PARKING_NODES[0];
          
          if (hotCells.length > 0) {
            let maxScore = -1;
            for (const node of SAFE_PARKING_NODES) {
              const firesInRange = hotCells.filter(c => haversineDistanceMeters(node, c.coords) < 90).length;
              const score = firesInRange + Math.random() * 5; 
              if (score > maxScore) { maxScore = score; bestParking = node; }
            }
          }

          const targetCoords: [number, number] = [bestParking[0] + (Math.random() - 0.5) * 0.00015, bestParking[1] + (Math.random() - 0.5) * 0.00015];
          const roadPath = findRoadPath(gateCoords, bestParking);
          roadPath.push(targetCoords);

          const newUnit: TacticalMarker = {
            id: `UNIT-AUTO-${Date.now()}`, type: 'FRIENDLY_UNIT', sector: 'W AKCJI', coords: gateCoords,
            label: `Zastęp PSP-${Math.floor(10 + Math.random() * 90)}`, details: 'Zadysponowany automatycznie.',
            status: 'W drodze', currentTask: 'FIRE_FIGHTING', unitStatus: 'ON_ROUTE', navigationPath: roadPath,
            waterLevel: 100, crewCount: 4, reportStatus: 'Wjazd na teren akcji.',
          };
          return [...prevMarkers, newUnit];
        });
      }

      // 2. DYNAMICZNE PRZEGRUPOWANIE & RAPORT KOŃCOWY
      if (tickCount % 4 === 0) {
        setMarkers((prevMarkers) => {
          const hotCells = temperatureGridRef.current.filter(c => !c.isExtinguished && c.temperature > 150);
          
          if (hotCells.length === 0) {
            if (!hasReportedExtinguished.current) {
              hasReportedExtinguished.current = true;
              setAiAssistantLogs(prev => [...prev, { role: 'assistant', text: 'POŻAR UGASZONY: Przeszukiwanie pogorzeliska.', time: new Date().toLocaleTimeString().slice(0, 5) }]);
              return prevMarkers.map(m => m.type === 'FRIENDLY_UNIT' ? { ...m, unitStatus: 'SEARCHING' as const, status: 'PRZESZUKIWANIE' } : m);
            }
            return prevMarkers;
          }

          let logsToAdd: string[] = [];
          const updated = prevMarkers.map(marker => {
            if (marker.type === 'FRIENDLY_UNIT' && marker.currentTask === 'FIRE_FIGHTING') {
              const hasFireInRange = hotCells.some(c => haversineDistanceMeters(marker.coords, c.coords) < 90);
              if (!hasFireInRange && (!marker.navigationPath || marker.navigationPath.length === 0) && Math.random() < 0.3) {
                let bestParking: [number, number] = SAFE_PARKING_NODES[0];
                let maxScore = -1;
                for (const node of SAFE_PARKING_NODES) {
                  const firesInRange = hotCells.filter(c => haversineDistanceMeters(node, c.coords) < 90).length;
                  const score = firesInRange + Math.random() * 5;
                  if (score > maxScore) { maxScore = score; bestParking = node; }
                }
                const newTarget: [number, number] = [bestParking[0] + (Math.random() - 0.5) * 0.00015, bestParking[1] + (Math.random() - 0.5) * 0.00015];
                const newPath = findRoadPath(marker.coords, bestParking);
                newPath.push(newTarget);
                logsToAdd.push(`PRZEGRUPOWANIE: ${marker.label} zmienia stanowisko na obrzeża pożaru.`);
                return { ...marker, navigationPath: newPath, unitStatus: 'ON_ROUTE' as const, status: 'PRZEGRUPOWANIE' };
              }
            }
            return marker;
          });

          if (logsToAdd.length > 0) setAiAssistantLogs(prev => [...prev, ...logsToAdd.map(t => ({ role: 'assistant' as const, text: t, time: new Date().toLocaleTimeString().slice(0, 5) }))]);
          return updated;
        });
      }

      // 3. RUCH WÓZÓW I CHŁODZENIE
      setMarkers((prevMarkers) => prevMarkers.map((marker) => {
        if (marker.type === 'FRIENDLY_UNIT' && marker.navigationPath && marker.navigationPath.length > 0) {
          const path = [...marker.navigationPath];
          const nextWaypoint = path[0];
          const dist = haversineDistanceMeters(marker.coords, nextWaypoint);

          if (dist < 20) {
            path.shift();
            if (path.length === 0) return { ...marker, coords: nextWaypoint, navigationPath: undefined, unitStatus: 'EXTINGUISHING' as const, status: 'NATARCIE GAŚNICZE' };
            return { ...marker, coords: nextWaypoint, navigationPath: path };
          } else {
            const dLat = nextWaypoint[0] - marker.coords[0];
            const dLng = nextWaypoint[1] - marker.coords[1];
            const distDeg = Math.hypot(dLat, dLng) || 0.00001;
            const moveDeg = 35 / 111000; 
            const ratio = Math.min(1, moveDeg / distDeg);
            return { ...marker, coords: [marker.coords[0] + dLat * ratio, marker.coords[1] + dLng * ratio] as [number, number], navigationPath: path };
          }
        }
        return marker;
      }));

      // 4. CHŁODZENIE I PROPAGACJA (Automat Komórkowy)
      setTemperatureGrid((prevGrid) => {
        const extinguishingUnits = markersRef.current.filter((m) => m.type === 'FRIENDLY_UNIT' && m.unitStatus === 'EXTINGUISHING');
        
        let cooledGrid = prevGrid;
        if (extinguishingUnits.length > 0) {
          cooledGrid = prevGrid.map((cell) => {
            if (cell.isExtinguished && cell.temperature <= 40) return cell;
            const affectingUnits = extinguishingUnits.filter((u) => haversineDistanceMeters(u.coords, cell.coords) < 90);
            if (affectingUnits.length > 0) {
              const newTemp = Math.max(20, cell.temperature - affectingUnits.length * 45);
              return { ...cell, temperature: Math.round(newTemp), isExtinguished: newTemp < 150, fuelRemaining: Math.max(0, cell.fuelRemaining - 0.5) };
            }
            return cell;
          });
        }

        if (tickCount % 2 === 0) {
          return propagateFireGrid(cooledGrid, curWeather.windDirectionDeg, curWeather.windSpeedKmh);
        }
        return cooledGrid;
      });

    }, 1000);
    return () => clearInterval(simulationInterval);
  }, []);

  // PĘTLA DRONÓW (Predykcja i Zwiad)
  useEffect(() => {
    if (drones.length === 0) return;
    const interval = setInterval(() => {
      setDrones((prevDrones) =>
        prevDrones.map((drone) => {
          let currentTarget: [number, number] | undefined = drone.targetWaypoint;

          if (!currentTarget || Math.random() < 0.15) {
            const atRiskCells = temperatureGridRef.current.filter((c) => c.temperature > 60 && c.temperature < 150);
            const hotCells = temperatureGridRef.current.filter((c) => c.temperature >= 150 && !c.isExtinguished);

            if (atRiskCells.length > 0 && Math.random() < 0.6) {
              const targetCell = atRiskCells[Math.floor(Math.random() * atRiskCells.length)];
              currentTarget = [targetCell.coords[0] + (Math.random() - 0.5) * 0.001, targetCell.coords[1] + (Math.random() - 0.5) * 0.001] as [number, number];
              
              if (Math.random() < 0.02) {
                setAiAssistantLogs(prev => [...prev, { role: 'assistant', text: `DRON ${drone.callsign} OSTRZEGA: Wykryto silne nagrzewanie w sektorze obok pożaru! Ryzyko przeskoczenia ognia!`, time: new Date().toLocaleTimeString().slice(0, 5) }]);
              }
            } else if (hotCells.length > 0) {
              const targetCell = hotCells[Math.floor(Math.random() * hotCells.length)];
              currentTarget = [targetCell.coords[0] + (Math.random() - 0.5) * 0.002, targetCell.coords[1] + (Math.random() - 0.5) * 0.002] as [number, number];
            } else {
              currentTarget = [incident.centerCoords[0] + (Math.random() - 0.5) * 0.006, incident.centerCoords[1] + (Math.random() - 0.5) * 0.006] as [number, number];
            }
          }

          const distToWaypoint = haversineDistanceMeters(drone.coords, currentTarget);
          if (distToWaypoint < 14) return { ...drone, status: 'HOVERING', speed: 0 };

          const dLat = currentTarget[0] - drone.coords[0];
          const dLng = currentTarget[1] - drone.coords[1];
          const distDegrees = Math.hypot(dLat, dLng) || 0.0001;
          const ratio = Math.min(1, (36000 / 111000) / distDegrees);

          return { ...drone, status: 'PATROL', coords: [drone.coords[0] + dLat * ratio, drone.coords[1] + dLng * ratio] as [number, number], targetWaypoint: currentTarget };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [drones.length, incident.centerCoords]);

  const handlePointerDown = (e: React.PointerEvent) => { e.preventDefault(); isDraggingRef.current = true; window.addEventListener('pointermove', handlePointerMove); window.addEventListener('pointerup', handlePointerUp); };
  const handlePointerMove = (e: PointerEvent) => { if (!isDraggingRef.current || !containerRef.current) return; const rect = containerRef.current.getBoundingClientRect(); const newPercent = ((e.clientX - rect.left) / rect.width) * 100; if (newPercent >= 25 && newPercent <= 75) { setLeftPanelPercent(newPercent); window.dispatchEvent(new Event('resize')); } };
  const handlePointerUp = () => { isDraggingRef.current = false; window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); window.dispatchEvent(new Event('resize')); };

  const handleExecuteCommand = useCallback((cmdText?: string) => {
    const text = (cmdText || aiPrompt).trim();
    if (!text) return;
    const userEntry = { role: 'user' as const, text, time: new Date().toLocaleTimeString().slice(0, 5) };
    setAiAssistantLogs((prev) => [...prev, userEntry, { role: 'assistant', text: 'Rozkaz zarejestrowany.', time: new Date().toLocaleTimeString().slice(0, 5) }]);
    setAiPrompt('');
  }, [aiPrompt]);

  const handleUnitCommand = useCallback((markerId: string, cmd: 'FIRE_FIGHTING' | 'EVACUATION' | 'REPORT' | 'STANDBY') => {
    setMarkers((prevMarkers) => {
      const targetUnit = prevMarkers.find((m) => m.id === markerId);
      if (!targetUnit) return prevMarkers;

      if (cmd === 'FIRE_FIGHTING') {
        const roadPath = findRoadPath(targetUnit.coords, SAFE_PARKING_NODES[0]);
        return prevMarkers.map((m) => m.id === markerId ? { ...m, navigationPath: roadPath, currentTask: 'FIRE_FIGHTING', unitStatus: 'ON_ROUTE', status: 'W drodze do pożaru' } : m);
      }
      return prevMarkers;
    });
  }, []);

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
          
          {/* PRZYWRÓCONE PRZYCISKI SOP I WSPARCIA */}
          {onOpenSop && (
            <button onClick={onOpenSop} className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer">
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>SOP</span>
            </button>
          )}
          {onOpenSupport && (
            <button onClick={onOpenSupport} className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Wsparcie</span>
            </button>
          )}

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
              <div className="max-h-20 overflow-y-auto p-2 bg-zinc-900/70 border border-zinc-800 rounded text-[11px] text-zinc-300 font-sans leading-relaxed flex flex-col-reverse">
                {aiAssistantLogs.slice().reverse().map((log, idx) => (
                  <div key={idx} className="mb-1 pb-1 border-b border-zinc-800/50 last:border-0">
                    <span className="text-emerald-500 font-mono mr-1">[{log.time}]</span>
                    {log.text}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); setAiPrompt(''); }} className="flex items-center gap-1.5">
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
            centerCoords={mapCenterCoords}
            incidentZones={incidentZones}
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
              
              const randomGate = ENTRY_GATES[Math.floor(Math.random() * ENTRY_GATES.length)];
              const gateCoords: [number, number] = [randomGate[0] + (Math.random() - 0.5) * 0.001, randomGate[1] + (Math.random() - 0.5) * 0.001];
              
              const targetCoords: [number, number] = [SAFE_PARKING_NODES[0][0] + (Math.random() - 0.5) * 0.0015, SAFE_PARKING_NODES[0][1] + (Math.random() - 0.5) * 0.0015];

              const roadPath = findRoadPath(gateCoords, targetCoords);
              roadPath.push(targetCoords);

              const newUnit: TacticalMarker = {
                id: `UNIT-PSP-${Date.now()}`, type: 'FRIENDLY_UNIT', sector: 'SEKTOR A-3',
                coords: gateCoords, 
                label: newUnitCallsign, details: 'Wóz zadysponowany ręcznie.',
                status: 'W drodze', currentTask: 'FIRE_FIGHTING', unitStatus: 'ON_ROUTE',
                navigationPath: roadPath,
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

      <QuickActionModal isOpen={isQuickActionOpen} onClose={() => setIsQuickActionOpen(false)} onExecuteAction={() => {}} />
      <DroneFeedModal isOpen={Boolean(selectedDroneForFeed)} drone={selectedDroneForFeed} onClose={() => setSelectedDroneForFeed(null)} />
    </div>
  );
}