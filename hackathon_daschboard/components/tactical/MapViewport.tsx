'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Map as MapIcon, Upload } from 'lucide-react';
import TacticalMicroMap, { TacticalMicroMapProps } from './TacticalMicroMap';
import { TerrainSheet, findTerrain, onTerrainChanged, registerSheet } from '@/lib/terrain';
import { ascFileToSheet } from '@/lib/asc';

const Scene3D = dynamic(() => import('./Scene3D'), { ssr: false });
const DEFAULT_CENTER: [number, number] = [52.212, 20.793];

/**
 * Jedno miejsce na mapę taktyczną: tam, gdzie mamy NMT z ASC — widok 3D (z przełącznikiem na 2D);
 * poza obszarem pokrytym ASC — zwykła mapa 2D. Plik ASC można też wgrać ręcznie.
 */
export default function MapViewport(props: TacticalMicroMapProps) {
  const center = props.centerCoords || DEFAULT_CENTER;
  const [terrain, setTerrain] = useState<TerrainSheet | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    let off = false;
    findTerrain(center[0], center[1]).then((t) => !off && setTerrain(t));
    return () => { off = true; };
  }, [center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => refresh(), [refresh]);
  useEffect(() => onTerrainChanged(() => { refresh(); }), [refresh]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const { sheet, grid } = await ascFileToSheet(f, 2);
      registerSheet(sheet);
      const covers = await findTerrain(center[0], center[1]);
      setMsg(covers ? `Wczytano ${f.name}: ${grid.ncols}×${grid.nrows}, ${grid.min.toFixed(1)}–${grid.max.toFixed(1)} m n.p.m.` : `Wczytano ${f.name}, ale nie obejmuje ona aktualnego miejsca akcji — zostaje mapa 2D.`);
      if (covers) setMode('3d');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Nie udało się wczytać pliku ASC.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const show3d = !!terrain && mode === '3d';
  const btn = (active: boolean) => `flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono cursor-pointer ${active ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`;

  return (
    <div className="relative w-full h-full">
      {show3d ? (
        <Scene3D
          terrain={terrain!}
          center={center}
          markers={props.markers}
          drones={props.drones}
          hotSwapStations={props.hotSwapStations}
          temperatureGrid={props.temperatureGrid || []}
          zones={props.incidentZones || []}
          buildingDecayRisks={props.buildingDecayRisks}
          activeLayers={props.activeLayers}
        />
      ) : (
        <TacticalMicroMap {...props} />
      )}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 bg-zinc-950/90 border border-zinc-800 rounded px-1.5 py-1 pointer-events-auto">
        {terrain && (
          <>
            <button onClick={() => setMode('3d')} className={btn(mode === '3d')}><Box className="w-3 h-3" />3D</button>
            <button onClick={() => setMode('2d')} className={btn(mode === '2d')}><MapIcon className="w-3 h-3" />2D</button>
          </>
        )}
        {!terrain && <span className="text-[10px] font-mono text-zinc-500 px-1">2D — brak NMT dla tego miejsca</span>}
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer disabled:opacity-50">
          <Upload className="w-3 h-3" />{busy ? 'Wczytuję…' : 'Wczytaj ASC'}
        </button>
        <input ref={fileRef} type="file" accept=".asc,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {msg && <div className="absolute left-3 z-[1000] max-w-[320px] bg-zinc-950/95 border border-amber-500/40 rounded px-2 py-1 text-[10px] font-mono text-amber-300 mt-0" style={{ top: show3d ? 176 : 48 }}>{msg}</div>}
    </div>
  );
}
