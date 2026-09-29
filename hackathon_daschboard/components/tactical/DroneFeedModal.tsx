'use client';

import React, { useState, useEffect } from 'react';
import { X, Eye, Camera } from 'lucide-react';
import { DroneTelemetry } from '@/types/tarcza';

interface DroneFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  drone: DroneTelemetry | null;
}

export default function DroneFeedModal({ isOpen, onClose, drone }: DroneFeedModalProps) {
  const [feedMode, setFeedMode] = useState<'FLIR_THERMAL' | 'OPTICAL_HD' | 'LIDAR_POINTCLOUD'>('OPTICAL_HD');
  const [snapshotTaken, setSnapshotTaken] = useState(false);

  // Wymuszanie domyślnego widoku w zależności od sensora drona
  useEffect(() => {
    if (drone) {
      if (drone.payload === 'LIDAR_STRUCTURAL') {
        setFeedMode('LIDAR_POINTCLOUD');
      } else if (drone.payload === 'THERMAL_FLIR' || drone.payload === 'FIRST_AID_DROP') {
        setFeedMode('FLIR_THERMAL');
      } else {
        setFeedMode('OPTICAL_HD');
      }
    }
  }, [drone]);

  if (!isOpen || !drone) return null;

  const handleSnapshot = () => {
    setSnapshotTaken(true);
    setTimeout(() => setSnapshotTaken(false), 2000);
  };

  const hasThermal = drone.payload === 'THERMAL_FLIR' || drone.payload === 'FIRST_AID_DROP';
  const hasLidar = drone.payload === 'LIDAR_STRUCTURAL';
  const viewers = (drone as any).viewersCount || 0;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/70">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-zinc-100">{drone.callsign}</span>
                <span className="text-[10px] font-mono text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded bg-emerald-950/40">
                  TRANSMISJA WIDEO LIVE
                </span>
                {viewers > 0 && (
                  <span className="text-[10px] font-mono text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded bg-amber-950/40 flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    {viewers + 1} OGLĄDA
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono mt-1">
                Model: {drone.model} | Pułap: {drone.altitude}m | Prędkość: {drone.speed} km/h
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Screen HUD Simulation */}
        <div className="relative aspect-video bg-zinc-950 overflow-hidden flex items-center justify-center select-none border-b border-zinc-800">
          {/* Visual Simulation based on mode */}
          {feedMode === 'FLIR_THERMAL' && (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-rose-700/60 via-amber-800/40 to-slate-950 flex items-center justify-center">
              <div className="absolute top-1/4 left-1/3 w-48 h-32 bg-amber-500/40 rounded-full blur-xl animate-pulse" />
              <div className="absolute top-1/3 left-1/2 w-28 h-20 bg-rose-600/70 rounded-full blur-lg" />
              <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-rose-400 p-2 text-[10px] font-mono text-rose-300 bg-black/60 rounded">
                <div>HOTSPOT MAX: +582.4°C</div>
                <div>DELTA T: +14.2°C/min</div>
              </div>
            </div>
          )}

          {feedMode === 'OPTICAL_HD' && (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-800 via-zinc-900 to-zinc-950 flex items-center justify-center">
              <div className="text-center p-6 bg-black/60 border border-zinc-700 rounded-lg">
                <p className="text-xs text-zinc-300 mb-1 font-mono">OBRAZ ŚWIATŁA WIDZIALNEGO (HD 4K)</p>
                <p className="text-[11px] text-zinc-400">Silne zadymienie w sektorze. Widoczność ograniczona do 4.2m.</p>
                {hasThermal && <p className="text-[11px] text-amber-400 font-mono mt-2">Zalecany powrót do trybu termowizji FLIR.</p>}
              </div>
            </div>
          )}

          {feedMode === 'LIDAR_POINTCLOUD' && (
            <div className="absolute inset-0 bg-black flex items-center justify-center">
              <div className="w-full h-full flex items-center justify-center relative opacity-70">
                <div className="w-72 h-48 border border-cyan-500/50 rounded grid grid-cols-6 grid-rows-4 gap-1 p-2">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} className="border border-cyan-400/20 text-[8px] font-mono text-cyan-400 p-0.5">
                      z:{(Math.sin(i) * 12 + 20).toFixed(0)}m
                    </div>
                  ))}
                </div>
                <div className="absolute text-cyan-400 text-xs font-mono bg-black/80 px-2 py-1 border border-cyan-500/40">
                  SIATKA STRUKTURALNA: UGIĘCIE DACHU 14.8 CM
                </div>
              </div>
            </div>
          )}

          {/* Tactical Crosshair Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-24 h-24 border border-zinc-400/40 rounded-full flex items-center justify-center">
              <div className="w-1 h-1 bg-rose-500 rounded-full" />
            </div>
            <div className="absolute w-40 h-px bg-zinc-400/30" />
            <div className="absolute h-40 w-px bg-zinc-400/30" />
          </div>

          {/* OSD Telemetry Corners */}
          <div className="absolute top-3 left-3 bg-black/70 border border-zinc-800 p-2 rounded text-[10px] font-mono text-zinc-300 space-y-0.5">
            <div>CAM: {hasLidar ? 'LIDAR ZENMUSE L1' : 'FLIR BOSON 640'}</div>
            <div>FOV: 34° × 26° | ZOOM: 2.4x</div>
          </div>

          <div className="absolute top-3 right-3 bg-black/70 border border-zinc-800 p-2 rounded text-[10px] font-mono text-right text-zinc-300 space-y-0.5">
            <div className="flex items-center justify-end gap-1.5">
              <span>BATERIA:</span>
              <span className={drone.battery < 20 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                {Math.round(drone.battery)}%
              </span>
            </div>
            <div>STATUS: {drone.status}</div>
          </div>

          {snapshotTaken && (
            <div className="absolute bottom-4 bg-emerald-500 text-black px-3 py-1 rounded text-xs font-mono font-bold">
              ZAPISANO KLATKĘ DLA KDR
            </div>
          )}
        </div>

        {/* Video Controls & Mode Switcher */}
        <div className="px-5 py-3 bg-zinc-900/60 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 uppercase">Tryb Sensora:</span>
            <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
              <button
                onClick={() => hasThermal && setFeedMode('FLIR_THERMAL')}
                disabled={!hasThermal}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  !hasThermal ? 'opacity-30 cursor-not-allowed text-zinc-600' :
                  feedMode === 'FLIR_THERMAL'
                    ? 'bg-rose-950/80 border border-rose-500/40 text-rose-200'
                    : 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                }`}
              >
                Termowizja (FLIR)
              </button>
              <button
                onClick={() => setFeedMode('OPTICAL_HD')}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                  feedMode === 'OPTICAL_HD'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Kamera Optyczna
              </button>
              <button
                onClick={() => hasLidar && setFeedMode('LIDAR_POINTCLOUD')}
                disabled={!hasLidar}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  !hasLidar ? 'opacity-30 cursor-not-allowed text-zinc-600' :
                  feedMode === 'LIDAR_POINTCLOUD'
                    ? 'bg-cyan-950/80 border border-cyan-500/40 text-cyan-200'
                    : 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                }`}
              >
                LiDAR 3D
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSnapshot}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Zrzut Klatki (Raport)</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors cursor-pointer"
            >
              Zamknij
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}