'use client';


import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Check, Crosshair, Layers, Search, Undo2, X } from 'lucide-react';
import { GEOPORTAL_LAYERS } from '@/lib/geoportal/config';
import { computePolygonAreaM2 } from '@/lib/offline-maps-data';

export type PointKind = 'KDR' | 'HYDRANT' | 'WATER' | 'HOTSWAP' | 'UNIT' | 'ME' | 'FIRE_START';
export type PolygonKind = 'OPERATIONAL_AREA' | 'FIRE' | 'NO_FLY' | 'WATER_CURTAIN' | 'SEARCH_AREA';

export interface PlanningPoint {
  id: string;
  kind: PointKind;
  coords: [number, number];
  label: string;
  draggable?: boolean;
}

export interface PlanningPolygon {
  id: string;
  kind: PolygonKind;
  polygon: [number, number][];
  label: string;
  dashed?: boolean;
}

export interface PlanningTool {
  id: string;
  label: string;
  hint: string;
  mode: 'point' | 'polygon';
  kind: PointKind | PolygonKind;
}

export const POINT_STYLE: Record<PointKind, { emoji: string; color: string }> = {
  KDR: { emoji: '🛡️', color: '#eab308' },
  HYDRANT: { emoji: '🚰', color: '#38bdf8' },
  WATER: { emoji: '💧', color: '#06b6d4' },
  HOTSWAP: { emoji: '🔋', color: '#22c55e' },
  UNIT: { emoji: '🚒', color: '#f97316' },
  ME: { emoji: '📍', color: '#34d399' },
  FIRE_START: { emoji: '🔥', color: '#ef4444' },
};

export const POLYGON_STYLE: Record<PolygonKind, { color: string; fill: number }> = {
  OPERATIONAL_AREA: { color: '#22d3ee', fill: 0.06 },
  FIRE: { color: '#ef4444', fill: 0.28 },
  NO_FLY: { color: '#f59e0b', fill: 0.18 },
  WATER_CURTAIN: { color: '#06b6d4', fill: 0.2 },
  SEARCH_AREA: { color: '#a78bfa', fill: 0.15 },
};

interface PlanningMapProps {
  center: [number, number];
  points: PlanningPoint[];
  polygons: PlanningPolygon[];
  tools: PlanningTool[];
  activeToolId: string | null;
  onActiveToolChange: (toolId: string | null) => void;
  onPlacePoint: (tool: PlanningTool, coords: [number, number]) => void;
  onFinishPolygon: (tool: PlanningTool, polygon: [number, number][]) => void;
  onMovePoint?: (id: string, coords: [number, number]) => void;
  onMapMove?: (center: [number, number]) => void;
  fitPolygon?: [number, number][] | null;
  initialZoom?: number;
}

const BASE_LAYERS = GEOPORTAL_LAYERS.filter((l) => l.id === 'osm' || l.id === 'geoportal-orto');

