'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TacticalZone } from '@/types/tarcza';
import { GEOPORTAL_LAYERS, GeoportalLayerConfig } from '@/lib/geoportal/config';
import { OFFLINE_FACILITY_BUILDINGS } from '@/lib/offline-maps-data';
import L from 'leaflet';
import { Layers, ShieldAlert, Crosshair, Plus, Trash2, MapPin } from 'lucide-react';

interface CreationMapProps {
  centerCoords: [number, number];
  onCenterChange: (coords: [number, number]) => void;
  zones: TacticalZone[];
  onAddZone: (zone: TacticalZone) => void;
  onRemoveZone: (zoneId: string) => void;
}

export default function CreationMap({
  centerCoords,
  onCenterChange,
  zones,
  onAddZone,
  onRemoveZone,
}: CreationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | L.TileLayer.WMS | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const centerMarkerRef = useRef<L.Marker | null>(null);

  const [isDrawingZone, setIsDrawingZone] = useState<boolean>(false);
  const [zoneFirstCorner, setZoneFirstCorner] = useState<[number, number] | null>(null);
  const [newZoneName, setNewZoneName] = useState<string>('Strefa Gorąca (Bezpośrednie Zagrożenie)');
  const [newZoneType, setNewZoneType] = useState<'DANGER_ZONE' | 'NO_FLY' | 'SEARCH_AREA'>('DANGER_ZONE');
  const [newZoneColor, setNewZoneColor] = useState<string>('#ef4444');

  const onCenterChangeRef = useRef(onCenterChange);
  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  const initialCenterRef = useRef(centerCoords);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = initialCenterRef.current;
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

    // Zones layer group
    const zGroup = L.layerGroup().addTo(map);
    zonesLayerRef.current = zGroup;

    // Center Pin icon
    const centerIcon = L.divIcon({
      className: 'tactical-div-icon',
      html: `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: rgba(16, 185, 129, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 22px; height: 22px; border-radius: 50%; background: #09090b; border: 2px solid #10b981; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px #10b981;">
            <span style="font-size: 10px; color: #10b981; font-weight: bold;">★</span>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker(initialCenter, { icon: centerIcon, draggable: true }).addTo(map);
    centerMarkerRef.current = marker;

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onCenterChangeRef.current([pos.lat, pos.lng]);
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
        className: 'bg-zinc-900 text-zinc-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-zinc-700',
      });
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update center marker when centerCoords change
  useEffect(() => {
    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLatLng(centerCoords);
    }
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo(centerCoords);
    }
  }, [centerCoords]);

  // Click handler on map: either set center or draw zone rectangle
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const clickCoords: [number, number] = [e.latlng.lat, e.latlng.lng];

      if (!isDrawingZone) {
        // Kliknięcie w trybie standardowym przesuwa środek incydentu
        onCenterChange(clickCoords);
        return;
      }

      // Tryb rysowania strefy (2 kliknięcia)
      if (!zoneFirstCorner) {
        setZoneFirstCorner(clickCoords);
      } else {
        const corner1 = zoneFirstCorner;
        const corner2 = clickCoords;

        const north = Math.max(corner1[0], corner2[0]);
        const south = Math.min(corner1[0], corner2[0]);
        const east = Math.max(corner1[1], corner2[1]);
        const west = Math.min(corner1[1], corner2[1]);

        const newZone: TacticalZone = {
          id: `ZONE-${Date.now()}`,
          name: newZoneName,
          type: newZoneType,
          bounds: [[south, west], [north, east]],
          color: newZoneColor,
          createdAt: new Date().toLocaleTimeString().slice(0, 5),
        };

        onAddZone(newZone);
        setIsDrawingZone(false);
        setZoneFirstCorner(null);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isDrawingZone, zoneFirstCorner, newZoneName, newZoneType, newZoneColor, onAddZone, onCenterChange]);

  // Render Tactical Zones
  useEffect(() => {
    if (!zonesLayerRef.current) return;
    const layer = zonesLayerRef.current;
    layer.clearLayers();

    zones.forEach((z) => {
      const rect = L.rectangle(z.bounds, {
        color: z.color,
        weight: 2,
        fillColor: z.color,
        fillOpacity: 0.22,
        dashArray: z.type === 'NO_FLY' ? '6, 6' : undefined,
      });

      rect.bindTooltip(z.name, {
        permanent: true,
        direction: 'center',
        className: 'bg-zinc-950 text-zinc-100 font-mono text-[10px] px-2 py-0.5 rounded border border-zinc-700 shadow-md',
      });

      rect.addTo(layer);
    });
  }, [zones]);

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800">
      {/* Top Banner Toolbar */}
      <div className="absolute top-2 left-2 right-2 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-zinc-950/90 backdrop-blur-md p-1.5 rounded-md border border-zinc-800 text-xs shadow-lg">
          <button
            type="button"
            onClick={() => {
              setIsDrawingZone(!isDrawingZone);
              setZoneFirstCorner(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono font-medium transition-colors cursor-pointer ${
              isDrawingZone
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-emerald-400'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{isDrawingZone ? 'Anuluj rysowanie' : '+ Utwórz Strefę Taktyczną'}</span>
          </button>

          {isDrawingZone && (
            <div className="flex items-center gap-2 text-[11px] font-mono pl-2 border-l border-zinc-800">
              <select
                value={newZoneType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setNewZoneType(val);
                  if (val === 'DANGER_ZONE') {
                    setNewZoneColor('#ef4444');
                    setNewZoneName('Strefa Gorąca');
                  } else if (val === 'NO_FLY') {
                    setNewZoneColor('#f59e0b');
                    setNewZoneName('Strefa Zakazu Lotów (No-Fly)');
                  } else {
                    setNewZoneColor('#06b6d4');
                    setNewZoneName('Sektor Przeszukania');
                  }
                }}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200"
              >
                <option value="DANGER_ZONE">Strefa Gorąca (Pożar/Skażenie)</option>
                <option value="NO_FLY">Strefa Zakazu Lotów / BLEVE</option>
                <option value="SEARCH_AREA">Sektor Poszukiwań (Search Area)</option>
              </select>
            </div>
          )}
        </div>

        <div className="pointer-events-auto bg-zinc-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-zinc-800 text-[10px] font-mono text-zinc-400 shadow-md">
          {isDrawingZone ? (
            <span className="text-amber-400">
              {zoneFirstCorner ? 'Kliknij przeciwległy narożnik' : 'Kliknij 1. narożnik strefy'}
            </span>
          ) : (
            <span>Kliknij mapę, aby zmienić środek akcji</span>
          )}
        </div>
      </div>

      {/* Map DOM */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />

      {/* Bottom list of created zones badge */}
      {zones.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 z-[1000] flex items-center gap-2 overflow-x-auto p-1.5 bg-zinc-950/90 backdrop-blur-md rounded border border-zinc-800 text-[11px] font-mono text-zinc-300">
          <span className="text-zinc-500 font-bold shrink-0">STREFY ({zones.length}):</span>
          {zones.map((z) => (
            <div
              key={z.id}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 shrink-0"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: z.color }} />
              <span className="truncate max-w-[120px]">{z.name}</span>
              <button
                type="button"
                onClick={() => onRemoveZone(z.id)}
                className="text-zinc-500 hover:text-rose-400 p-0.5 cursor-pointer"
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
