// START OF FILE components/tactical/TacticalMicroMap.tsx
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DroneTelemetry, HotSwapStation, TacticalMarker, TacticalZone, FireCell } from '@/types/tarcza';
import { GEOPORTAL_LAYERS, GeoportalLayerConfig } from '@/lib/geoportal/config';
import { OFFLINE_FACILITY_BUILDINGS } from '@/lib/offline-maps-data';
import L from 'leaflet';
import { Layers, ChevronDown, Crosshair, ShieldAlert, Undo2, Check } from 'lucide-react';

interface TacticalMicroMapProps {
  drones: DroneTelemetry[];
  hotSwapStations: HotSwapStation[];
  markers: TacticalMarker[];
  activeLayers: any;
  onSelectMarker?: (marker: TacticalMarker) => void;
  onSelectDrone?: (drone: DroneTelemetry) => void;
  selectedDroneId?: string;
  isDrawingHotSwap?: boolean;
  onFinishDrawingHotSwap?: (newStation: HotSwapStation) => void;
  onCancelDrawingHotSwap?: () => void;
  activeEvacuationRoute?: string | null;
  centerCoords?: [number, number];
  incidentZones?: TacticalZone[];
  onAddZone?: (zone: TacticalZone) => void;
  onRemoveZone?: (zoneId: string) => void;
  onUnitCommand?: (markerId: string, command: any) => void;
  buildingDecayRisks?: Record<string, number>;
  temperatureGrid?: FireCell[];
}

