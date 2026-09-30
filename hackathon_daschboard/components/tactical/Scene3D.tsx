'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DroneTelemetry, FireCell, HotSwapStation, TacticalMarker, TacticalZone } from '@/types/tarcza';
import { OFFLINE_FACILITY_BUILDINGS, isPointInPolygon } from '@/lib/offline-maps-data';
import { fromPL1992, toPL1992 } from '@/lib/geo2180';
import { TerrainSheet, sheetHeight } from '@/lib/terrain';
import { OsmScene, centroidOf, loadOsmScene } from '@/lib/osm-scene';

export interface Scene3DProps {
  terrain: TerrainSheet;
  center: [number, number]; // [lat, lng] — środek sceny
  radiusM?: number;
  markers: TacticalMarker[];
  drones: DroneTelemetry[];
  hotSwapStations: HotSwapStation[];
  temperatureGrid: FireCell[];
  zones: TacticalZone[];
  buildingDecayRisks?: Record<string, number>; // % (0-100), klucz = id budynku z OFFLINE_FACILITY_BUILDINGS
  activeLayers?: { drones?: boolean; friendlyUnits?: boolean; fires?: boolean };
}

const TILE_Z = 17;
const tileXY = (lat: number, lng: number, z = TILE_Z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

/** Podkład: kafle OSM zszyte w jedną teksturę; zwraca też funkcję lat/lng → UV. */
async function buildMapTexture(bbox: { n: number; s: number; w: number; e: number }) {
  const a = tileXY(bbox.n, bbox.w);
  const b = tileXY(bbox.s, bbox.e);
  const x0 = Math.floor(a.x), x1 = Math.floor(b.x), y0 = Math.floor(a.y), y1 = Math.floor(b.y);
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
  if (W > 4096 || H > 4096) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#27272a';
  ctx.fillRect(0, 0, W, H);
  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      jobs.push(
        new Promise<void>((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256); loaded++; res(); };
          img.onerror = () => res();
          img.src = `/api/tiles?url=${encodeURIComponent(`https://tile.openstreetmap.org/${TILE_Z}/${tx}/${ty}.png`)}`;
        })
      );
  await Promise.all(jobs);
  if (!loaded) return null;
  ctx.fillStyle = 'rgba(9,9,11,0.28)'; // przyciemnienie pod ciemny interfejs
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const toUV = (lat: number, lng: number): [number, number] => {
    const p = tileXY(lat, lng);
    return [((p.x - x0) * 256) / W, 1 - ((p.y - y0) * 256) / H];
  };
  return { tex, toUV };
}

const labelMats = new Map<string, THREE.SpriteMaterial>();
function makeLabel(text: string, color = '#e4e4e7'): THREE.Sprite {
  const key = text + color;
  let mat = labelMats.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(9,9,11,0.82)'; g.fillRect(0, 8, 256, 48);
    g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(1, 9, 254, 46);
    g.fillStyle = color; g.font = 'bold 24px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.length > 18 ? text.slice(0, 17) + '…' : text, 128, 32);
    mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    labelMats.set(key, mat);
  }
  const s = new THREE.Sprite(mat);
  s.scale.set(28, 7, 1);
  s.renderOrder = 10;
  return s;
}

function clearGroup(g: THREE.Group) {
  for (const child of [...g.children]) {
    g.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat && !(o instanceof THREE.Sprite)) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
  }
}

