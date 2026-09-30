'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Map as MapIcon, Undo2, Upload, X } from 'lucide-react';
import TacticalMicroMap, { TacticalMicroMapProps } from './TacticalMicroMap';
import { TerrainSheet, findTerrain, onTerrainChanged, registerSheet, sheetCenterLatLng } from '@/lib/terrain';
import { ascFileToSheet } from '@/lib/asc';

const Scene3D = dynamic(() => import('./Scene3D'), { ssr: false });
const DEFAULT_CENTER: [number, number] = [52.212, 20.793];

type Toast = { kind: 'info' | 'ok' | 'warn' | 'err'; text: string } | null;

/**
 * Jedno miejsce na mapę taktyczną: tam, gdzie mamy NMT z ASC — widok 3D (z przełącznikiem na 2D);
 * poza obszarem pokrytym ASC — zwykła mapa 2D. Plik ASC można wgrać przyciskiem albo przeciągnąć na mapę.
 */
export default function MapViewport(props: TacticalMicroMapProps) {
  const incLat = (props.centerCoords || DEFAULT_CENTER)[0];
  const incLng = (props.centerCoords || DEFAULT_CENTER)[1];
  const [override, setOverride] = useState<[number, number] | null>(null); // środek wgranego arkusza, gdy nie pokrywa akcji
  const center = useMemo<[number, number]>(() => override || [incLat, incLng], [override, incLat, incLng]);

  const [terrain, setTerrain] = useState<TerrainSheet | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    let off = false;
    findTerrain(center[0], center[1]).then((t) => !off && setTerrain(t));
    return () => { off = true; };
  }, [center]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => onTerrainChanged(() => { refresh(); }), [refresh]);

  useEffect(() => {
    if (!toast || toast.kind === 'info') return;
    const t = setTimeout(() => setToast(null), toast.kind === 'ok' ? 8000 : 15000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadFile = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    setToast({ kind: 'info', text: `Wczytuję ${f.name} (${(f.size / 1e6).toFixed(1)} MB)…` });
    await new Promise((r) => setTimeout(r, 30)); // daj przeglądarce narysować komunikat, zanim zablokuje ją parsowanie
    try {
      const { sheet, grid } = await ascFileToSheet(f, 2);
      registerSheet(sheet);
      const info = `${grid.ncols}×${grid.nrows} co ${grid.cellsize} m, ${grid.min.toFixed(1)}–${grid.max.toFixed(1)} m n.p.m., brak danych ${(grid.nodataFraction * 100).toFixed(1)}%`;
      const covers = await findTerrain(incLat, incLng);
      if (covers) {
        setOverride(null);
        setMode('3d');
        setToast({ kind: 'ok', text: `Wczytano ${f.name}: ${info}. Miejsce akcji jest pokryte — widok 3D.` });
      } else {
        const c = sheetCenterLatLng(sheet);
        if (c) {
          setOverride(c);
          setMode('3d');
          setToast({ kind: 'warn', text: `Wczytano ${f.name}: ${info}. Ten arkusz nie obejmuje miejsca akcji, więc pokazuję jego środek (${c[0].toFixed(4)}, ${c[1].toFixed(4)}). „Wróć do akcji” przywraca mapę akcji.` });
        } else setToast({ kind: 'err', text: `${f.name} nie zawiera użytecznych danych wysokościowych.` });
      }
    } catch (e) {
      console.error('Wczytywanie ASC nie powiodło się:', e);
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Nie udało się wczytać pliku ASC.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const show3d = !!terrain && mode === '3d';
  const btn = (active: boolean) => `flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono cursor-pointer ${active ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`;
  const toastColor = { info: 'border-sky-500/50 text-sky-300', ok: 'border-emerald-500/50 text-emerald-300', warn: 'border-amber-500/50 text-amber-300', err: 'border-rose-500/60 text-rose-300' };

  return (
    <div
      className="relative w-full h-full"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0]); } }}
    >
      {show3d ? (
        <Scene3D
          key={terrain!.id + center[0].toFixed(4) + center[1].toFixed(4)}
          terrain={terrain!}
          center={center}
          markers={override ? [] : props.markers}
          drones={override ? [] : props.drones}
          hotSwapStations={override ? [] : props.hotSwapStations}
          temperatureGrid={override ? [] : props.temperatureGrid || []}
          zones={override ? [] : props.incidentZones || []}
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
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer disabled:opacity-50">
          <Upload className="w-3 h-3" />{busy ? 'Wczytuję…' : 'Wczytaj ASC'}
        </button>
        {override && (
          <button type="button" onClick={() => { setOverride(null); setToast(null); }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-amber-600 text-white hover:bg-amber-500 cursor-pointer">
            <Undo2 className="w-3 h-3" />Wróć do akcji
          </button>
        )}
        {/* bez filtra accept — okno wyboru pokaże każdy plik, także .asc zapisane jako .txt / bez rozszerzenia */}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
      </div>

      {toast && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1100] max-w-[460px] bg-zinc-950/95 border rounded px-3 py-2 text-[11px] font-mono shadow-xl flex gap-2 items-start pointer-events-auto ${toastColor[toast.kind]}`}>
          <span className="leading-snug">{toast.text}</span>
          {toast.kind !== 'info' && <button type="button" onClick={() => setToast(null)} className="shrink-0 text-zinc-500 hover:text-zinc-200 cursor-pointer"><X className="w-3 h-3" /></button>}
        </div>
      )}
    </div>
  );
}
