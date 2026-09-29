'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DroneTelemetry, HotSwapStation, TacticalMarker, TacticalZone, FireCell } from '@/types/tarcza';
import { GEOPORTAL_LAYERS, GeoportalLayerConfig } from '@/lib/geoportal/config';
import {
  OFFLINE_FACILITY_BUILDINGS,
  OFFLINE_WATER_BODIES,
  MAX_HOSE_LENGTH_METERS,
  computePolygonBounds,
  computePolygonAreaM2,
  findNearestWaterBody,
} from '@/lib/offline-maps-data';
import L from 'leaflet';
import {
  Layers,
  BatteryCharging,
  ChevronDown,
  X,
  Crosshair,
  ShieldAlert,
  Undo2,
  Check,
  Waves,
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
  onRemoveZone?: (zoneId: string) => void;
  onUnitCommand?: (markerId: string, command: 'FIRE_FIGHTING' | 'EVACUATION' | 'REPORT' | 'STANDBY') => void;
  onWaterConnect?: (unitId: string, waterBodyId: string) => void;
  buildingDecayRisks?: Record<string, number>;
  temperatureGrid?: FireCell[];
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
  onRemoveZone,
  onUnitCommand,
  onWaterConnect,
  buildingDecayRisks = {},
  temperatureGrid = [],
}: TacticalMicroMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | L.TileLayer.WMS | null>(null);

  // Layer groups for dynamic management
  const buildingsLayerRef = useRef<L.LayerGroup | null>(null);
  const waterLayerRef = useRef<L.LayerGroup | null>(null);
  const victimsLayerRef = useRef<L.LayerGroup | null>(null);
  const firesLayerRef = useRef<L.LayerGroup | null>(null);
  const dronesLayerRef = useRef<L.LayerGroup | null>(null);
  const friendlyLayerRef = useRef<L.LayerGroup | null>(null);
  const hotSwapLayerRef = useRef<L.LayerGroup | null>(null);
  const sectorsLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const hosesLayerRef = useRef<L.LayerGroup | null>(null);
  const auxTacticalLayerRef = useRef<L.LayerGroup | null>(null);
  const activeDrawLayerRef = useRef<L.LayerGroup | null>(null);

  // Słowniki do śledzenia znaczników, aby ich nie usuwać, lecz tylko przesuwać (zapobieganie mruganiu i zamykaniu popupów)
  const friendlyMarkersMap = useRef<Record<string, L.Marker>>({});
  const victimsMarkersMap = useRef<Record<string, L.Marker>>({});

  const [activeBaseLayerId, setActiveBaseLayerId] = useState<string>('osm');
  const [showLayerDropdown, setShowLayerDropdown] = useState<boolean>(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  // Ręczne rysowanie wielokątów stref (Poligony)
  const [isDrawingPolygon, setIsDrawingPolygon] = useState<boolean>(false);
  const [activePolygonPoints, setActivePolygonPoints] = useState<[number, number][]>([]);
  const [newZoneName, setNewZoneName] = useState<string>('Strefa Pożaru B-4');
  const [newZoneType, setNewZoneType] = useState<'DANGER_ZONE' | 'NO_FLY' | 'SEARCH_AREA' | 'WATER_CURTAIN'>('DANGER_ZONE');
  const [newZoneColor, setNewZoneColor] = useState<string>('#ef4444');

  // Register global callback for popup interactive button clicks
  useEffect(() => {
    (window as any).tarczaExecuteUnitCommand = (markerId: string, cmd: any) => {
      onUnitCommand?.(markerId, cmd);
    };
    (window as any).tarczaConnectWater = (unitId: string, waterBodyId: string) => {
      onWaterConnect?.(unitId, waterBodyId);
    };
    (window as any).tarczaRemoveZone = (zoneId: string) => {
      onRemoveZone?.(zoneId);
    };
    return () => {
      delete (window as any).tarczaExecuteUnitCommand;
      delete (window as any).tarczaConnectWater;
      delete (window as any).tarczaRemoveZone;
    };
  }, [onUnitCommand, onWaterConnect, onRemoveZone]);

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

  const initialCenterRef = useRef(centerCoords);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = initialCenterRef.current || [52.2120, 20.7930];
    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    mapInstanceRef.current = map;

    // Default OSM tile layer
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
    }).addTo(map);
    currentTileLayerRef.current = osm;

    // Initialize all LayerGroups
    waterLayerRef.current = L.layerGroup().addTo(map);
    buildingsLayerRef.current = L.layerGroup().addTo(map);
    sectorsLayerRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    hotSwapLayerRef.current = L.layerGroup().addTo(map);
    firesLayerRef.current = L.layerGroup().addTo(map);
    hosesLayerRef.current = L.layerGroup().addTo(map);
    auxTacticalLayerRef.current = L.layerGroup().addTo(map);
    victimsLayerRef.current = L.layerGroup().addTo(map);
    friendlyLayerRef.current = L.layerGroup().addTo(map);
    dronesLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    activeDrawLayerRef.current = L.layerGroup().addTo(map);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    // Multi-stage size invalidation
    const t1 = setTimeout(() => map.invalidateSize(), 80);
    const t2 = setTimeout(() => map.invalidateSize(), 250);
    const t3 = setTimeout(() => map.invalidateSize(), 600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
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
    } else if (!isDrawingPolygon) {
      map.getContainer().style.cursor = '';
    }

    return () => {
      map.off('click', onMapClick);
    };
  }, [isDrawingHotSwap, onFinishDrawingHotSwap, hotSwapStations.length, isDrawingPolygon]);

  // Active Polygon Drawing Preview
  useEffect(() => {
    if (!activeDrawLayerRef.current) return;
    const layer = activeDrawLayerRef.current;
    layer.clearLayers();

    if (!isDrawingPolygon || activePolygonPoints.length === 0) return;

    // Draw vertex dots
    activePolygonPoints.forEach((pt, idx) => {
      const isFirst = idx === 0;
      const dot = L.circleMarker(pt, {
        radius: isFirst ? 6 : 4,
        color: isFirst ? '#ffffff' : newZoneColor,
        weight: 2,
        fillColor: newZoneColor,
        fillOpacity: 0.9,
      });
      dot.bindTooltip(`Wierzchołek #${idx + 1}${isFirst ? ' (Początek)' : ''}`, {
        permanent: false,
        className: 'font-mono text-[9px]',
      });
      dot.addTo(layer);
    });

    // Draw connecting lines
    if (activePolygonPoints.length >= 2) {
      L.polyline(activePolygonPoints, {
        color: newZoneColor,
        weight: 2.5,
        dashArray: '5, 5',
      }).addTo(layer);
    }

    if (activePolygonPoints.length >= 3) {
      L.polygon(activePolygonPoints, {
        color: newZoneColor,
        weight: 1.5,
        fillColor: newZoneColor,
        fillOpacity: 0.18,
      }).addTo(layer);
    }
  }, [activePolygonPoints, isDrawingPolygon, newZoneColor]);

  // Handle map click during polygon drawing
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleZoneClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawingPolygon) return;
      setActivePolygonPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
    };

    if (isDrawingPolygon) {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', handleZoneClick);
    } else if (!isDrawingHotSwap) {
      map.getContainer().style.cursor = '';
    }

    return () => {
      map.off('click', handleZoneClick);
    };
  }, [isDrawingPolygon, isDrawingHotSwap]);

  const handleFinishPolygon = () => {
    if (activePolygonPoints.length < 3) return;

    const bounds = computePolygonBounds(activePolygonPoints);
    const areaM2 = computePolygonAreaM2(activePolygonPoints);

    const newZone: TacticalZone = {
      id: `ZONE-${Date.now()}`,
      name: newZoneName.trim() || 'Strefa Operacyjna',
      type: newZoneType,
      polygon: activePolygonPoints,
      bounds,
      color: newZoneColor,
      createdAt: new Date().toLocaleTimeString().slice(0, 5),
      areaM2,
    };

    onAddZone?.(newZone);
    setIsDrawingPolygon(false);
    setActivePolygonPoints([]);
    setSearchNotice(`Ustanowiono strefę "${newZone.name}" (${areaM2.toLocaleString()} m²).`);
    setTimeout(() => setSearchNotice(null), 4000);
  };

  const handleCancelDrawing = () => {
    setIsDrawingPolygon(false);
    setActivePolygonPoints([]);
  };

  const handleUndoPoint = () => {
    setActivePolygonPoints((prev) => prev.slice(0, -1));
  };

  // Render Water Bodies (Otwarte baseny ppoż. i cieki)
  useEffect(() => {
    if (!waterLayerRef.current) return;
    const layer = waterLayerRef.current;
    layer.clearLayers();

    OFFLINE_WATER_BODIES.forEach((wb) => {
      const waterPoly = L.polygon(wb.polygon, {
        color: '#0284c7',
        weight: 2,
        fillColor: '#0369a1',
        fillOpacity: 0.45,
        dashArray: '4, 4',
      });

      waterPoly.bindTooltip(`💧 ${wb.name} (${wb.capacityLiters.toLocaleString()} l)`, {
        permanent: false,
        className: 'bg-cyan-950 text-cyan-200 font-mono text-[10px] px-2 py-0.5 rounded border border-cyan-600 shadow-md',
      });

      waterPoly.bindPopup(`
        <div style="min-width: 220px; font-family: inherit;">
          <div style="font-size: 10px; font-family: monospace; font-weight: bold; color: #38bdf8;">
            OTWARTY ZBIORNIK WODNY PPOŻ
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-top: 2px;">
            ${wb.name}
          </div>
          <div style="font-size: 11px; color: #a1a1aa; margin-top: 4px;">
            Pojemność bufora: <b>${wb.capacityLiters.toLocaleString()} litrów</b>.
          </div>
          <div style="background: #082f4940; border: 1px solid #0284c750; padding: 6px; border-radius: 4px; margin-top: 6px; font-size: 10px; font-family: monospace; color: #38bdf8;">
            ✓ Dostępny nieograniczony pobór wody dla motopomp i wozów bojowych GCBA (bonus x2 do tempa gaszenia).
          </div>
        </div>
      `);

      waterPoly.addTo(layer);
    });
  }, []);

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

  // Render Tactical Zones as Polygons (Dynamic Fire Expansion & Contraction)
  useEffect(() => {
    if (!zonesLayerRef.current) return;
    const layer = zonesLayerRef.current;
    layer.clearLayers();

    incidentZones.forEach((z) => {
      const coords = z.polygon && z.polygon.length >= 3
        ? z.polygon
        : [
            [z.bounds![0][0], z.bounds![0][1]],
            [z.bounds![1][0], z.bounds![0][1]],
            [z.bounds![1][0], z.bounds![1][1]],
            [z.bounds![0][0], z.bounds![1][1]],
          ] as [number, number][];

      const isFire = z.type === 'DANGER_ZONE';
      const isExtinguished = z.isExtinguished === true;

      const strokeColor = isExtinguished ? '#10b981' : z.color || '#ef4444';
      const fillColor = isExtinguished ? '#059669' : z.color || '#ef4444';
      const fillOpacity = isExtinguished ? 0.15 : isFire ? 0.32 : 0.22;

      const poly = L.polygon(coords, {
        color: strokeColor,
        weight: isFire && !isExtinguished ? 2.5 : 2,
        dashArray: z.type === 'NO_FLY' ? '6, 6' : isExtinguished ? '4, 4' : undefined,
        fillColor,
        fillOpacity,
      });

      const areaText = z.areaM2 ? ` (${z.areaM2.toLocaleString()} m²)` : '';
      const statusPrefix = isExtinguished ? '✅ UGASZONY: ' : isFire ? '🔥 ' : '⚠️ ';

      poly.bindTooltip(`${statusPrefix}${z.name}${areaText}`, {
        permanent: true,
        direction: 'center',
        className: isExtinguished
          ? 'bg-zinc-950 text-emerald-300 font-mono text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-600 shadow-md'
          : 'bg-zinc-950 text-zinc-100 font-mono text-[10px] font-bold px-2 py-0.5 rounded border border-zinc-700 shadow-md',
      });

      poly.bindPopup(`
        <div style="min-width: 220px; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${strokeColor};">
              ${isExtinguished ? 'STREFA UGASZONA' : z.type}
            </span>
            <span style="font-size: 9px; font-family: monospace; color: #a1a1aa;">${z.createdAt}</span>
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 4px;">
            ${z.name}
          </div>
          ${z.areaM2 ? `<div style="font-size: 10px; font-family: monospace; color: #a1a1aa; margin-bottom: 4px;">Powierzchnia dynamiczna: <b>${z.areaM2.toLocaleString()} m²</b></div>` : ''}
          <div style="font-size: 10px; color: #71717a; margin-bottom: 8px;">
            ${isFire ? (isExtinguished ? 'Ogień ugaszony przez jednostki PSP. Brak zagrożenia.' : 'Aktywny front pożarowy. Bez natarcia ulega rozszerzeniu z wiatrem.') : 'Reżim taktyczny ustanowiony przez KDR.'}
          </div>
          <button onclick="window.tarczaRemoveZone('${z.id}')" style="width: 100%; background: #27272a; hover: #3f3f46; color: #f87171; border: 1px solid #7f1d1d; padding: 4px; border-radius: 3px; font-size: 9px; font-family: monospace; cursor: pointer;">
            🗑️ Usuń strefę z mapy
          </button>
        </div>
      `);

      poly.addTo(layer);
    });
  }, [incidentZones]);

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

  // Render Fires & Hazards (Siatka Temperatury 10m x 10m / Heatmapa)
  useEffect(() => {
    if (!firesLayerRef.current) return;
    const layer = firesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.fires) return;

    if (temperatureGrid && temperatureGrid.length > 0) {
      temperatureGrid.forEach((cell) => {
        if (cell.isExtinguished && cell.temperature < 80) return;

        let fillColor = '#eab308';
        let strokeColor = '#ca8a04';
        let fillOpacity = 0.35;

        if (cell.temperature >= 750) {
          fillColor = '#7f1d1d';
          strokeColor = '#ef4444';
          fillOpacity = 0.78;
        } else if (cell.temperature >= 550) {
          fillColor = '#ea580c';
          strokeColor = '#f97316';
          fillOpacity = 0.65;
        } else if (cell.temperature >= 350) {
          fillColor = '#f59e0b';
          strokeColor = '#fbbf24';
          fillOpacity = 0.5;
        }

        const rect = L.rectangle(cell.bounds, {
          color: strokeColor,
          weight: 1,
          dashArray: cell.temperature >= 750 ? '3, 3' : undefined,
          fillColor,
          fillOpacity,
        });

        rect.bindTooltip(`🔥 ${cell.temperature}°C · Paliwo: ${cell.fuelRemaining}%`, {
          permanent: false,
          className: 'bg-zinc-950 text-amber-300 font-mono text-[9px] px-1 py-0.5 rounded border border-amber-600/80 shadow',
        });

        rect.addTo(layer);
      });
    }
  }, [activeLayers.fires, temperatureGrid]);

  // Render Victims (Occlusion System + Czystość Mapy: Uratowani są natychmiast usuwani!)
  useEffect(() => {
    if (!victimsLayerRef.current) return;
    const layer = victimsLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.victims) return;

    markers
      .filter((m) => m.type === 'VICTIM')
      .forEach((m) => {
        // CZYSTOŚĆ MAPY: Jeśli poszkodowany został ewakuowany / uratowany, znika z mapy!
        if (
          m.status === 'EWAKUOWANY' ||
          m.status === 'URATOWANY' ||
          m.status === 'URATOWANI' ||
          m.status === 'RESCUED'
        ) {
          return;
        }

        const isLost = m.isLost || m.status === 'STRATA';
        const isEvacuating = m.status === 'W_TRAKCIE_EWAKUACJI';
        const isUnknown = m.isInsideBuilding && !m.isDiscovered && !isEvacuating && !isLost;

        let mainColor = '#10b981';
        let labelText = m.trappedCount?.toString() || '!';

        if (isLost) {
          mainColor = '#71717a';
          labelText = 'STRATA';
        } else if (isEvacuating) {
          mainColor = '#06b6d4';
          labelText = 'RUN';
        } else if (isUnknown) {
          mainColor = '#a855f7';
          labelText = '?';
        }

        const hasTimer = !isLost && !isEvacuating && m.survivalSecondsLeft !== undefined && m.survivalSecondsLeft > 0;
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

  // Render Friendly Units & Innych KDR (Logika Dróg, Wejście, Wyposażenie, Brak Mrugania)
  useEffect(() => {
    if (!friendlyLayerRef.current) return;
    const layer = friendlyLayerRef.current;

    if (!activeLayers.friendlyUnits) {
      layer.clearLayers();
      friendlyMarkersMap.current = {};
      return;
    }

    const currentIds = new Set<string>();

    markers
      .filter((m) => m.type === 'FRIENDLY_UNIT' || m.type === 'KDR_STATION')
      .forEach((m) => {
        currentIds.add(m.id);
        const isTrapped = m.unitStatus === 'TRAPPED';
        const isExtinguishing = m.unitStatus === 'EXTINGUISHING';
        const isOnRoute = m.unitStatus === 'ON_ROUTE' || (m.navigationPath && m.navigationPath.length > 0);
        const isInside = m.unitStatus === 'INSIDE_BUILDING' || m.status?.includes('WEJŚCIE');
        const hasInfiniteWater = m.hasInfiniteWaterSupply || m.unitStatus === 'WATER_PUMPING';
        const isKDR = m.type === 'KDR_STATION';
        const isZRM = m.label.includes('ZRM');
        const isDrabina = m.label.includes('Drabina') || m.label.includes('SD');

        const color = isTrapped ? '#ef4444' : isKDR ? '#eab308' : isZRM ? '#f43f5e' : isInside ? '#f59e0b' : hasInfiniteWater ? '#06b6d4' : isExtinguishing ? '#e11d48' : isOnRoute ? '#38bdf8' : '#3b82f6';
        const water = hasInfiniteWater ? 100 : (m.waterLevel ?? 85);
        const iconEmoji = isKDR ? '🛡️' : isZRM ? '🚑' : isDrabina ? '🪜' : isTrapped ? '🚨' : isInside ? '🏢' : isExtinguishing ? '💦' : '🚒';

        const iconHtml = `
          <div style="position: relative; width: 32px; height: 32px; border-radius: 6px; background: #09090b; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px ${color}; cursor: pointer;">
            ${isTrapped ? `<div style="position: absolute; width: 36px; height: 36px; border-radius: 8px; background: rgba(239, 68, 68, 0.4); animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
            <span style="font-size: 14px;">${iconEmoji}</span>
            ${isOnRoute ? `<div style="position: absolute; top: -5px; left: -5px; width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; animation: ping 1.2s infinite;"></div>` : ''}
          </div>
        `;

        const icon = L.divIcon({ className: 'tactical-div-icon', html: iconHtml, iconSize: [32, 32], iconAnchor: [16, 16] });

        // Generowanie dedykowanych przycisków w zależności od typu jednostki
        let actionButtons = '';
        if (isKDR) {
          actionButtons = `
            <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'REPORT')" style="background: #eab308; color: black; border: none; padding: 5px; border-radius: 3px; font-size: 9px; font-weight: bold; width: 100%; cursor: pointer;">
              📡 PRZEKAŻ DOWODZENIE SEKTOROWE / WYŚLIJ DRONY
            </button>`;
        } else if (isZRM) {
          actionButtons = `
            <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'STANDBY')" style="background: #be123c; color: white; border: none; padding: 5px; border-radius: 3px; font-size: 9px; font-weight: bold; width: 100%; cursor: pointer;">
              🚑 ROZWIŃ PUNKT MEDYCZNY (TRIAGE)
            </button>`;
        } else if (isDrabina) {
          actionButtons = `
            <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'EVACUATION')" style="background: #0284c7; color: white; border: none; padding: 5px; border-radius: 3px; font-size: 9px; font-weight: bold; width: 100%; cursor: pointer;">
              🪜 ROZSTAW DRABINĘ / EWAKUACJA Z WYSOKOŚCI
            </button>`;
        } else {
          actionButtons = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 4px;">
              <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'FIRE_FIGHTING')" style="background: #991b1b; color: white; border: none; padding: 5px; border-radius: 3px; font-size: 9px; font-weight: bold; cursor: pointer;">🔥 NATARCIE</button>
              <button onclick="window.tarczaExecuteUnitCommand('${m.id}', 'EVACUATION')" style="background: #0284c7; color: white; border: none; padding: 5px; border-radius: 3px; font-size: 9px; font-weight: bold; cursor: pointer;">🏃 EWAKUACJA</button>
            </div>`;
        }

        const popupContent = `
          <div style="min-width: 240px; font-family: inherit;">
            <div style="font-size: 10px; font-weight: bold; color: ${color}; margin-bottom: 4px;">${m.sector} · ${isKDR ? 'DOWÓDCA SEKTORA' : 'JEDNOSTKA WSPARCIA'}</div>
            <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 3px;">${m.label}</div>
            <div style="color: #a1a1aa; font-size: 10px; margin-bottom: 6px;">${m.details}</div>
            ${!isKDR && !isZRM ? `<div style="margin-bottom: 6px; font-size: 10px;">Zapas wody: <b>${water}%</b></div>` : ''}
            <div style="background: #18181b; padding: 6px; border-radius: 4px; margin-bottom: 8px; font-size: 9px; color: #10b981;">Status: ${m.reportStatus || m.status}</div>
            ${actionButtons}
          </div>
        `;

        // Aktualizacja lub tworzenie markera (ZAPOBIEGA MRUGANIU)
        if (friendlyMarkersMap.current[m.id]) {
          const existingMarker = friendlyMarkersMap.current[m.id];
          existingMarker.setLatLng(m.coords);
          existingMarker.setIcon(icon);
          if (existingMarker.getPopup() && existingMarker.isPopupOpen()) {
            existingMarker.getPopup()?.setContent(popupContent);
          } else {
            existingMarker.bindPopup(popupContent);
          }
        } else {
          const newMarker = L.marker(m.coords, { icon });
          newMarker.bindPopup(popupContent);
          newMarker.on('click', () => onSelectMarker?.(m));
          newMarker.addTo(layer);
          friendlyMarkersMap.current[m.id] = newMarker;
        }
      });

    // Usuwanie nieaktywnych
    Object.keys(friendlyMarkersMap.current).forEach((id) => {
      if (!currentIds.has(id)) {
        layer.removeLayer(friendlyMarkersMap.current[id]);
        delete friendlyMarkersMap.current[id];
      }
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

  // Render Drones
  useEffect(() => {
    if (!dronesLayerRef.current) return;
    const layer = dronesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.drones) return;

    drones.forEach((drone) => {
      const isSelected = drone.id === selectedDroneId;
      const isLowBattery = drone.battery < 25;
      const isExternal = drone.isExternalSupport === true;

      const color = isLowBattery
        ? '#ef4444'
        : isExternal
        ? '#818cf8'
        : isSelected
        ? '#10b981'
        : '#38bdf8';

      const iconHtml = `
        <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
          ${isLowBattery ? `<div style="position: absolute; width: 36px; height: 36px; border-radius: 50%; background: rgba(239, 68, 68, 0.4); animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
          <div style="width: 28px; height: 28px; border-radius: 50%; background: #09090b; border: 2px solid ${color}; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color};">
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
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: #18181b; padding: 6px; border-radius: 4px; font-size: 10px; font-family: monospace;">
            <div>Bateria: <b style="color: ${color};">${Math.round(drone.battery)}%</b></div>
            <div>Pułap: <b>${drone.altitude || 45} m AGL</b></div>
            <div>Prędkość: <b>${drone.speed} km/h</b></div>
            <div>Kurs: <b>${drone.headingDeg || 0}°</b></div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => onSelectDrone?.(drone));
      marker.addTo(layer);
    });
  }, [drones, activeLayers.drones, selectedDroneId, onSelectDrone]);

  // Render Hose Lines (Algorytm Węża max 150m)
  useEffect(() => {
    if (!hosesLayerRef.current) return;
    const layer = hosesLayerRef.current;
    layer.clearLayers();

    markers
      .filter((m) => m.type === 'FRIENDLY_UNIT' && m.currentTask === 'FIRE_FIGHTING')
      .forEach((unit) => {
        const fireTarget = markers.find((m) => m.type === 'FIRE_ZONE') || { coords: [unit.coords[0] + 0.0006, unit.coords[1] + 0.0006] as [number, number] };
        const dist = Math.round(
          unit.hoseLineDistanceMeters ||
          (Math.hypot(unit.coords[0] - fireTarget.coords[0], unit.coords[1] - fireTarget.coords[1]) * 111000)
        );

        const isExceeded = dist > MAX_HOSE_LENGTH_METERS;
        const hoseColor = isExceeded ? '#ef4444' : '#06b6d4';

        const points: [number, number][] = unit.hoseRoute || [
          unit.coords,
          [(unit.coords[0] + fireTarget.coords[0]) / 2 + 0.0001, (unit.coords[1] + fireTarget.coords[1]) / 2],
          fireTarget.coords,
        ];

        const polyline = L.polyline(points, {
          color: hoseColor,
          weight: isExceeded ? 3 : 3.5,
          dashArray: isExceeded ? '6, 6' : '3, 4',
          opacity: 0.9,
        });

        polyline.bindTooltip(
          isExceeded
            ? `⚠️ PRZEKROCZONY ZASIĘG WĘŻA (${dist}m > ${MAX_HOSE_LENGTH_METERS}m)!`
            : `💧 Linia gaśnicza W-52: ${dist}m / ${MAX_HOSE_LENGTH_METERS}m`,
          {
            permanent: false,
            className: isExceeded
              ? 'bg-rose-950 text-rose-200 font-mono text-[9px] px-1.5 py-0.5 rounded border border-rose-500'
              : 'bg-cyan-950 text-cyan-200 font-mono text-[9px] px-1.5 py-0.5 rounded border border-cyan-500',
          }
        );

        polyline.addTo(layer);
      });
  }, [markers]);

  // Render Auxiliary Tactical Markers: HYDRANT, CLUE, STRUCTURAL_DAMAGE
  useEffect(() => {
    if (!auxTacticalLayerRef.current) return;
    const layer = auxTacticalLayerRef.current;
    layer.clearLayers();

    markers.forEach((m) => {
      // Usunięcie uratowanych ofiar na zewnątrz
      if (m.type === 'VICTIM_OUTSIDE') {
        if (
          m.status === 'EWAKUOWANY' ||
          m.status === 'URATOWANY' ||
          m.status === 'URATOWANI' ||
          m.status === 'RESCUED'
        ) {
          return;
        }

        const color = '#f97316';
        const iconHtml = `
          <div style="width: 26px; height: 26px; border-radius: 50%; background: #09090b; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color};">
            <span style="font-size: 12px;">🏃</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'tactical-div-icon', html: iconHtml, iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker(m.coords, { icon });
        marker.bindPopup(`<b>${m.label}</b><p>${m.details}</p>`);
        marker.addTo(layer);
      }

      if (m.type === 'HYDRANT') {
        const iconHtml = `
          <div style="width: 24px; height: 24px; border-radius: 4px; background: #09090b; border: 2px solid #0284c7; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px #0284c7;">
            <span style="font-size: 11px;">🚰</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'tactical-div-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
        const marker = L.marker(m.coords, { icon });
        marker.bindTooltip(m.label, { permanent: false, className: 'font-mono text-[9px]' });
        marker.addTo(layer);
      }

      if (m.type === 'CLUE') {
        const iconHtml = `
          <div style="width: 24px; height: 24px; border-radius: 50%; background: #09090b; border: 2px dashed #f59e0b; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 11px;">🔎</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'tactical-div-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
        const marker = L.marker(m.coords, { icon });
        marker.bindPopup(`<b>${m.label}</b><p>${m.details}</p>`);
        marker.addTo(layer);
      }

      if (m.type === 'STRUCTURAL_DAMAGE') {
        const iconHtml = `
          <div style="width: 26px; height: 26px; border-radius: 4px; background: #7f1d1d; border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 12px;">🧱</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'tactical-div-icon', html: iconHtml, iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker(m.coords, { icon });
        marker.bindPopup(`<b>${m.label}</b><p>${m.details}</p>`);
        marker.addTo(layer);
      }
    });
  }, [markers]);

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-zinc-950 select-none overflow-hidden">
      {/* Top Banner Toolbar */}
      <div className="absolute top-2 left-2 right-2 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto bg-zinc-950/90 backdrop-blur-md p-1.5 rounded-md border border-zinc-800 text-xs shadow-lg">
          <button
            type="button"
            onClick={() => {
              if (isDrawingPolygon) {
                handleCancelDrawing();
              } else {
                setIsDrawingPolygon(true);
                setActivePolygonPoints([]);
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono font-medium text-[11px] transition-colors cursor-pointer ${
              isDrawingPolygon
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-emerald-400'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{isDrawingPolygon ? 'Anuluj rysowanie' : '+ Rysuj Strefę (Poligon)'}</span>
          </button>

          {isDrawingPolygon && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono pl-2 border-l border-zinc-800">
              <select
                value={newZoneType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setNewZoneType(val);
                  if (val === 'DANGER_ZONE') {
                    setNewZoneColor('#ef4444');
                    setNewZoneName('Strefa Pożaru B-4');
                  } else if (val === 'NO_FLY') {
                    setNewZoneColor('#f59e0b');
                    setNewZoneName('Strefa No-Fly / BLEVE');
                  } else if (val === 'WATER_CURTAIN') {
                    setNewZoneColor('#06b6d4');
                    setNewZoneName('Strefa Kurtyn Wodnych');
                  } else {
                    setNewZoneColor('#38bdf8');
                    setNewZoneName('Sektor Poszukiwań');
                  }
                }}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200 cursor-pointer"
              >
                <option value="DANGER_ZONE">🔥 Pożar / Zagrożenie</option>
                <option value="NO_FLY">🚫 Zakaz Lotów (No-Fly)</option>
                <option value="WATER_CURTAIN">💧 Kurtyna Wodna</option>
                <option value="SEARCH_AREA">🔍 Sektor Poszukiwań</option>
              </select>

              <button
                type="button"
                onClick={handleUndoPoint}
                disabled={activePolygonPoints.length === 0}
                className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Cofnij punkt"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleFinishPolygon}
                disabled={activePolygonPoints.length < 3}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer"
                title="Zatwierdź i zamknij poligon"
              >
                <Check className="w-3 h-3" />
                <span>Zamknij poligon ({activePolygonPoints.length} pkt.)</span>
              </button>
            </div>
          )}
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

      {/* Floating Drawing Banners */}
      {isDrawingHotSwap && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-amber-950/95 border border-amber-500 rounded-md shadow-2xl flex items-center gap-3 text-amber-200 text-xs backdrop-blur-md animate-pulse">
          <BatteryCharging className="w-4 h-4 text-amber-400 shrink-0" />
          <span><b>TRYB EDYCJI:</b> Kliknij dowolne miejsce na mapie, aby utworzyć strefę Hot-Swap (35m).</span>
          <button
            onClick={onCancelDrawingHotSwap}
            className="p-1 hover:bg-amber-900 text-amber-300 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isDrawingPolygon && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-rose-950/95 border border-rose-500 rounded-md shadow-2xl flex items-center gap-3 text-rose-200 text-xs backdrop-blur-md">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
          <span>
            <b>RYSUJ STREFĘ:</b> Klikaj wierzchołki na mapie ({activePolygonPoints.length} pkt.). Min. 3 punkty, by zamknąć poligon.
          </span>
          <button
            onClick={handleCancelDrawing}
            className="p-1 hover:bg-rose-900 text-rose-300 rounded cursor-pointer"
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
        {incidentZones.length > 0 && (
          <>
            <span className="text-zinc-600">|</span>
            <span className="text-rose-400 font-bold">STREFY KDR: {incidentZones.length}</span>
          </>
        )}
      </div>

      {/* Leaflet DOM container */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />
    </div>
  );
}
