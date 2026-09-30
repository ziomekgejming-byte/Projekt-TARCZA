'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MacroThreat } from '@/types/tarcza';
import { GEOPORTAL_LAYERS, GeoportalLayerConfig } from '@/lib/geoportal/config';
import L from 'leaflet';
import {
  Layers,
  MapPin,
  Crosshair,
  AlertTriangle,
  Flame,
  Droplets,
  Ban,
  Wind,
  ShieldAlert,
  ChevronDown
} from 'lucide-react';

interface TacticalMacroMapProps {
  threats: MacroThreat[];
  onSelectThreat?: (threat: MacroThreat) => void;
  selectedThreatId?: string;
}

export default function TacticalMacroMap({
  threats,
  onSelectThreat,
  selectedThreatId,
}: TacticalMacroMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | L.TileLayer.WMS | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [activeLayerId, setActiveLayerId] = useState<string>('osm');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [layerErrorNotice, setLayerErrorNotice] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);

  // Filtered threats
  const filteredThreats = threats.filter(
    (t) => filterType === 'ALL' || t.type === filterType
  );

  // Switch base map layer safely
  const switchBaseLayer = useCallback((layerConfig: GeoportalLayerConfig) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old layer
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
          maxZoom: 19,
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
        maxZoom: 19,
      });

      // Handle layer failure: fallback to OSM
      newLayer.on('tileerror', () => {
        setLayerErrorNotice(`Usługa ${layerConfig.name} chwilowo niedostępna. Przełączono na OpenStreetMap.`);
        setTimeout(() => setLayerErrorNotice(null), 5000);
        if (currentTileLayerRef.current) {
          map.removeLayer(currentTileLayerRef.current);
        }
        const osmFallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map);
        currentTileLayerRef.current = osmFallback;
        setActiveLayerId('osm');
      });
    } else {
      return;
    }

    newLayer.addTo(map);
    currentTileLayerRef.current = newLayer;
    setActiveLayerId(layerConfig.id);
    setShowLayerMenu(false);
  }, []);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let disposed = false; // geolokalizacja odpowiada asynchronicznie — mapa może być już usunięta
    const polandCenter: [number, number] = [52.0693, 19.4803];
    const initialZoom = 7;

    const map = L.map(mapContainerRef.current, {
      center: polandCenter,
      zoom: initialZoom,
      zoomControl: false,
    });

    mapInstanceRef.current = map;

    // Default to OpenStreetMap
    const defaultLayer = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }
    ).addTo(map);

    currentTileLayerRef.current = defaultLayer;

    // Layer group for threat markers
    const markersGroup = L.layerGroup().addTo(map);
    markersLayerGroupRef.current = markersGroup;

    // Try geolocation
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (disposed) return;
          const userLat = pos.coords.latitude;
          const userLng = pos.coords.longitude;
          setUserCoords([userLat, userLng]);
          map.setView([userLat, userLng], 9);

          // Add user position marker
          const userIcon = L.divIcon({
            className: 'tactical-div-icon',
            html: `
              <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                <div style="position: absolute; width: 24px; height: 24px; border-radius: 50%; background: rgba(16, 185, 129, 0.25); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                <div style="width: 12px; height: 12px; border-radius: 50%; background: #10b981; border: 2px solid #ffffff; box-shadow: 0 0 10px #10b981;"></div>
              </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          L.marker([userLat, userLng], { icon: userIcon })
            .bindPopup('<b style="color: #10b981;">Twoja Bieżąca Lokalizacja (GPS)</b>')
            .addTo(map);
        },
        () => {
          // If denied, keep Poland center
        },
        { timeout: 5000 }
      );
    }

    // Force map invalidate on resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Markers when threats or filter change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerGroupRef.current) return;
    const markersGroup = markersLayerGroupRef.current;
    markersGroup.clearLayers();

    filteredThreats.forEach((threat) => {
      let iconColor = '#ef4444';
      let bgColor = 'rgba(239, 68, 68, 0.2)';
      let label = 'POŻAR';

      if (threat.type === 'ROAD_BLOCK') {
        iconColor = '#f59e0b';
        bgColor = 'rgba(245, 158, 11, 0.2)';
        label = 'BLOKADA';
      } else if (threat.type === 'FLOOD') {
        iconColor = '#06b6d4';
        bgColor = 'rgba(6, 182, 212, 0.2)';
        label = 'POWÓDŹ';
      } else if (threat.type === 'HAZMAT') {
        iconColor = '#a855f7';
        bgColor = 'rgba(168, 85, 247, 0.2)';
        label = 'HAZMAT';
      } else if (threat.type === 'STORM') {
        iconColor = '#3b82f6';
        bgColor = 'rgba(59, 130, 246, 0.2)';
        label = 'BURZA';
      }

      const isCritical = threat.severity === 'CRITICAL';
      const isSelected = threat.id === selectedThreatId;

      const markerHtml = `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
          ${isCritical ? `<div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: ${bgColor}; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
          <div style="width: 22px; height: 22px; border-radius: 50%; background: #09090b; border: 2px solid ${isSelected ? '#ffffff' : iconColor}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${iconColor};">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${iconColor};"></div>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'tactical-div-icon',
        html: markerHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const popupContent = `
        <div style="font-family: inherit; min-width: 240px; padding: 2px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 10px; font-family: monospace; font-weight: bold; padding: 2px 6px; border-radius: 3px; background: ${bgColor}; color: ${iconColor}; border: 1px solid ${iconColor}40;">
              ${label} · ${threat.severity}
            </span>
            <span style="font-size: 10px; color: #a1a1aa; font-family: monospace;">${threat.timestamp}</span>
          </div>
          <div style="font-weight: 600; font-size: 13px; color: #f4f4f5; margin-bottom: 4px; line-height: 1.3;">
            ${threat.title}
          </div>
          <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 8px; line-height: 1.4;">
            ${threat.description}
          </div>
          <div style="background: #18181b; border-radius: 4px; padding: 6px 8px; font-size: 10px; font-family: monospace; color: #a1a1aa; display: flex; justify-content: space-between; align-items: center;">
            <span><b style="color: #e4e4e7;">Źródło:</b> ${threat.source}</span>
            <span><b style="color: #e4e4e7;">Siły PSP:</b> ${threat.activeUnits} zastępów</span>
          </div>
        </div>
      `;

      const marker = L.marker(threat.coords, { icon: customIcon });
      marker.bindPopup(popupContent, { maxWidth: 300 });

      marker.on('click', () => {
        if (onSelectThreat) onSelectThreat(threat);
      });

      marker.addTo(markersGroup);
    });
  }, [filteredThreats, selectedThreatId, onSelectThreat]);

  // Center on Poland or User Coords
  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    if (userCoords) {
      mapInstanceRef.current.setView(userCoords, 9);
    } else {
      mapInstanceRef.current.setView([52.0693, 19.4803], 7);
    }
  };

  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut();
  };

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 overflow-hidden bg-zinc-950">
      {/* Top Floating Controls Bar */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Category Filters: Small, clean, legible */}
        <div className="flex items-center gap-1 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 p-1 rounded-md shadow-lg pointer-events-auto overflow-x-auto max-w-full">
          {[
            { id: 'ALL', label: 'Wszystkie' },
            { id: 'FIRE', label: 'Pożary', icon: Flame, color: 'text-rose-400' },
            { id: 'ROAD_BLOCK', label: 'Blokady S7/DK', icon: Ban, color: 'text-amber-400' },
            { id: 'FLOOD', label: 'Wody/Powódź', icon: Droplets, color: 'text-cyan-400' },
            { id: 'HAZMAT', label: 'HAZMAT', icon: AlertTriangle, color: 'text-purple-400' },
            { id: 'STORM', label: 'Burze', icon: Wind, color: 'text-blue-400' },
          ].map((cat) => {
            const Icon = cat.icon;
            const isActive = filterType === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setFilterType(cat.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                {Icon && <Icon className={`w-3.5 h-3.5 ${cat.color || ''}`} />}
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Base Layer Selector Dropdown */}
        <div className="relative pointer-events-auto">
          <button
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950/90 backdrop-blur-md hover:bg-zinc-900 border border-zinc-800 rounded-md text-xs font-medium text-zinc-200 shadow-lg transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Warstwa bazowa:</span>
            <span className="text-emerald-400 font-mono">
              {GEOPORTAL_LAYERS.find((l) => l.id === activeLayerId)?.name.split(' ')[0] || 'OSM'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>

          {showLayerMenu && (
            <div className="absolute right-0 mt-1 w-64 bg-zinc-950 border border-zinc-800 rounded-md shadow-xl py-1 z-50 text-xs">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                Wybierz podkład kartograficzny
              </div>
              {GEOPORTAL_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => switchBaseLayer(layer)}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-zinc-900 transition-colors cursor-pointer ${
                    activeLayerId === layer.id ? 'bg-zinc-900/80 border-l-2 border-emerald-500' : ''
                  }`}
                >
                  <span className={`font-medium ${activeLayerId === layer.id ? 'text-emerald-400' : 'text-zinc-200'}`}>
                    {layer.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 line-clamp-1">{layer.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Fallback Toast */}
      {layerErrorNotice && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-amber-950/90 border border-amber-500/50 rounded-md shadow-xl flex items-center gap-2 text-amber-200 text-xs backdrop-blur-md animate-fade-in">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{layerErrorNotice}</span>
        </div>
      )}

      {/* Floating Map Navigation Controls */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={handleRecenter}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center shadow-lg transition-colors cursor-pointer"
          title="Wyśrodkuj na bieżącym położeniu / Polska"
        >
          <Crosshair className="w-4 h-4 text-emerald-400" />
        </button>
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer"
          title="Przybliż"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer"
          title="Oddal"
        >
          -
        </button>
      </div>

      {/* Map Attribution/Status overlay at bottom left */}
      <div className="absolute bottom-3 left-3 z-[1000] px-2.5 py-1 bg-zinc-950/80 backdrop-blur-xs border border-zinc-800/80 rounded text-[10px] font-mono text-zinc-400 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>GUGiK PZGiK / OpenStreetMap · TARCZA KDR</span>
      </div>

      {/* Leaflet DOM container */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />
    </div>
  );
}