export default function Scene3D({ terrain, center, radiusM = 700, markers, drones, hotSwapStations, temperatureGrid, zones, buildingDecayRisks = {}, activeLayers = {} }: Scene3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    three: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    terrainG: THREE.Group; buildingsG: THREE.Group; dynG: THREE.Group;
    toLocal: (lat: number, lng: number) => { x: number; z: number };
    groundY: (lat: number, lng: number) => number;
    ready: number; // licznik: rośnie po zbudowaniu terenu, żeby warstwy zależne go przebudowały
  } | null>(null);
  const [ve, setVe] = useState(3);
  const [ready, setReady] = useState(0);
  const [tex, setTex] = useState<'loading' | 'ok' | 'none'>('loading');
  const [osm, setOsm] = useState<OsmScene | null>(null);
  const headings = useRef(new Map<string, { x: number; z: number; h: number }>());

  const origin = React.useMemo(() => toPL1992(center[0], center[1]), [center]);
  const h0 = React.useMemo(() => sheetHeight(terrain, origin.x, origin.y) ?? terrain.zeroM, [terrain, origin]);

  // ---- renderer ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const three = new THREE.Scene();
    three.background = new THREE.Color(0x09090b);
    three.fog = new THREE.Fog(0x09090b, 900, 2200);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(-260, 300, 340);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.enableDamping = true;
    three.add(new THREE.HemisphereLight(0xdde6ff, 0x1c1c22, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(-300, 500, 200);
    three.add(sun);
    const terrainG = new THREE.Group(), buildingsG = new THREE.Group(), dynG = new THREE.Group();
    three.add(terrainG, buildingsG, dynG);
    ctx.current = { three, camera, controls, terrainG, buildingsG, dynG, toLocal: () => ({ x: 0, z: 0 }), groundY: () => 0, ready: 0 };

    const resize = () => {
      const w = host.clientWidth || 800, h = host.clientHeight || 500;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    let raf = 0;
    const loop = () => { controls.update(); renderer.render(three, camera); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      [terrainG, buildingsG, dynG].forEach(clearGroup);
      renderer.dispose();
      host.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // ---- dane OSM (budynki, drogi) ----
  useEffect(() => {
    let off = false;
    loadOsmScene(center[0], center[1], radiusM).then((o) => !off && setOsm(o));
    return () => { off = true; };
  }, [center, radiusM]);

  // ---- teren z ASC: siatka rysowana TYLKO tam, gdzie są dane ----
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    let cancelled = false;
    const toLocal = (lat: number, lng: number) => {
      const p = toPL1992(lat, lng);
      return { x: p.x - origin.x, z: -(p.y - origin.y) };
    };
    const groundY = (lat: number, lng: number) => {
      const p = toPL1992(lat, lng);
      const h = sheetHeight(terrain, p.x, p.y);
      return h === null ? 0 : (h - h0) * ve;
    };
    c.toLocal = toLocal;
    c.groundY = groundY;
    clearGroup(c.terrainG);

    const R = radiusM * 1.15;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
    geo.rotateX(-Math.PI / 2); // północ = −Z
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const valid = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const h = sheetHeight(terrain, origin.x + pos.getX(i), origin.y - pos.getZ(i));
      valid[i] = h === null ? 0 : 1;
      pos.setY(i, h === null ? 0 : (h - h0) * ve);
    }
    const idx = geo.getIndex()!.array;
    const keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) if (valid[idx[i]] && valid[idx[i + 1]] && valid[idx[i + 2]]) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    geo.setIndex(keep);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f4a3f, roughness: 1, metalness: 0 });
    c.terrainG.add(new THREE.Mesh(geo, mat));

    setTex('loading');
    const corners = [fromPL1992(origin.x - R, origin.y + R), fromPL1992(origin.x + R, origin.y - R), fromPL1992(origin.x - R, origin.y - R), fromPL1992(origin.x + R, origin.y + R)];
    const lats = corners.map((p) => p.lat), lngs = corners.map((p) => p.lng);
    buildMapTexture({ n: Math.max(...lats), s: Math.min(...lats), w: Math.min(...lngs), e: Math.max(...lngs) }).then((r) => {
      if (cancelled) return;
      if (!r) return setTex('none');
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const ll = fromPL1992(origin.x + pos.getX(i), origin.y - pos.getZ(i));
        const [u, v] = r.toUV(ll.lat, ll.lng);
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
      mat.map = r.tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      setTex('ok');
    });

    // drogi z OSM przylegające do terenu
    if (osm) {
      const lm = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.4 });
      osm.roads.forEach((r) => {
        const pts = r.points.map((p) => { const l = toLocal(p[0], p[1]); return new THREE.Vector3(l.x, groundY(p[0], p[1]) + 0.3, l.z); });
        c.terrainG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm));
      });
    }
    setReady((n) => n + 1);
    return () => { cancelled = true; };
  }, [terrain, origin, h0, ve, radiusM, osm]);

  // ---- budynki: obiekty akcji (kolor wg ryzyka) + budynki z OSM ----
  useEffect(() => {
    const c = ctx.current;
    if (!c || !ready) return;
    clearGroup(c.buildingsG);
    const add = (poly: [number, number][], height: number, color: number, emissive = 0, edge = 0x18181b) => {
      const pts = poly.map((p) => c.toLocal(p[0], p[1]));
      if (pts.length < 3) return;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z))), { depth: height + 0.4, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const baseY = Math.min(...poly.map((p) => c.groundY(p[0], p[1]))) - 0.4;
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive, emissiveIntensity: emissive ? 0.3 : 0 }));
      m.position.y = baseY;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: edge }));
      e.position.y = baseY;
      c.buildingsG.add(m, e);
    };
    OFFLINE_FACILITY_BUILDINGS.forEach((b) => {
      const risk = buildingDecayRisks[b.id] ?? 0;
      const col = risk > 30 ? 0xef4444 : risk > 10 ? 0xf59e0b : 0x38bdf8;
      add(b.polygon, b.type === 'STORAGE' ? 6 : 10, col, risk > 10 ? col : 0, 0xe4e4e7);
    });
    osm?.buildings.forEach((b) => {
      const cen = centroidOf(b.polygon);
      if (OFFLINE_FACILITY_BUILDINGS.some((f) => isPointInPolygon(cen, f.polygon))) return; // nie dubluj obiektu akcji
      add(b.polygon, b.heightM, b.measured ? 0x9aa4b2 : 0x71717a);
    });
  }, [ready, osm, buildingDecayRisks]);

  // ---- warstwa dynamiczna: ogień, jednostki, drony, strefy ----
  useEffect(() => {
    const c = ctx.current;
    if (!c || !ready) return;
    clearGroup(c.dynG);
    const { toLocal, groundY } = c;

    if (activeLayers.fires !== false) {
      const burning = temperatureGrid.filter((x) => x.temperature >= 120 && !x.isExtinguished);
      const warm = temperatureGrid.filter((x) => x.temperature >= 60 && x.temperature < 120);
      if (burning.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.78 }), burning.length);
        const t = new THREE.Object3D(), col = new THREE.Color();
        burning.forEach((cell, i) => {
          const l = toLocal(cell.coords[0], cell.coords[1]);
          const w = Math.abs(cell.bounds[1][1] - cell.bounds[0][1]) * 111320 * Math.cos((cell.coords[0] * Math.PI) / 180) * 0.92;
          const d = Math.abs(cell.bounds[1][0] - cell.bounds[0][0]) * 110540 * 0.92;
          const h = 2 + Math.min(1, (cell.temperature - 120) / 700) * 16;
          t.position.set(l.x, groundY(cell.coords[0], cell.coords[1]) + h / 2, l.z);
          t.scale.set(w, h, d);
          t.updateMatrix();
          im.setMatrixAt(i, t.matrix);
          im.setColorAt(i, col.setHSL(0.02 + (1 - Math.min(1, cell.temperature / 800)) * 0.09, 1, 0.5));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        c.dynG.add(im);
      }
      if (warm.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.28 }), warm.length);
        const t = new THREE.Object3D();
        warm.forEach((cell, i) => {
          const l = toLocal(cell.coords[0], cell.coords[1]);
          t.position.set(l.x, groundY(cell.coords[0], cell.coords[1]) + 0.3, l.z);
          t.scale.set(10, 0.5, 10);
          t.updateMatrix();
          im.setMatrixAt(i, t.matrix);
        });
        c.dynG.add(im);
      }
    }

    zones.forEach((z) => {
      if (!z.polygon || z.polygon.length < 3) return;
      const color = z.isExtinguished ? 0x10b981 : new THREE.Color(z.color || '#ef4444').getHex();
      const pts = z.polygon.map((p) => { const l = toLocal(p[0], p[1]); return new THREE.Vector3(l.x, groundY(p[0], p[1]) + 1.2, l.z); });
      c.dynG.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)))), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      c.dynG.add(fill);
    });

    const alive = new Set<string>();
    markers.forEach((m) => {
      const l = toLocal(m.coords[0], m.coords[1]);
      const y = groundY(m.coords[0], m.coords[1]);
      if (m.type === 'FRIENDLY_UNIT') {
        if (activeLayers.friendlyUnits === false) return;
        alive.add(m.id);
        // kurs z faktycznego przemieszczenia (0 = północ); w postoju zostaje ostatni
        const prev = headings.current.get(m.id);
        let hd = prev?.h ?? 0;
        if (prev && Math.hypot(l.x - prev.x, l.z - prev.z) > 0.3) hd = Math.atan2(l.x - prev.x, -(l.z - prev.z));
        headings.current.set(m.id, { x: l.x, z: l.z, h: hd });
        const g = new THREE.Group();
        const mk = (w: number, h: number, d: number, color: number, px: number, py: number, pz: number, basic = false) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
          mesh.position.set(px, py, pz);
          g.add(mesh);
        };
        mk(2.6, 2.8, 8.5, 0xdc2626, 0, 1.9, 0); // nadwozie
        mk(2.6, 1.6, 2.4, 0xb91c1c, 0, 3.2, -3.2); // kabina z przodu (−Z)
        mk(2.65, 0.5, 8.55, 0xf5f5f5, 0, 1.5, 0);
        mk(1.8, 0.35, 0.6, m.unitStatus === 'ON_ROUTE' ? 0x3b82f6 : 0xef4444, 0, 4.2, -3.2, true);
        g.position.set(l.x, y, l.z);
        g.rotation.y = -hd;
        c.dynG.add(g);
        const lab = makeLabel(m.label, m.unitStatus === 'EXTINGUISHING' ? '#fb7185' : '#93c5fd');
        lab.position.set(l.x, y + 13, l.z);
        c.dynG.add(lab);
      } else if (m.type === 'KDR_STATION') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshStandardMaterial({ color: 0xeab308 }));
        b.position.set(l.x, y + 1.5, l.z);
        const lab = makeLabel('KDR', '#facc15');
        lab.position.set(l.x, y + 10, l.z);
        c.dynG.add(b, lab);
      } else if (m.type === 'HYDRANT') {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }));
        b.position.set(l.x, y + 0.7, l.z);
        c.dynG.add(b);
      } else if (m.type === 'VICTIM' || m.type === 'VICTIM_OUTSIDE') {
        const b = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 8), new THREE.MeshBasicMaterial({ color: 0xd946ef }));
        b.position.set(l.x, y + 6, l.z);
        b.rotation.x = Math.PI;
        c.dynG.add(b);
      }
    });
    headings.current.forEach((_, id) => { if (!alive.has(id)) headings.current.delete(id); });

    hotSwapStations.forEach((h) => {
      const l = toLocal(h.coords[0], h.coords[1]);
      const y = groundY(h.coords[0], h.coords[1]);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x166534 }));
      pad.position.set(l.x, y + 0.3, l.z);
      const lab = makeLabel('HOT-SWAP', '#4ade80');
      lab.position.set(l.x, y + 9, l.z);
      c.dynG.add(pad, lab);
    });

    if (activeLayers.drones !== false)
      drones.forEach((d) => {
        const l = toLocal(d.coords[0], d.coords[1]);
        const gy = groundY(d.coords[0], d.coords[1]);
        const y = gy + d.altitude;
        const color = d.battery < 25 ? 0xef4444 : 0x38bdf8;
        const g = new THREE.Group();
        const a1 = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 0.5), new THREE.MeshBasicMaterial({ color }));
        const a2 = a1.clone();
        a2.rotation.y = Math.PI / 2;
        g.add(a1, a2, new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), new THREE.MeshBasicMaterial({ color: 0xf4f4f5 })));
        g.position.set(l.x, y, l.z);
        const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(l.x, y, l.z), new THREE.Vector3(l.x, gy, l.z)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
        const lab = makeLabel(d.callsign, '#7dd3fc');
        lab.position.set(l.x, y + 7, l.z);
        c.dynG.add(g, tether, lab);
      });
  }, [ready, markers, drones, hotSwapStations, temperatureGrid, zones, activeLayers.fires, activeLayers.drones, activeLayers.friendlyUnits]);

  const setView = (top: boolean) => {
    const c = ctx.current;
    if (!c) return;
    c.controls.target.set(0, 0, 0);
    if (top) c.camera.position.set(0, 620, 1);
    else c.camera.position.set(-260, 300, 340);
  };

  return (
    <div className="relative w-full h-full bg-zinc-950">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute top-12 left-3 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 bg-zinc-950/90 border border-zinc-800 rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300">
          <button onClick={() => setView(false)} className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded cursor-pointer">Widok 3D</button>
          <button onClick={() => setView(true)} className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded cursor-pointer">Z góry</button>
          <label className="flex items-center gap-1.5 ml-1">
            Przewyższenie ×{ve}
            <input type="range" min={1} max={10} value={ve} onChange={(e) => setVe(Number(e.target.value))} className="w-20 accent-emerald-500" />
          </label>
        </div>
        <div className="pointer-events-auto max-w-[340px] bg-zinc-950/90 border border-zinc-800 rounded px-2 py-1.5 text-[10px] font-mono text-zinc-400 space-y-0.5">
          <div>Teren: <b className="text-emerald-400">NMT z ASC, {terrain.step} m</b></div>
          <div>Budynki: <b className={osm?.buildings.length ? 'text-amber-400' : 'text-zinc-500'}>{osm ? `OSM ${osm.buildings.length} (wys. częściowo domyślne)` : 'ładowanie…'}</b></div>
          <div>Podkład: <b className={tex === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>{tex === 'ok' ? 'mapa OSM' : tex === 'loading' ? 'ładowanie…' : 'brak (offline)'}</b></div>
        </div>
      </div>
    </div>
  );
}