export default function PlanningMap({
  center,
  points,
  polygons,
  tools,
  activeToolId,
  onActiveToolChange,
  onPlacePoint,
  onFinishPolygon,
  onMovePoint,
  onMapMove,
  fitPolygon,
  initialZoom = 16,
}: PlanningMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const pointsLayerRef = useRef<L.LayerGroup | null>(null);
  const polygonsLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);

  const [baseId, setBaseId] = useState<string>('osm');
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const activeTool = tools.find((t) => t.id === activeToolId) || null;

  // Bezpieczne przekazanie najnowszych propsów do eventów Leafleta
  const activeToolRef = useRef(activeTool);
  const onPlacePointRef = useRef(onPlacePoint);
  const onMovePointRef = useRef(onMovePoint);
  const onMapMoveRef = useRef(onMapMove);

  useEffect(() => {
    activeToolRef.current = activeTool;
    onPlacePointRef.current = onPlacePoint;
    onMovePointRef.current = onMovePoint;
    onMapMoveRef.current = onMapMove;
  }, [activeTool, onPlacePoint, onMovePoint, onMapMove]);

  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(initialZoom);

  // Inicjalizacja mapy
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    pointsLayerRef.current = L.layerGroup().addTo(map);
    polygonsLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const tool = activeToolRef.current;
      if (!tool) return;
      const coords: [number, number] = [e.latlng.lat, e.latlng.lng];
      if (tool.mode === 'polygon') {
        setDraftPoints((prev) => [...prev, coords]);
      } else {
        onPlacePointRef.current(tool, coords);
      }
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      onMapMoveRef.current?.([c.lat, c.lng]);
    });

    const timers = [100, 300, 800].map((ms) => setTimeout(() => map.invalidateSize(), ms));
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      timers.forEach(clearTimeout);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Obsługa warstw bazowych
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = BASE_LAYERS.find((l) => l.id === baseId) || BASE_LAYERS[0];

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    let layer: L.TileLayer;
    if (cfg.tileUrl) {
      layer = L.tileLayer(cfg.tileUrl, {
        attribution: cfg.attribution,
        maxZoom: 20,
        maxNativeZoom: 19,
        referrerPolicy: 'origin',
      });
    } else {
      layer = L.tileLayer.wms(cfg.wmsUrl!, {
        layers: cfg.wmtsLayerName || 'Raster',
        format: cfg.format || 'image/jpeg',
        transparent: !!cfg.transparent,
        version: '1.3.0',
        attribution: cfg.attribution,
        maxZoom: 20,
      });
    }

    let errors = 0;
    layer.on('tileerror', () => {
      errors += 1;
      if (errors === 6) {
        setMapNotice(
          baseId === 'osm'
            ? 'Nie udało się pobrać kafelków mapy. Sprawdź połączenie z internetem.'
            : 'Ortofotomapa Geoportalu jest teraz niedostępna. Przełącz na mapę standardową.'
        );
      }
    });
    layer.on('load', () => {
      if (errors < 6) setMapNotice(null);
    });

    layer.addTo(map);
    layer.bringToBack();
    baseLayerRef.current = layer;
  }, [baseId]);

  // Rysowanie punktów
  useEffect(() => {
    const layer = pointsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    points.forEach((p) => {
      const st = POINT_STYLE[p.kind];
      const icon = L.divIcon({
        className: 'tactical-div-icon',
        html: `<div style="width:28px;height:28px;border-radius:${p.kind === 'KDR' ? '6px' : '50%'};background:#09090b;border:2px solid ${st.color};display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 10px ${st.color}88">${st.emoji}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker(p.coords, { icon, draggable: !!p.draggable });
      marker.bindTooltip(p.label, { direction: 'top', offset: [0, -14], className: 'font-mono text-[10px]' });
      
      if (p.draggable) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onMovePointRef.current?.(p.id, [pos.lat, pos.lng]);
        });
      }
      marker.addTo(layer);
    });
  }, [points]);

  // Rysowanie wielokątów
  useEffect(() => {
    const layer = polygonsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    polygons.forEach((pg) => {
      if (pg.polygon.length < 3) return;
      const st = POLYGON_STYLE[pg.kind];
      const poly = L.polygon(pg.polygon, {
        color: st.color,
        weight: pg.kind === 'OPERATIONAL_AREA' ? 3 : 2,
        dashArray: pg.dashed || pg.kind === 'OPERATIONAL_AREA' ? '10, 6' : undefined,
        fillColor: st.color,
        fillOpacity: st.fill,
        interactive: false,
      });
      poly.addTo(layer);

      const area = computePolygonAreaM2(pg.polygon);
      const areaLabel = area >= 10000 ? `${(area / 10000).toFixed(2)} ha` : `${area.toLocaleString('pl-PL')} m²`;
      L.marker(poly.getBounds().getCenter(), {
        interactive: false,
        icon: L.divIcon({
          className: 'tactical-div-icon',
          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:#09090bcc;color:#f4f4f5;border:1px solid ${st.color};border-radius:4px;padding:1px 6px;font:600 10px ui-monospace,monospace">${pg.label} · ${areaLabel}</div>`,
          iconSize: [0, 0],
        }),
      }).addTo(layer);
    });
  }, [polygons]);

  // Rysowanie szkicu wielokąta
  useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!activeTool || activeTool.mode !== 'polygon' || draftPoints.length === 0) return;

    const color = POLYGON_STYLE[activeTool.kind as PolygonKind].color;
    draftPoints.forEach((pt, i) => {
      L.circleMarker(pt, {
        radius: i === 0 ? 6 : 4,
        color: i === 0 ? '#fff' : color,
        fillColor: color,
        fillOpacity: 1,
        weight: 2,
      }).addTo(layer);
    });
    if (draftPoints.length >= 2) L.polyline(draftPoints, { color, weight: 2.5, dashArray: '5, 5' }).addTo(layer);
    if (draftPoints.length >= 3) L.polygon(draftPoints, { color, weight: 1, fillColor: color, fillOpacity: 0.15 }).addTo(layer);
  }, [draftPoints, activeTool]);

  // Ustawianie kursora
  useEffect(() => {
    setDraftPoints([]);
    const map = mapRef.current;
    if (map) map.getContainer().style.cursor = activeToolId ? 'crosshair' : '';
  }, [activeToolId]);

  // Dopasowanie widoku
  const fitKey = fitPolygon ? JSON.stringify(fitPolygon) : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitPolygon || fitPolygon.length < 3) return;
    map.fitBounds(L.latLngBounds(fitPolygon), { padding: [40, 40], maxZoom: 18 });
  }, [fitKey]);

  const handleFinishPolygon = useCallback(() => {
    if (!activeTool || activeTool.mode !== 'polygon' || draftPoints.length < 3) return;
    onFinishPolygon(activeTool, draftPoints);
    setDraftPoints([]);
    onActiveToolChange(null);
  }, [activeTool, draftPoints, onFinishPolygon, onActiveToolChange]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchText.trim();
    if (!q || !mapRef.current) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (data.length > 0) {
        mapRef.current.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 17);
        setMapNotice(null);
      } else {
        setMapNotice(`Nie znaleziono: "${q}"`);
        setTimeout(() => setMapNotice(null), 3500);
      }
    } catch {
      setMapNotice('Wyszukiwanie adresu jest niedostępne (brak internetu?).');
      setTimeout(() => setMapNotice(null), 3500);
    } finally {
      setIsSearching(false);
    }
  };

  const handleGps = () => {
    if (!('geolocation' in navigator) || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 18),
      () => {
        setMapNotice('Brak dostępu do GPS - zezwól przeglądarce na lokalizację.');
        setTimeout(() => setMapNotice(null), 3500);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
      <div className="absolute top-2 left-2 right-2 z-[1000] flex flex-wrap items-center gap-2 pointer-events-none">
        <form
          onSubmit={handleSearch}
          className="pointer-events-auto flex items-center gap-1 bg-zinc-950/95 border border-zinc-700 rounded px-2 py-1"
        >
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Adres lub miejscowość…"
            className="bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none w-44"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 cursor-pointer"
          >
            {isSearching ? '…' : 'SZUKAJ'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleGps}
          className="pointer-events-auto flex items-center gap-1 bg-zinc-950/95 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono text-zinc-200 hover:border-emerald-500 cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
          <span>Moja pozycja GPS</span>
        </button>

        <div className="pointer-events-auto flex items-center gap-1 bg-zinc-950/95 border border-zinc-700 rounded p-0.5 ml-auto">
          <Layers className="w-3.5 h-3.5 text-zinc-500 ml-1" />
          {BASE_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setBaseId(l.id)}
              className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer ${
                baseId === l.id ? 'bg-emerald-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {l.id === 'osm' ? 'Mapa' : 'Ortofoto'}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute top-12 left-2 z-[1000] flex flex-col gap-1 pointer-events-none max-w-[230px]">
        {tools.map((t) => {
          const isActive = t.id === activeToolId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onActiveToolChange(isActive ? null : t.id)}
              className={`pointer-events-auto text-left px-2.5 py-1.5 rounded border text-[11px] font-mono transition-colors cursor-pointer ${
                isActive
                  ? 'bg-emerald-700 border-emerald-400 text-white shadow-lg'
                  : 'bg-zinc-950/95 border-zinc-700 text-zinc-200 hover:border-zinc-500'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTool && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto flex items-center gap-2 bg-zinc-950/95 border border-emerald-500/60 rounded px-3 py-2 text-[11px] font-mono text-zinc-100 shadow-xl">
          <span className="text-emerald-300">{activeTool.hint}</span>
          {activeTool.mode === 'polygon' && (
            <>
              <span className="text-zinc-500">({draftPoints.length} pkt)</span>
              <button
                type="button"
                onClick={() => setDraftPoints((p) => p.slice(0, -1))}
                disabled={draftPoints.length === 0}
                className="p-1 text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Cofnij punkt"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFinishPolygon}
                disabled={draftPoints.length < 3}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2 py-1 rounded cursor-pointer"
              >
                <Check className="w-3 h-3" />
                <span>Zatwierdź</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onActiveToolChange(null)}
            className="p-1 text-zinc-400 hover:text-rose-300 cursor-pointer"
            title="Anuluj"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mapNotice && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1000] bg-amber-950/95 border border-amber-500/60 text-amber-200 text-[11px] font-mono rounded px-3 py-1.5">
          {mapNotice}
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}