'use client';

import React, { useState } from 'react';
import { X, Eye, Thermometer, Battery, Navigation, Crosshair, Camera, RefreshCw } from 'lucide-react';
import { DroneTelemetry } from '@/types/tarcza';

interface DroneFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  drone: DroneTelemetry | null;
}

export default function DroneFeedModal({ isOpen, onClose, drone }: DroneFeedModalProps) {
  const [feedMode, setFeedMode] = useState<'FLIR_THERMAL' | 'OPTICAL_HD' | 'LIDAR_POINTCLOUD'>('FLIR_THERMAL');
  const [snapshotTaken, setSnapshotTaken] = useState(false);

  if (!isOpen || !drone) return null;

  const handleSnapshot = () => {
    setSnapshotTaken(true);
    setTimeout(() => setSnapshotTaken(false), 2000);
  };

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
                <span className="text-[11px] font-mono text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded bg-emerald-950/40">
                  TRANSMISJA WIDEO LIVE · JETSON EDGE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono">
                Model: {drone.model} | Pułap: {drone.altitude}m | Prędkość: {drone.speed} km/h
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Screen HUD Simulation */}
        <div className="relative aspect-video bg-zinc-950 overflow-hidden flex items-center justify-center select-none border-b border-zinc-800">
          {/* Visual Simulation based on mode */}
          {feedMode === 'FLIR_THERMAL' && (
            <div className="absolute inset-0 bg-radial from-rose-700/60 via-amber-800/40 to-slate-950 flex items-center justify-center">
              {/* Heat anomaly contours */}
              <div className="absolute top-1/4 left-1/3 w-48 h-32 bg-amber-500/40 rounded-full blur-xl animate-pulse" />
              <div className="absolute top-1/3 left-1/2 w-28 h-20 bg-rose-600/70 rounded-full blur-lg" />
              {/* Hot spot marker */}
              <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-rose-400 p-2 text-[10px] font-mono text-rose-300 bg-black/60 rounded">
                <div>HOTSPOT MAX: +582.4°C</div>
                <div>DELTA T: +14.2°C/min</div>
              </div>
              {/* Victim thermal signature */}
              <div className="absolute bottom-1/3 left-1/4 border border-emerald-400 p-1.5 text-[10px] font-mono text-emerald-300 bg-black/60 rounded flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>SYGNATURA CIAŁA: 36.8°C (3 OSOBY)</span>
              </div>
            </div>
          )}

          {feedMode === 'OPTICAL_HD' && (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-800 via-zinc-900 to-zinc-950 flex items-center justify-center">
              <div className="text-center p-6 bg-black/60 border border-zinc-700 rounded-lg">
                <p className="text-xs text-zinc-300 mb-1 font-mono">OBRAZ ŚWIATŁA WIDZIALNEGO (HD 4K)</p>
                <p className="text-[11px] text-zinc-400">Silne zadymienie optyczne w sektorze B-4. Widoczność ograniczona do 4.2m.</p>
                <p className="text-[11px] text-amber-400 font-mono mt-2">Zalecany powrót do trybu termowizji FLIR.</p>
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
            <div>CAM: FLIR BOSON 640 @ 60Hz</div>
            <div>FOV: 34° × 26° | ZOOM: 2.4x</div>
            <div>POŁOŻENIE: SEKTOR B-4 / HALA 1</div>
          </div>

          <div className="absolute top-3 right-3 bg-black/70 border border-zinc-800 p-2 rounded text-[10px] font-mono text-right text-zinc-300 space-y-0.5">
            <div className="flex items-center justify-end gap-1.5">
              <span>BATERIA:</span>
              <span className={drone.battery < 20 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                {drone.battery}%
              </span>
            </div>
            <div>STATUS: {drone.status}</div>
            <div>PRZEPUSTOWOŚĆ: 14.2 Mbps (AES-256)</div>
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
                onClick={() => setFeedMode('FLIR_THERMAL')}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  feedMode === 'FLIR_THERMAL'
                    ? 'bg-rose-950/80 border border-rose-500/40 text-rose-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Termowizja (FLIR)
              </button>
              <button
                onClick={() => setFeedMode('OPTICAL_HD')}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  feedMode === 'OPTICAL_HD'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Kamera Optyczna
              </button>
              <button
                onClick={() => setFeedMode('LIDAR_POINTCLOUD')}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  feedMode === 'LIDAR_POINTCLOUD'
                    ? 'bg-cyan-950/80 border border-cyan-500/40 text-cyan-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                LiDAR 3D
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSnapshot}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Zrzut Klatki (Raport KDR)</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors"
            >
              Zamknij
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
