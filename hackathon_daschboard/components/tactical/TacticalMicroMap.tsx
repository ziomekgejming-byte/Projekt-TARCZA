'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DroneTelemetry, HotSwapStation, TacticalMarker, TacticalZone } from '@/types/tarcza';
import { GEOPORTAL_LAYERS, GeoportalLayerConfig } from '@/lib/geoportal/config';
import { OFFLINE_FACILITY_BUILDINGS } from '@/lib/offline-maps-data';
import L from 'leaflet';
import {
  Layers,
  Search,
  Users,
  Flame,
  BatteryCharging,
  ChevronDown,
  Compass,
  X,
  Crosshair,
  ShieldAlert,
  Radio,
  Clock,
  Building2,
  PhoneCall,
  Activity
} from 'lucide-react';

interface TacticalMicroMapProps {
  drones: DroneTelemetry[];
  hotSwapStations: HotSwapStation[];
  markers: TacticalMarker[];
  activeLayers: {
    victims: boolean;
    fires: boolean;
    drones: boolean;
    friendlyUnits: boolean;
    hotSwapZones: boolean;
    sectors: boolean;
  };
  onSelectMarker?: (marker: TacticalMarker) => void;
  onSelectDrone?: (drone: DroneTelemetry) => void;
  selectedDroneId?: string;
  isDrawingHotSwap?: boolean;
  onFinishDrawingHotSwap?: (newStation: HotSwapStation) => void;
  onCancelDrawingHotSwap?: () => void;
  activeEvacuationRoute?: string | null;
  centerCoords?: [number, number];
  onDroneEnterDangerZone?: (drone: DroneTelemetry, zone: TacticalZone) => void;
  incidentZones?: TacticalZone[];
  onAddZone?: (zone: TacticalZone) => void;
  onUnitCommand?: (markerId: string, command: 'FIRE_FIGHTING' | 'EVACUATION' | 'REPORT' | 'STANDBY') => void;
  buildingDecayRisks?: Record<string, number>;
}