export default function TacticalMicroMap({
  drones, hotSwapStations, markers, activeLayers, onSelectMarker, onSelectDrone,
  selectedDroneId, isDrawingHotSwap, onFinishDrawingHotSwap, onCancelDrawingHotSwap,
  centerCoords, incidentZones = [], onAddZone, onRemoveZone, onUnitCommand,
  buildingDecayRisks = {}, temperatureGrid = [],
}: TacticalMicroMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);

  const buildingsLayerRef = useRef<L.LayerGroup | null>(null);
  const firesLayerRef = useRef<L.LayerGroup | null>(null);
  const dronesLayerRef = useRef<L.LayerGroup | null>(null);
  const friendlyLayerRef = useRef<L.LayerGroup | null>(null);
  const victimsLayerRef = useRef<L.LayerGroup | null>(null);

  const friendlyMarkersMap = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    (window as any).tarczaExecuteUnitCommand = (markerId: string, cmd: any) => onUnitCommand?.(markerId, cmd);
    return () => { delete (window as any).tarczaExecuteUnitCommand; };
  }, [onUnitCommand]);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, { center: centerCoords || [52.2120, 20.7930], zoom: 16, zoomControl: false, attributionControl: false });
    mapInstanceRef.current = map;

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);
    currentTileLayerRef.current = osm;

    buildingsLayerRef.current = L.layerGroup().addTo(map);
    firesLayerRef.current = L.layerGroup().addTo(map);
    victimsLayerRef.current = L.layerGroup().addTo(map);
    friendlyLayerRef.current = L.layerGroup().addTo(map);
    dronesLayerRef.current = L.layerGroup().addTo(map);

    return () => { map.remove(); mapInstanceRef.current = null; };
  }, []);

  useEffect(() => {
    if (centerCoords && mapInstanceRef.current) mapInstanceRef.current.setView(centerCoords, 16);
  }, [centerCoords]);

  // RENDEROWANIE BUDYNKÓW
  useEffect(() => {
    if (!buildingsLayerRef.current) return;
    const layer = buildingsLayerRef.current;
    layer.clearLayers();

    OFFLINE_FACILITY_BUILDINGS.forEach((bld) => {
      L.polygon(bld.polygon, { color: '#38bdf8', weight: 2, fillColor: '#0284c7', fillOpacity: 0.18 }).addTo(layer);
    });
  }, []);

  // RENDEROWANIE SIATKI POŻARU I PREDYKCJI (AT RISK)
  useEffect(() => {
    if (!firesLayerRef.current) return;
    const layer = firesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.fires) return;

    temperatureGrid.forEach((cell) => {
      if (cell.isExtinguished && cell.temperature <= 40) return;

      let fillColor = 'transparent';
      let strokeColor = 'transparent';
      let fillOpacity = 0;
      let dashArray = undefined;
      let label = '';

      const isBuilding = (cell.sector || '').includes('BUILDING');
      const ignitionThreshold = isBuilding ? 350 : 120;

      if (cell.temperature >= ignitionThreshold) {
        // PŁONIE (BURNING)
        fillColor = cell.temperature >= 700 ? '#7f1d1d' : '#ea580c';
        strokeColor = cell.temperature >= 700 ? '#ef4444' : '#f97316';
        fillOpacity = 0.65;
        label = `🔥 PŁONIE (${cell.temperature}°C)`;
      } else if (cell.temperature >= 60) {
        // ZAGROŻENIE (AT RISK) - Predykcja gdzie ogień przejdzie
        fillColor = '#facc15';
        strokeColor = '#eab308';
        fillOpacity = 0.2;
        dashArray = '4, 4';
        label = `⚠️ ZAGROŻENIE ZAPŁONEM (${cell.temperature}°C)`;
      } else {
        return; // Bezpieczne - nie rysuj
      }

      const rect = L.rectangle(cell.bounds, { color: strokeColor, weight: 1.5, dashArray, fillColor, fillOpacity });
      rect.bindTooltip(`${label} | Teren: ${isBuilding ? 'Budynek' : 'Las/Trawa'}`, {
        permanent: false,
        className: 'bg-zinc-950 text-zinc-200 font-mono text-[9px] px-1 py-0.5 rounded border border-zinc-700 shadow',
      });
      rect.addTo(layer);
    });
  }, [activeLayers.fires, temperatureGrid]);

  // RENDEROWANIE JEDNOSTEK
  useEffect(() => {
    if (!friendlyLayerRef.current) return;
    const layer = friendlyLayerRef.current;

    if (!activeLayers.friendlyUnits) {
      layer.clearLayers();
      friendlyMarkersMap.current = {};
      return;
    }

    const currentIds = new Set<string>();

    markers.filter((m) => m.type === 'FRIENDLY_UNIT').forEach((m) => {
      currentIds.add(m.id);
      const isExtinguishing = m.unitStatus === 'EXTINGUISHING';
      const isOnRoute = m.unitStatus === 'ON_ROUTE';
      const color = isExtinguishing ? '#e11d48' : isOnRoute ? '#38bdf8' : '#3b82f6';
      
      const icon = L.divIcon({
        className: 'tactical-div-icon',
        html: `<div style="width: 32px; height: 32px; border-radius: 6px; background: #09090b; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px ${color}; cursor: pointer;"><span style="font-size: 14px;">🚒</span></div>`,
        iconSize: [32, 32], iconAnchor: [16, 16]
      });

      const popupContent = `
        <div style="min-width: 200px; font-family: inherit;">
          <div style="font-size: 10px; font-weight: bold; color: ${color}; margin-bottom: 4px;">${m.label}</div>
          <div style="background: #18181b; padding: 6px; border-radius: 4px; margin-bottom: 8px; font-size: 9px; color: #10b981;">Status: ${m.reportStatus || m.status}</div>
        </div>
      `;

      if (friendlyMarkersMap.current[m.id]) {
        const existingMarker = friendlyMarkersMap.current[m.id];
        existingMarker.setLatLng(m.coords);
        existingMarker.setIcon(icon);
        if (existingMarker.getPopup() && existingMarker.isPopupOpen()) existingMarker.getPopup()?.setContent(popupContent);
        else existingMarker.bindPopup(popupContent);
      } else {
        const newMarker = L.marker(m.coords, { icon });
        newMarker.bindPopup(popupContent);
        newMarker.addTo(layer);
        friendlyMarkersMap.current[m.id] = newMarker;
      }
    });

    Object.keys(friendlyMarkersMap.current).forEach((id) => {
      if (!currentIds.has(id)) {
        layer.removeLayer(friendlyMarkersMap.current[id]);
        delete friendlyMarkersMap.current[id];
      }
    });
  }, [markers, activeLayers.friendlyUnits]);

  // RENDEROWANIE DRONÓW
  useEffect(() => {
    if (!dronesLayerRef.current) return;
    const layer = dronesLayerRef.current;
    layer.clearLayers();

    if (!activeLayers.drones) return;

    drones.forEach((drone) => {
      const color = drone.battery < 25 ? '#ef4444' : drone.isExternalSupport ? '#818cf8' : '#38bdf8';
      const icon = L.divIcon({
        className: 'tactical-div-icon',
        html: `<div style="width: 28px; height: 28px; border-radius: 50%; background: #09090b; border: 2px solid ${color}; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color};"><span style="font-size: 10px;">${drone.isExternalSupport ? '🛸' : '🚁'}</span></div>`,
        iconSize: [28, 28], iconAnchor: [14, 14]
      });
      L.marker(drone.coords, { icon }).bindTooltip(drone.callsign, { permanent: false, className: 'font-mono text-[9px]' }).addTo(layer);
    });
  }, [drones, activeLayers.drones]);

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-zinc-950 select-none overflow-hidden">
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-1.5 pointer-events-auto">
        <button onClick={() => mapInstanceRef.current?.setView(centerCoords || [52.2120, 20.7930], 16)} className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center shadow-lg transition-colors cursor-pointer"><Crosshair className="w-4 h-4 text-emerald-400" /></button>
        <button onClick={() => mapInstanceRef.current?.zoomIn()} className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer">+</button>
        <button onClick={() => mapInstanceRef.current?.zoomOut()} className="w-8 h-8 rounded-md bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm shadow-lg transition-colors cursor-pointer">-</button>
      </div>
      <div ref={mapContainerRef} className="w-full h-full flex-1" />
    </div>
  );
}