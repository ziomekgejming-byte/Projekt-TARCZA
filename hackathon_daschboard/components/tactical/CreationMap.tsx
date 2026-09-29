'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TacticalZone } from '@/types/tarcza';
import {
  OFFLINE_FACILITY_BUILDINGS,
  OFFLINE_WATER_BODIES,
  computePolygonBounds,
  computePolygonAreaM2,
} from '@/lib/offline-maps-data';
import L from 'leaflet';
import { ShieldAlert, Trash2, MapPin, Shield, Undo2, Check, Waves } from 'lucide-react';

interface CreationMapProps {
  centerCoords: [number, number];
  onCenterChange: (coords: [number, number]) => void;
  kdrCoords?: [number, number];
  onKdrChange?: (coords: [number, number]) => void;
  zones: TacticalZone[];
  onAddZone: (zone: TacticalZone) => void;
  onRemoveZone: (zoneId: string) => void;
}

export default function CreationMap({
  centerCoords,
  onCenterChange,
  kdrCoords = [centerCoords[0] - 0.0008, centerCoords[1] - 0.0010],
  onKdrChange,
  zones,
  onAddZone,
  onRemoveZone,
}: CreationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const waterLayerRef = useRef<L.LayerGroup | null>(null);
  const activeDrawLayerRef = useRef<L.LayerGroup | null>(null);
  const centerMarkerRef = useRef<L.Marker | null>(null);
  const kdrMarkerRef = useRef<L.Marker | null>(null);

  const [activeClickTarget, setActiveClickTarget] = useState<'CENTER' | 'KDR'>('CENTER');
  const [isDrawingPolygon, setIsDrawingPolygon] = useState<boolean>(false);
  const [activePolygonPoints, setActivePolygonPoints] = useState<[number, number][]>([]);
  const [newZoneName, setNewZoneName] = useState<string>('Strefa Pożaru B-4');
  const [newZoneType, setNewZoneType] = useState<'DANGER_ZONE' | 'NO_FLY' | 'SEARCH_AREA' | 'WATER_CURTAIN'>('DANGER_ZONE');
  const [newZoneColor, setNewZoneColor] = useState<string>('#ef4444');

  const onCenterChangeRef = useRef(onCenterChange);
  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  const onKdrChangeRef = useRef(onKdrChange);
  useEffect(() => {
    onKdrChangeRef.current = onKdrChange;
  }, [onKdrChange]);

  const initialCenterRef = useRef(centerCoords);
  const initialKdrRef = useRef(kdrCoords);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = initialCenterRef.current;
    const initialKdr = initialKdrRef.current;
    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    mapInstanceRef.current = map;

    // Base OSM Layer
    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
    });
    osmLayer.addTo(map);
    currentTileLayerRef.current = osmLayer;

    // Layer groups
    waterLayerRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    activeDrawLayerRef.current = L.layerGroup().addTo(map);

    // Center Epicenter Pin icon
    const centerIcon = L.divIcon({
      className: 'tactical-div-icon',
      html: `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: rgba(239, 68, 68, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 24px; height: 24px; border-radius: 50%; background: #09090b; border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px #ef4444;">
            <span style="font-size: 11px; color: #ef4444; font-weight: bold;">🔥</span>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const cMarker = L.marker(initialCenter, { icon: centerIcon, draggable: true }).addTo(map);
    cMarker.bindTooltip('Centrum Incydentu (Ognisko)', { permanent: false, className: 'font-mono text-[10px]' });
    centerMarkerRef.current = cMarker;

    cMarker.on('dragend', () => {
      const pos = cMarker.getLatLng();
      onCenterChangeRef.current([pos.lat, pos.lng]);
    });

    // KDR Command Post icon
    const kdrIcon = L.divIcon({
      className: 'tactical-div-icon',
      html: `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <div style="width: 26px; height: 26px; border-radius: 6px; background: #09090b; border: 2px solid #eab308; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px #eab308;">
            <span style="font-size: 13px;">🛡️</span>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const kdrMarker = L.marker(initialKdr, { icon: kdrIcon, draggable: true }).addTo(map);
    kdrMarker.bindTooltip('Stanowisko Dowodzenia KDR', { permanent: false, className: 'font-mono text-[10px]' });
    kdrMarkerRef.current = kdrMarker;

    kdrMarker.on('dragend', () => {
      const pos = kdrMarker.getLatLng();
      onKdrChangeRef.current?.([pos.lat, pos.lng]);
    });

    // Draw reference facility polygons
    OFFLINE_FACILITY_BUILDINGS.forEach((bld) => {
      const bldPoly = L.polygon(bld.polygon, {
        color: '#64748b',
        weight: 1.5,
        fillColor: '#334155',
        fillOpacity: 0.25,
        dashArray: '4, 4',
      }).addTo(map);

      bldPoly.bindTooltip(bld.name, {
        permanent: false,
        className: 'bg-zinc-950 text-zinc-300 font-mono text-[9px] px-1 py-0.5 rounded border border-zinc-800 shadow',
      });
    });

    // Draw reference water bodies (otwarte zbiorniki i cieki)
    if (waterLayerRef.current) {
      OFFLINE_WATER_BODIES.forEach((wb) => {
        const waterPoly = L.polygon(wb.polygon, {
          color: '#0284c7',
          weight: 2,
          fillColor: '#0369a1',
          fillOpacity: 0.45,
          dashArray: '3, 3',
        }).addTo(waterLayerRef.current!);

        waterPoly.bindTooltip(`💧 ${wb.name} (${wb.capacityLiters.toLocaleString()} l)`, {
          permanent: false,
          className: 'bg-cyan-950 text-cyan-200 font-mono text-[9px] px-1.5 py-0.5 rounded border border-cyan-700 shadow',
        });
      });
    }

    // Size fix
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    const t3 = setTimeout(() => map.invalidateSize(), 700);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update center marker when centerCoords change
  useEffect(() => {
    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLatLng(centerCoords);
    }
  }, [centerCoords]);

  // Update KDR marker when kdrCoords change
  useEffect(() => {
    if (kdrMarkerRef.current && kdrCoords) {
      kdrMarkerRef.current.setLatLng(kdrCoords);
    }
  }, [kdrCoords]);

  // Active Drawing Layer preview (Points and Polyline)
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

    // Draw connecting polyline / polygon preview
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
        fillOpacity: 0.15,
      }).addTo(layer);
    }
  }, [activePolygonPoints, isDrawingPolygon, newZoneColor]);

  // Click handler on map
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const clickCoords: [number, number] = [e.latlng.lat, e.latlng.lng];

      if (!isDrawingPolygon) {
        if (activeClickTarget === 'CENTER') {
          onCenterChange(clickCoords);
        } else if (activeClickTarget === 'KDR' && onKdrChange) {
          onKdrChange(clickCoords);
        }
        return;
      }

      // Tryb rysowania wielokąta: dodaj wierzchołek
      setActivePolygonPoints((prev) => [...prev, clickCoords]);
    };

    if (isDrawingPolygon) {
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
    }

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isDrawingPolygon, activeClickTarget, onCenterChange, onKdrChange]);

  // Finalize drawn polygon
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

    onAddZone(newZone);
    setIsDrawingPolygon(false);
    setActivePolygonPoints([]);
  };

  const handleCancelDrawing = () => {
    setIsDrawingPolygon(false);
    setActivePolygonPoints([]);
  };

  const handleUndoPoint = () => {
    setActivePolygonPoints((prev) => prev.slice(0, -1));
  };

  // Render Saved Tactical Zones as Polygons
  useEffect(() => {
    if (!zonesLayerRef.current) return;
    const layer = zonesLayerRef.current;
    layer.clearLayers();

    zones.forEach((z) => {
      const coords = z.polygon && z.polygon.length >= 3
        ? z.polygon
        : [
            [z.bounds![0][0], z.bounds![0][1]],
            [z.bounds![1][0], z.bounds![0][1]],
            [z.bounds![1][0], z.bounds![1][1]],
            [z.bounds![0][0], z.bounds![1][1]],
          ] as [number, number][];

      const poly = L.polygon(coords, {
        color: z.color || '#ef4444',
        weight: 2,
        fillColor: z.color || '#ef4444',
        fillOpacity: 0.24,
        dashArray: z.type === 'NO_FLY' ? '6, 6' : undefined,
      });

      poly.bindTooltip(`⚠️ ${z.name}${z.areaM2 ? ` (${z.areaM2.toLocaleString()} m²)` : ''}`, {
        permanent: true,
        direction: 'center',
        className: 'bg-zinc-950 text-zinc-100 font-mono text-[10px] px-2 py-0.5 rounded border border-zinc-700 shadow-md',
      });

      poly.bindPopup(`
        <div style="min-width: 190px; font-family: inherit;">
          <div style="font-size: 10px; font-family: monospace; font-weight: bold; color: ${z.color};">
            ${z.type}
          </div>
          <div style="font-weight: 600; font-size: 12px; color: #f4f4f5; margin-top: 2px;">
            ${z.name}
          </div>
          ${z.areaM2 ? `<div style="font-size: 10px; font-family: monospace; color: #a1a1aa; margin-top: 3px;">Powierzchnia: <b>${z.areaM2.toLocaleString()} m²</b></div>` : ''}
          <div style="font-size: 10px; font-family: monospace; color: #71717a; margin-top: 2px;">Wierzchołki: ${coords.length} pkt.</div>
        </div>
      `);

      poly.addTo(layer);
    });
  }, [zones]);

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800">
      {/* Top Banner Toolbar */}
      <div className="absolute top-2 left-2 right-2 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto bg-zinc-950/90 backdrop-blur-md p-1.5 rounded-md border border-zinc-800 text-xs shadow-lg">
          <button
            type="button"
            onClick={() => {
              setIsDrawingPolygon(false);
              setActivePolygonPoints([]);
              setActiveClickTarget('CENTER');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-mono text-[11px] transition-colors cursor-pointer ${
              !isDrawingPolygon && activeClickTarget === 'CENTER'
                ? 'bg-rose-950 border border-rose-600 text-rose-300 font-bold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-rose-400" />
            <span>Centrum akcji</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsDrawingPolygon(false);
              setActivePolygonPoints([]);
              setActiveClickTarget('KDR');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-mono text-[11px] transition-colors cursor-pointer ${
              !isDrawingPolygon && activeClickTarget === 'KDR'
                ? 'bg-amber-950 border border-amber-600 text-amber-300 font-bold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-amber-400" />
            <span>Sztab KDR</span>
          </button>

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
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono font-medium text-[11px] transition-colors cursor-pointer ${
              isDrawingPolygon
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-emerald-400'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{isDrawingPolygon ? 'Anuluj rysowanie' : '+ Rysuj Poligon Strefy'}</span>
          </button>

          {isDrawingPolygon && (
            <div className="flex items-center gap-1 text-[11px] font-mono pl-2 border-l border-zinc-800">
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
                title="Cofnij ostatni punkt"
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

        <div className="pointer-events-auto bg-zinc-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-zinc-800 text-[10px] font-mono text-zinc-400 shadow-md flex items-center gap-2">
          {isDrawingPolygon ? (
            <span className="text-amber-400 font-bold">
              Klikaj punkty na mapie (Punkty: {activePolygonPoints.length}/3 min.)
            </span>
          ) : activeClickTarget === 'CENTER' ? (
            <span className="text-rose-400">Kliknij mapę, aby zmienić ognisko/centrum</span>
          ) : (
            <span className="text-amber-400">Kliknij mapę, aby postawić sztab KDR</span>
          )}
        </div>
      </div>

      {/* Map DOM */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />

      {/* Bottom list of created zones badge */}
      {zones.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 z-[1000] flex items-center gap-2 overflow-x-auto p-1.5 bg-zinc-950/90 backdrop-blur-md rounded border border-zinc-800 text-[11px] font-mono text-zinc-300">
          <span className="text-zinc-500 font-bold shrink-0">STREFY KDR ({zones.length}):</span>
          {zones.map((z) => (
            <div
              key={z.id}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 shrink-0"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: z.color }} />
              <span className="truncate max-w-[140px] font-medium">{z.name}</span>
              {z.areaM2 && (
                <span className="text-[9px] text-zinc-500">{z.areaM2.toLocaleString()} m²</span>
              )}
              <button
                type="button"
                onClick={() => onRemoveZone(z.id)}
                className="text-zinc-500 hover:text-rose-400 p-0.5 cursor-pointer ml-1"
                title="Usuń strefę"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