export default function TacticalMicroMap({
  drones,
  hotSwapStations,
  markers,
  activeLayers,
  onSelectMarker,
  onSelectDrone,
  selectedDroneId,
  isDrawingHotSwap = false,
  onFinishDrawingHotSwap,
  onCancelDrawingHotSwap,
  activeEvacuationRoute,
  centerCoords,
  onDroneEnterDangerZone,
  incidentZones = [],
  onAddZone,
  onUnitCommand,
  buildingDecayRisks = {},
}: TacticalMicroMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | L.TileLayer.WMS | null>(null);

  // Layer groups for dynamic management
  const buildingsLayerRef = useRef<L.LayerGroup | null>(null);
  const victimsLayerRef = useRef<L.LayerGroup | null>(null);
  const firesLayerRef = useRef<L.LayerGroup | null>(null);
  const dronesLayerRef = useRef<L.LayerGroup | null>(null);
  const friendlyLayerRef = useRef<L.LayerGroup | null>(null);
  const hotSwapLayerRef = useRef<L.LayerGroup | null>(null);
  const sectorsLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);

  const [activeBaseLayerId, setActiveBaseLayerId] = useState<string>('osm');
  const [showLayerDropdown, setShowLayerDropdown] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  // Tactical Zoning (Krok 5: Two-click rectangle drawing for Strefa Śmierci / Zagrożenia)
  const [isDrawingZone, setIsDrawingZone] = useState<boolean>(false);
  const [zoneStartPoint, setZoneStartPoint] = useState<[number, number] | null>(null);
  const [tacticalZones, setTacticalZones] = useState<TacticalZone[]>([]);

  // Register global callback for popup interactive button clicks
  useEffect(() => {
    (window as any).tarczaExecuteUnitCommand = (markerId: string, cmd: any) => {
      onUnitCommand?.(markerId, cmd);
    };
    return () => {
      delete (window as any).tarczaExecuteUnitCommand;
    };
  }, [onUnitCommand]);

  // Switch base layer
  const switchBaseLayer = useCallback((layerConfig: GeoportalLayerConfig) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (currentTileLayerRef.current) {
      map.removeLayer(currentTileLayerRef.current);
      currentTileLayerRef.current = null;
    }

    let newLayer: L.TileLayer | L.TileLayer.WMS;

    if (layerConfig.id === 'osm' || layerConfig.tileUrl) {
      newLayer = L.tileLayer(
        layerConfig.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: layerConfig.attribution,
          maxZoom: 20,
        }
      );
    } else if (layerConfig.wmsUrl) {
      newLayer = L.tileLayer.wms(layerConfig.wmsUrl, {
        layers: layerConfig.wmtsLayerName || 'Raster',
        format: layerConfig.format || 'image/jpeg',
        transparent: !!layerConfig.transparent,
        version: '1.3.0',
        crs: L.CRS.EPSG3857,
        attribution: layerConfig.attribution,
        maxZoom: 20,
      });

      newLayer.on('tileerror', () => {
        setSearchNotice(`Warstwa ${layerConfig.name} niedostępna – powrót do OSM.`);
        setTimeout(() => setSearchNotice(null), 4000);
        if (currentTileLayerRef.current) {
          map.removeLayer(currentTileLayerRef.current);
        }
        const osmFallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap · GUGiK Geoportal',
          maxZoom: 20,
        }).addTo(map);
        currentTileLayerRef.current = osmFallback;
        setActiveBaseLayerId('osm');
      });
    } else {
      return;
    }

    newLayer.addTo(map);
    currentTileLayerRef.current = newLayer;
    setActiveBaseLayerId(layerConfig.id);
    setShowLayerDropdown(false);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultCenter: [number, number] = [52.2120, 20.7930];

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 16,
      zoomControl: false,
    });

    mapInstanceRef.current = map;

    // Base OSM Layer
    const baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap · GUGiK Geoportal',
      maxZoom: 20,
    }).addTo(map);

    currentTileLayerRef.current = baseLayer;

    // Initialize layer groups
    sectorsLayerRef.current = L.layerGroup().addTo(map);
    buildingsLayerRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    firesLayerRef.current = L.layerGroup().addTo(map);
    hotSwapLayerRef.current = L.layerGroup().addTo(map);
    victimsLayerRef.current = L.layerGroup().addTo(map);
    friendlyLayerRef.current = L.layerGroup().addTo(map);
    dronesLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Sync center when centerCoords prop changes
  useEffect(() => {
    if (centerCoords && mapInstanceRef.current) {
      mapInstanceRef.current.setView(centerCoords, 16);
    }
  }, [centerCoords]);

  // Click on map to add Hot-Swap station when in drawing mode
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (isDrawingHotSwap && onFinishDrawingHotSwap) {
        const newStation: HotSwapStation = {
          id: `HS-${Date.now().toString().slice(-4)}`,
          name: `Nowa Strefa Hot-Swap (${hotSwapStations.length + 1})`,
          coords: [e.latlng.lat, e.latlng.lng],
          radiusMeters: 35,
          availablePacks: 6,
          chargingPacks: 0,
          dronesInQueue: [],
        };
        onFinishDrawingHotSwap(newStation);
      }
    };

    if (isDrawingHotSwap) {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', onMapClick);
    } else if (!isDrawingZone) {
      map.getContainer().style.cursor = '';
    }

    return () => {
      map.off('click', onMapClick);
    };
  }, [isDrawingHotSwap, onFinishDrawingHotSwap, hotSwapStations.length, isDrawingZone]);

  // Tactical Zoning Click Handler (Two clicks: corner 1 -> corner 2)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleZoneClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawingZone) return;

      if (!zoneStartPoint) {
        // First click
        setZoneStartPoint([e.latlng.lat, e.latlng.lng]);
        setSearchNotice('Narożnik 1 wybrany. Kliknij w drugim rogu przekątnej, aby zamknąć Strefę Śmierci / Skażenia.');
      } else {
        // Second click: finalize zone
        const p1 = zoneStartPoint;
        const p2: [number, number] = [e.latlng.lat, e.latlng.lng];

        const minLat = Math.min(p1[0], p2[0]);
        const maxLat = Math.max(p1[0], p2[0]);
        const minLng = Math.min(p1[1], p2[1]);
        const maxLng = Math.max(p1[1], p2[1]);

        const newZone: TacticalZone = {
          id: `ZONE-${Date.now().toString().slice(-4)}`,
          name: 'STREFA ŚMIERCI / SKAŻENIA',
          type: 'DANGER_ZONE',
          bounds: [[minLat, minLng], [maxLat, maxLng]],
          color: '#ef4444',
          createdAt: new Date().toLocaleTimeString().slice(0, 5),
        };

        setTacticalZones((prev) => [...prev, newZone]);
        setIsDrawingZone(false);
        setZoneStartPoint(null);
        setSearchNotice('Ustanowiono STREFĘ ŚMIERCI. Drony w tym obszarze przyspieszą procedury.');
        setTimeout(() => setSearchNotice(null), 5000);
      }
    };

    if (isDrawingZone) {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', handleZoneClick);
    } else {
      if (!isDrawingHotSwap) map.getContainer().style.cursor = '';
    }

    return () => {
      map.off('click', handleZoneClick);
    };
  }, [isDrawingZone, zoneStartPoint, isDrawingHotSwap]);

  // Render Facility Buildings Polygons (Realistyczna Detekcja, Ściany i Ryzyko Zawalenia Stropu)
  useEffect(() => {
    if (!buildingsLayerRef.current) return;
    const layer = buildingsLayerRef.current;
    layer.clearLayers();

    OFFLINE_FACILITY_BUILDINGS.forEach((bld) => {
      const risk = buildingDecayRisks[bld.id] ?? bld.structuralDecayRisk ?? 15;
      const isCritical = risk >= 80;
      const isHigh = risk >= 40;

      const strokeColor = isCritical ? '#ef4444' : isHigh ? '#f59e0b' : '#38bdf8';
      const fillColor = isCritical ? '#ef4444' : isHigh ? '#f59e0b' : '#0284c7';

      const poly = L.polygon(bld.polygon, {
        color: strokeColor,
        weight: isCritical ? 3 : 2,
        dashArray: isCritical ? '6, 6' : undefined,
        fillColor,
        fillOpacity: isCritical ? 0.35 : 0.18,
      });

      const popupContent = `
        <div style="min-width: 230px; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${strokeColor}; background: ${strokeColor}20; padding: 2px 6px; border-radius: 3px;">
              ${bld.sector} · OBIEKT BUDOWLANY
            </span>
            <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: #a1a1aa;">
              ${bld.constructionType}
            </span>
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 4px;">${bld.name}</div>
          
          <div style="margin-top: 6px; margin-bottom: 6px; background: #18181b; padding: 6px; border-radius: 4px; border: 1px solid ${strokeColor}40;">
            <div style="display: flex; justify-content: space-between; font-size: 10px; font-family: monospace; margin-bottom: 3px;">
              <span style="color: #a1a1aa;">Integralność konstrukcji:</span>
              <b style="color: ${strokeColor}; font-weight: bold;">Ryzyko ${risk}%</b>
            </div>
            <div style="width: 100%; height: 5px; background: #27272a; border-radius: 2px; overflow: hidden;">
              <div style="width: ${risk}%; height: 100%; background: ${strokeColor};"></div>
            </div>
            ${isCritical ? '<div style="color: #ef4444; font-size: 9px; font-family: monospace; font-weight: bold; margin-top: 4px;">⚠️ ALARM KRYTYCZNY: Zawalenie nieuchronne! Nakaz wycofania.</div>' : ''}
          </div>

          <div style="font-size: 10px; color: #a1a1aa; line-height: 1.35; margin-bottom: 4px;">
            <b>Wejścia:</b> ${bld.entrances.map((e) => `<span style="color: ${e.status === 'CLEAR' ? '#10b981' : '#ef4444'}">${e.label}</span>`).join(', ')}
          </div>
          ${bld.hazards.length > 0 ? `<div style="font-size: 9px; font-family: monospace; color: #f87171;">Zagrożenia: ${bld.hazards.join('; ')}</div>` : ''}
        </div>
      `;

      poly.bindPopup(popupContent);
      poly.bindTooltip(bld.name, {
        permanent: false,
        className: 'bg-zinc-950 text-zinc-200 font-mono text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 shadow-md',
      });

      poly.addTo(layer);
    });
  }, [buildingDecayRisks]);

  // Render Tactical Zones (Zarówno zdefiniowane w incydencie, jak i narysowane przez KDR)
  useEffect(() => {
    if (!zonesLayerRef.current) return;
    const layer = zonesLayerRef.current;
    layer.clearLayers();

    const allZones = [...incidentZones, ...tacticalZones];

    allZones.forEach((z) => {
      const rect = L.rectangle(z.bounds as L.LatLngBoundsLiteral, {
        color: z.color || '#ef4444',
        weight: 2,
        dashArray: '6, 6',
        fillColor: z.color || '#ef4444',
        fillOpacity: 0.22,
      });

      rect.bindTooltip(`⚠️ ${z.name}`, {
        permanent: true,
        direction: 'center',
        className: 'bg-zinc-950 text-zinc-100 font-mono text-[10px] font-bold px-2 py-0.5 rounded border border-zinc-700 shadow-md',
      });

      rect.bindPopup(`
        <div style="min-width: 210px; font-family: inherit;">
          <div style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${z.color || '#ef4444'};">
            ${z.type || 'STREFA TAKTYCZNA'}
          </div>
          <div style="font-weight: 600; font-size: 12px; color: #f4f4f5; margin-top: 2px;">
            ${z.name}
          </div>
          <div style="font-size: 11px; color: #a1a1aa; margin-top: 3px;">
            Ustanowiona: ${z.createdAt || 'Podczas dyspozycji'}. Obowiązują reżimy zabezpieczenia dróg oddechowych.
          </div>
        </div>
      `);

      rect.addTo(layer);
    });
  }, [incidentZones, tacticalZones]);

  // Render Sectors Grid Overlay
  useEffect(() => {
    if (!sectorsLayerRef.current) return;
    const layer = sectorsLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.sectors) return;

    const baseCoords = centerCoords || [52.2120, 20.7930];

    const sectors = [
      {
        name: 'SEKTOR A (SZTAB KDR)',
        bounds: [[baseCoords[0] + 0.0020, baseCoords[1] - 0.0060], [baseCoords[0] + 0.0040, baseCoords[1]]] as L.LatLngBoundsLiteral,
        color: '#3b82f6',
      },
      {
        name: 'SEKTOR B (ZAGROŻENIE GŁÓWNE)',
        bounds: [[baseCoords[0], baseCoords[1]], [baseCoords[0] + 0.0020, baseCoords[1] + 0.0060]] as L.LatLngBoundsLiteral,
        color: '#ef4444',
      },
      {
        name: 'SEKTOR C (MAGAZYN / HAZMAT)',
        bounds: [[baseCoords[0] - 0.0020, baseCoords[1] - 0.0060], [baseCoords[0], baseCoords[1]]] as L.LatLngBoundsLiteral,
        color: '#a855f7',
      },
      {
        name: 'SEKTOR D (LOGISTYKA & TRIAGE)',
        bounds: [[baseCoords[0] - 0.0020, baseCoords[1]], [baseCoords[0], baseCoords[1] + 0.0060]] as L.LatLngBoundsLiteral,
        color: '#10b981',
      },
    ];

    sectors.forEach((s) => {
      const rect = L.rectangle(s.bounds, {
        color: s.color,
        weight: 1.5,
        dashArray: '4, 4',
        fillColor: s.color,
        fillOpacity: 0.06,
      });

      rect.bindTooltip(s.name, {
        permanent: true,
        direction: 'center',
        className: 'bg-zinc-950/80 text-[10px] font-mono font-bold text-zinc-300 px-1 py-0.5 border border-zinc-700/60 rounded',
      });

      rect.addTo(layer);
    });
  }, [activeLayers.sectors, centerCoords]);

  // Render Fires & Hazards (Circles & Markers)
  useEffect(() => {
    if (!firesLayerRef.current) return;
    const layer = firesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.fires) return;

    markers
      .filter((m) => m.type === 'FIRE_ZONE' || m.type === 'HAZMAT' || m.type === 'COLLAPSE_RISK')
      .forEach((m) => {
        const isFire = m.type === 'FIRE_ZONE';
        const color = isFire ? '#ef4444' : '#a855f7';
        const radius = m.radiusMeters || (isFire ? 70 : 100);

        const circle = L.circle(m.coords, {
          radius,
          color,
          weight: 2,
          dashArray: '6, 6',
          fillColor: color,
          fillOpacity: 0.22,
        });

        const iconHtml = `
          <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: ${color}33; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="width: 26px; height: 26px; border-radius: 50%; background: #09090b; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px ${color};">
              <span style="color: ${color}; font-size: 14px;">${isFire ? '🔥' : '☣️'}</span>
            </div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'tactical-div-icon',
          html: iconHtml,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = L.marker(m.coords, { icon });
        const popupContent = `
          <div style="min-width: 220px; font-family: inherit;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${color}; background: ${color}20; padding: 2px 6px; border-radius: 3px;">
                ${m.sector} · ${m.type}
              </span>
              ${m.temperature ? `<span style="font-size: 11px; font-weight: bold; color: #ef4444;">${m.temperature}°C</span>` : ''}
            </div>
            <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 3px;">${m.label}</div>
            <div style="font-size: 11px; color: #a1a1aa; line-height: 1.35; margin-bottom: 6px;">${m.details}</div>
            <div style="font-size: 10px; font-family: monospace; color: #71717a;">Promień strefy rażenia: ${radius} m</div>
          </div>
        `;

        marker.bindPopup(popupContent);
        circle.bindPopup(popupContent);

        circle.addTo(layer);
        marker.addTo(layer);
      });
  }, [markers, activeLayers.fires]);

  // Render Victims (Realistyczna Detekcja i Occlusion System + Liczniki Przeżycia)
  useEffect(() => {
    if (!victimsLayerRef.current) return;
    const layer = victimsLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.victims) return;

    markers
      .filter((m) => m.type === 'VICTIM')
      .forEach((m) => {
        const isLost = m.isLost || m.status === 'STRATA';
        const isEvacuating = m.status === 'W_TRAKCIE_EWAKUACJI';
        const isRescued = m.status === 'EWAKUOWANY' || m.status === 'URATOWANI';
        const isUnknown = m.isInsideBuilding && !m.isDiscovered && !isRescued && !isEvacuating && !isLost;

        let badgeBg = '#10b981';
        let mainColor = '#10b981';
        let labelText = m.trappedCount?.toString() || '!';

        if (isLost) {
          mainColor = '#71717a';
          badgeBg = '#71717a';
          labelText = 'STRATA';
        } else if (isEvacuating) {
          mainColor = '#06b6d4';
          badgeBg = '#06b6d4';
          labelText = 'RUN';
        } else if (isUnknown) {
          mainColor = '#a855f7';
          badgeBg = '#581c87';
          labelText = '?';
        }

        // Countdown progress bar over victim marker
        const hasTimer = !isLost && !isRescued && !isEvacuating && m.survivalSecondsLeft !== undefined && m.survivalSecondsLeft > 0;
        const percent = hasTimer ? Math.max(0, Math.min(100, Math.round((m.survivalSecondsLeft! / (m.timeLimitSeconds || 120)) * 100))) : 0;
        const barColor = percent < 30 ? '#ef4444' : percent < 60 ? '#f59e0b' : '#10b981';

        const timerHtml = hasTimer ? `
          <div style="position: absolute; top: -19px; left: -15px; width: 64px; background: #09090b; border: 1px solid ${barColor}; border-radius: 3px; padding: 1px 2px; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.85); pointer-events: none;">
            <div style="width: 100%; height: 3px; background: #27272a; border-radius: 1px; overflow: hidden; margin-bottom: 1px;">
              <div style="width: ${percent}%; height: 100%; background: ${barColor};"></div>
            </div>
            <div style="font-size: 8px; font-family: monospace; font-weight: bold; color: ${barColor}; line-height: 1;">
              PRZEŻYCIE: ${m.survivalSecondsLeft}s
            </div>
          </div>
        ` : isLost ? `
          <div style="position: absolute; top: -16px; left: -15px; width: 64px; background: #09090b; border: 1px solid #71717a; border-radius: 3px; padding: 1px; text-align: center;">
            <span style="font-size: 8px; font-family: monospace; font-weight: bold; color: #a1a1aa;">STRATA</span>
          </div>
        ` : isEvacuating ? `
          <div style="position: absolute; top: -16px; left: -15px; width: 64px; background: #09090b; border: 1px solid #06b6d4; border-radius: 3px; padding: 1px; text-align: center;">
            <span style="font-size: 8px; font-family: monospace; font-weight: bold; color: #06b6d4;">EWAKUACJA</span>
          </div>
        ` : isUnknown ? `
          <div style="position: absolute; top: -16px; left: -15px; width: 64px; background: #09090b; border: 1px solid #a855f7; border-radius: 3px; padding: 1px; text-align: center;">
            <span style="font-size: 8px; font-family: monospace; font-weight: bold; color: #c084fc;">NIEZNANY</span>
          </div>
        ` : '';

        const iconHtml = `
          <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            ${timerHtml}
            ${!isLost ? `<div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: ${mainColor}33; animation: ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
            <div style="width: 26px; height: 26px; border-radius: 50%; background: #09090b; border: 2px solid ${mainColor}; ${isUnknown ? 'border-style: dashed;' : ''} display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px ${mainColor};">
              <span style="color: ${mainColor}; font-weight: bold; font-size: ${labelText.length > 2 ? '8px' : '12px'}; font-family: monospace;">${labelText}</span>
            </div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'tactical-div-icon',
          html: iconHtml,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = L.marker(m.coords, { icon });
        const detectionBadge = m.detectionMethod && m.detectionMethod !== 'NONE'
          ? `<span style="font-size: 9px; font-family: monospace; color: #10b981; background: #10b98118; padding: 1px 4px; border-radius: 2px; border: 1px solid #10b98140;">WYKRYTO: ${m.detectionMethod}</span>`
          : isUnknown
          ? `<span style="font-size: 9px; font-family: monospace; color: #c084fc; background: #a855f720; padding: 1px 4px; border-radius: 2px; border: 1px solid #a855f750;">WNĘTRZE OBIEKTU (UKRYTY)</span>`
          : '';

        const popupContent = `
          <div style="min-width: 230px; font-family: inherit;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${mainColor}; background: ${mainColor}20; padding: 2px 6px; border-radius: 3px;">
                ${m.sector} · ${isUnknown ? 'SYGNAŁ NIEROZPOZNANY' : `POSZKODOWANI (${m.trappedCount || 1} os.)`}
              </span>
              <span style="font-size: 10px; color: ${isLost ? '#71717a' : isUnknown ? '#c084fc' : '#ef4444'}; font-weight: bold;">
                ${isLost ? 'STRATA' : isEvacuating ? 'EWAKUACJA' : isUnknown ? 'UKRYTY' : 'PILNE'}
              </span>
            </div>
            <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 4px;">${m.label}</div>
            <div style="font-size: 11px; color: #a1a1aa; line-height: 1.35; margin-bottom: 6px;">${m.details}</div>
            <div style="margin-bottom: 6px;">${detectionBadge}</div>
            ${hasTimer ? `<div style="font-size: 11px; font-mono; font-weight: bold; color: ${barColor}; margin-bottom: 4px;">Pozostało do uduszenia/zawalenia: ${m.survivalSecondsLeft}s</div>` : ''}
            <div style="background: #18181b; padding: 5px 7px; border-radius: 3px; font-size: 10px; font-family: monospace; color: ${mainColor};">
              Status: ${isUnknown ? 'Brak linii wzroku (Wymagany przelot LiDAR/FLIR lub wejście PSP)' : m.status || 'Oczekuje na pomoc'}
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
        marker.on('click', () => onSelectMarker?.(m));
        marker.addTo(layer);
      });
  }, [markers, activeLayers.victims, onSelectMarker]);

  // Render Friendly Units (Blue markers z zadaniami i interaktywnymi rozkazami KDR)
  useEffect(() => {
    if (!friendlyLayerRef.current) return;
    const layer = friendlyLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.friendlyUnits) return;

    markers
      .filter((m) => m.type === 'FRIENDLY_UNIT')
      .forEach((m) => {
        const isRetreated = m.status?.includes('WYCOFANI');
        const color = isRetreated ? '#06b6d4' : '#3b82f6';
        const task = m.currentTask || 'STANDBY';
        const water = m.waterLevel ?? 85;

        const iconHtml = `
          <div style="position: relative; width: 28px; height: 28px; border-radius: 6px; background: #09090b; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color}; cursor: pointer;">
            <span style="font-size: 13px;">🚒</span>
            <div style="position: absolute; bottom: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: ${task === 'FIRE_FIGHTING' ? '#ef4444' : task === 'EVACUATION' ? '#06b6d4' : '#10b981'}; border: 1px solid #09090b;"></div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'tactical-div-icon',
          html: iconHtml,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker(m.coords, { icon });
        const popupContent = `
          <div style="min-width: 240px; font-family: inherit;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${color}; background: ${color}20; padding: 2px 6px; border-radius: 3px;">
                ${m.sector} · JEDNOSTKA RATOWNICZA
              </span>
              <span style="font-size: 9px; font-family: monospace; color: #38bdf8; background: #0284c720; padding: 1px 4px; border-radius: 2px;">
                ZADANIE: ${task}
              </span>
            </div>
            <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 3px;">${m.label}</div>
            <div style="font-size: 11px; color: #a1a1aa; line-height: 1.35; margin-bottom: 6px;">${m.details}</div>
            
            <div style="background: #18181b; padding: 6px; border-radius: 4px; margin-bottom: 8px; font-size: 10px; font-family: monospace;">
              <div style="display: flex; justify-content: space-between; color: #38bdf8; margin-bottom: 3px;">
                <span>Zapas wody gaśniczej:</span>
                <b>${water}%</b>
              </div>
              <div style="width: 100%; height: 4px; background: #27272a; border-radius: 2px; overflow: hidden;">
                <div style="width: ${water}%; height: 100%; background: #0284c7;"></div>
              </div>
              ${m.reportStatus ? `<div style="color: #10b981; font-size: 9px; margin-top: 4px;">Meldunek: "${m.reportStatus}"</div>` : ''}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px;">
              <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'FIRE_FIGHTING')" style="background: #991b1b; hover: #b91c1c; color: white; border: none; padding: 5px 4px; border-radius: 3px; font-size: 9px; font-family: monospace; font-weight: bold; cursor: pointer;">
                🔥 GASZENIE
              </button>
              <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'EVACUATION')" style="background: #0284c7; color: white; border: none; padding: 5px 4px; border-radius: 3px; font-size: 9px; font-family: monospace; font-weight: bold; cursor: pointer;">
                🏃 EWAKUACJA
              </button>
              <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'REPORT')" style="background: #27272a; color: #10b981; border: 1px solid #3f3f46; padding: 5px 4px; border-radius: 3px; font-size: 9px; font-family: monospace; font-weight: bold; cursor: pointer;">
                📡 RAPORT
              </button>
            </div>
          </div>
        `;
        marker.bindPopup(popupContent);
        marker.on('click', () => onSelectMarker?.(m));
        marker.addTo(layer);
      });
  }, [markers, activeLayers.friendlyUnits, onSelectMarker]);

  // Render Hot-Swap Zones
  useEffect(() => {
    if (!hotSwapLayerRef.current) return;
    const layer = hotSwapLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.hotSwapZones) return;

    hotSwapStations.forEach((hs) => {
      const radius = hs.radiusMeters || 35;

      const circle = L.circle(hs.coords, {
        radius,
        color: '#f59e0b',
        weight: 1.5,
        fillColor: '#f59e0b',
        fillOpacity: 0.15,
      });

      const iconHtml = `
        <div style="width: 28px; height: 28px; border-radius: 50%; background: #09090b; border: 2px solid #f59e0b; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px #f59e0b; cursor: pointer;">
          <span style="font-size: 12px; color: #f59e0b; font-weight: bold;">⚡</span>
        </div>
      `;

      const icon = L.divIcon({
        className: 'tactical-div-icon',
        html: iconHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker(hs.coords, { icon });
      const popupContent = `
        <div style="min-width: 220px; font-family: inherit;">
          <div style="font-size: 10px; font-family: monospace; font-weight: bold; color: #f59e0b; margin-bottom: 3px;">
            STREFA LĄDOWANIA I WYMIANY BATERII
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 6px;">${hs.name}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: #18181b; padding: 6px; border-radius: 4px; font-size: 10px; font-family: monospace;">
            <div style="color: #10b981;">Pakiety gotowe: <b>${hs.availablePacks} szt.</b></div>
            <div style="color: #eab308;">Ładowanie: <b>${hs.chargingPacks} szt.</b></div>
          </div>
        </div>
      `;

      circle.bindPopup(popupContent);
      marker.bindPopup(popupContent);

      circle.addTo(layer);
      marker.addTo(layer);
    });
  }, [hotSwapStations, activeLayers.hotSwapZones]);

  // Render Drones (Krok 4: Distinct External Swarm Units & Waypoint Headings)
  useEffect(() => {
    if (!dronesLayerRef.current) return;
    const layer = dronesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.drones) return;

    drones.forEach((drone) => {
      const isSelected = drone.id === selectedDroneId;
      const isLowBattery = drone.battery < 25;
      const isExternal = drone.isExternalSupport === true;

      // Color scheme: External units are purple/indigo, internal swarm are cyan/emerald
      const color = isLowBattery
        ? '#ef4444'
        : isExternal
        ? '#818cf8'
        : isSelected
        ? '#10b981'
        : '#38bdf8';

      // Check if drone is currently inside any Danger Zone (Tactical Zoning consequence)
      const insideDangerZone = tacticalZones.some(
        (z) =>
          drone.coords[0] >= z.bounds[0][0] &&
          drone.coords[0] <= z.bounds[1][0] &&
          drone.coords[1] >= z.bounds[0][1] &&
          drone.coords[1] <= z.bounds[1][1]
      );

      const iconHtml = `
        <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
          ${isLowBattery ? `<div style="position: absolute; width: 36px; height: 36px; border-radius: 50%; background: rgba(239, 68, 68, 0.4); animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
          ${insideDangerZone ? `<div style="position: absolute; width: 40px; height: 40px; border-radius: 50%; border: 2px solid #ef4444; animation: ping 0.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
          <div style="width: 28px; height: 28px; border-radius: 50%; background: #09090b; border: 2px solid ${insideDangerZone ? '#ef4444' : color}; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color};">
            <span style="font-size: 10px; line-height: 1;">${isExternal ? '🛸' : '🚁'}</span>
            <span style="font-size: 8px; font-family: monospace; font-weight: bold; color: ${color}; line-height: 1;">${Math.round(drone.battery)}%</span>
          </div>
          ${isExternal ? `<div style="position: absolute; top: -6px; right: -4px; background: #4f46e5; color: #ffffff; font-size: 7px; font-family: monospace; font-weight: bold; padding: 0 2px; border-radius: 2px;">EXT</div>` : ''}
        </div>
      `;

      const icon = L.divIcon({
        className: 'tactical-div-icon',
        html: iconHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker(drone.coords, { icon });
      const popupContent = `
        <div style="min-width: 230px; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${color}; background: ${color}20; padding: 2px 6px; border-radius: 3px;">
              ${drone.callsign} ${isExternal ? '(WSPARCIE ZEWNĘTRZNE)' : ''}
            </span>
            <span style="font-size: 10px; font-family: monospace; color: #a1a1aa;">${drone.status}</span>
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 2px;">${drone.model}</div>
          <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 6px;">Ładunek: <b>${drone.payload}</b></div>
          ${insideDangerZone ? `<div style="color: #ef4444; font-size: 10px; font-mono; font-weight: bold; margin-bottom: 4px;">⚠️ DRON W STREFIE SKAŻENIA/ŚMIERCI! Przyspieszono przelot.</div>` : ''}
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: #18181b; padding: 6px; border-radius: 4px; font-size: 10px; font-family: monospace;">
            <div>Bateria: <b style="color: ${color};">${Math.round(drone.battery)}%</b></div>
            <div>Wysokość: <b>${drone.altitude} m</b></div>
            <div>Prędkość: <b>${drone.speed} km/h</b></div>
            <div>Kurs: <b>${drone.headingDeg || 0}°</b></div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => onSelectDrone?.(drone));
      marker.addTo(layer);
    });
  }, [drones, activeLayers.drones, selectedDroneId, onSelectDrone, tacticalZones]);

  // Render Evacuation Route Polyline
  useEffect(() => {
    if (!routeLayerRef.current) return;
    const layer = routeLayerRef.current;
    layer.clearLayers();

    if (!activeEvacuationRoute) return;

    const baseCoords = centerCoords || [52.2120, 20.7930];

    const corridorPoints: [number, number][] = [
      [baseCoords[0] + 0.0004, baseCoords[1] + 0.0012], // Window
      [baseCoords[0] + 0.0008, baseCoords[1] + 0.0006], // Stairwell
      [baseCoords[0] + 0.0015, baseCoords[1] - 0.0005], // Courtyard
      [baseCoords[0] + 0.0020, baseCoords[1] - 0.0020], // Gate
    ];

    const polyline = L.polyline(corridorPoints, {
      color: '#10b981',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.9,
    });

    polyline.bindTooltip('KORYTARZ EWAKUACJI KDR (AKTYWNY)', {
      permanent: true,
      className: 'bg-emerald-950 text-emerald-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/40',
    });

    polyline.addTo(layer);
  }, [activeEvacuationRoute, centerCoords]);

  // Handle Location Search
  const handleSearchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !mapInstanceRef.current) return;

    const coordsMatch = searchQuery.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordsMatch) {
      const lat = parseFloat(coordsMatch[1]);
      const lng = parseFloat(coordsMatch[3]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        mapInstanceRef.current.setView([lat, lng], 17);
        setSearchNotice(`Wyśrodkowano na współrzędnych: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
        setTimeout(() => setSearchNotice(null), 4000);
        return;
      }
    }

    setIsSearching(true);
    setSearchNotice('Wyszukiwanie adresu w PZGiK / OSM...');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery + ' Polska'
        )}&limit=1`
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        mapInstanceRef.current.setView([lat, lon], 17);
        setSearchNotice(`Znaleziono: ${data[0].display_name.slice(0, 45)}...`);
      } else {
        setSearchNotice('Nie znaleziono wskazanego adresu w bazie.');
      }
    } catch {
      setSearchNotice('Błąd wyszukiwania geolokalizacji.');
    } finally {
      setIsSearching(false);
      setTimeout(() => setSearchNotice(null), 4000);
    }
  };

  // Center on Current GPS
  const handleGpsCenter = () => {
    if (!mapInstanceRef.current) return;
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapInstanceRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 17);
          setSearchNotice('Wyśrodkowano na bieżącej pozycji GPS.');
          setTimeout(() => setSearchNotice(null), 3000);
        },
        () => {
          mapInstanceRef.current?.setView(centerCoords || [52.2120, 20.7930], 16);
        }
      );
    } else {
      mapInstanceRef.current.setView(centerCoords || [52.2120, 20.7930], 16);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 overflow-hidden bg-zinc-950">
      {/* Top Controls: Location Search Bar + Zoning Tool + Base Layer Selector */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto max-w-lg w-full">
          {/* Search input for address or coordinates */}
          <form
            onSubmit={handleSearchLocation}
            className="flex items-center gap-1.5 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 p-1 rounded-md shadow-lg flex-1"
          >
            <Search className="w-3.5 h-3.5 text-zinc-400 ml-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj adresu lub współrzędnych lat, lng..."
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none px-1 font-sans"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded transition-colors shrink-0 cursor-pointer"
            >
              Idź
            </button>
            <button
              type="button"
              onClick={handleGpsCenter}
              className="p-1 hover:bg-zinc-800 text-emerald-400 rounded transition-colors shrink-0 cursor-pointer"
              title="Lokalizacja z GPS"
            >
              <Compass className="w-4 h-4" />
            </button>
          </form>

          {/* Krok 5: Narzędzie Zaznaczania Strefy Zagrożenia / Śmierci */}
          <button
            type="button"
            onClick={() => {
              setIsDrawingZone(!isDrawingZone);
              setZoneStartPoint(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border shadow-lg transition-colors cursor-pointer shrink-0 ${
              isDrawingZone
                ? 'bg-rose-600 text-white border-rose-500 font-bold animate-pulse'
                : 'bg-zinc-950/90 backdrop-blur-md hover:bg-zinc-900 border-zinc-800 text-rose-300'
            }`}
            title="Narysuj prostokątną Strefę Śmierci / Skażenia (2 kliknięcia)"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>{isDrawingZone ? 'Anuluj strefę' : 'Zaznacz Strefę Zagrożenia'}</span>
          </button>
        </div>

        {/* Base Layer Switcher */}
        <div className="relative pointer-events-auto">
          <button
            onClick={() => setShowLayerDropdown(!showLayerDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950/90 backdrop-blur-md hover:bg-zinc-900 border border-zinc-800 rounded-md text-xs font-medium text-zinc-200 shadow-lg transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Podkład:</span>
            <span className="text-emerald-400 font-mono">
              {GEOPORTAL_LAYERS.find((l) => l.id === activeBaseLayerId)?.name.split(' ')[0] || 'OSM'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>

          {showLayerDropdown && (
            <div className="absolute right-0 mt-1 w-64 bg-zinc-950 border border-zinc-800 rounded-md shadow-xl py-1 z-50 text-xs">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                Podkłady Geoportalu i OSM
              </div>
              {GEOPORTAL_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => switchBaseLayer(layer)}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-zinc-900 transition-colors cursor-pointer ${
                    activeBaseLayerId === layer.id ? 'bg-zinc-900/80 border-l-2 border-emerald-500' : ''
                  }`}
                >
                  <span className={`font-medium ${activeBaseLayerId === layer.id ? 'text-emerald-400' : 'text-zinc-200'}`}>
                    {layer.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 line-clamp-1">{layer.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Banners for Drawing Modes */}
      {isDrawingHotSwap && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-amber-950/95 border border-amber-500 rounded-md shadow-2xl flex items-center gap-3 text-amber-200 text-xs backdrop-blur-md animate-pulse">
          <BatteryCharging className="w-4 h-4 text-amber-400 shrink-0" />
          <span><b>TRYB EDYCJI:</b> Kliknij dowolne miejsce na mapie, aby utworzyć nową strefę wymiany baterii Hot-Swap (promień 35m).</span>
          <button
            onClick={onCancelDrawingHotSwap}
            className="p-1 hover:bg-amber-900 text-amber-300 rounded cursor-pointer"
            title="Anuluj"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isDrawingZone && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-rose-950/95 border border-rose-500 rounded-md shadow-2xl flex items-center gap-3 text-rose-200 text-xs backdrop-blur-md animate-pulse">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>
            {zoneStartPoint
              ? 'Narożnik 1 wybrany! Kliknij w przeciwległym rogu, aby wyznaczyć STREFĘ ŚMIERCI.'
              : 'Kliknij na mapie pierwszy narożnik strefy skażenia/śmierci.'}
          </span>
          <button
            onClick={() => {
              setIsDrawingZone(false);
              setZoneStartPoint(null);
            }}
            className="p-1 hover:bg-rose-900 text-rose-300 rounded cursor-pointer"
            title="Anuluj"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Status Notice Toast */}
      {searchNotice && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-3.5 py-1.5 bg-zinc-900/95 border border-zinc-700 rounded-md shadow-xl text-zinc-200 text-xs backdrop-blur-md">
          {searchNotice}
        </div>
      )}

      {/* Floating Zoom & Center Buttons */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={() => mapInstanceRef.current?.setView(centerCoords || [52.2120, 20.7930], 16)}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center shadow-lg transition-colors cursor-pointer"
          title="Wyśrodkuj na centrum akcji"
        >
          <Crosshair className="w-4 h-4 text-emerald-400" />
        </button>
        <button
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer"
          title="Przybliż"
        >
          +
        </button>
        <button
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer"
          title="Oddal"
        >
          -
        </button>
      </div>

      {/* Bottom Coordinates & Live Layer Counter */}
      <div className="absolute bottom-3 left-3 z-[1000] px-2.5 py-1 bg-zinc-950/80 backdrop-blur-xs border border-zinc-800/80 rounded text-[10px] font-mono text-zinc-400 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>CENTRUM AKCJI: [{(centerCoords?.[0] || 52.2120).toFixed(4)}° N, {(centerCoords?.[1] || 20.7930).toFixed(4)}° E]</span>
        </div>
        <span className="text-zinc-600">|</span>
        <span>DRONY W POWIETRZU: {drones.length}</span>
        {tacticalZones.length > 0 && (
          <>
            <span className="text-zinc-600">|</span>
            <span className="text-rose-400 font-bold">STREFY ZAGROŻENIA: {tacticalZones.length}</span>
          </>
        )}
      </div>

      {/* Leaflet DOM container */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />
    </div>
  );
}
