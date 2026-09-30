'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DroneTelemetry, FireCell, HotSwapStation, TacticalMarker, TacticalZone } from '@/types/tarcza';
import { OFFLINE_FACILITY_BUILDINGS, isPointInPolygon } from '@/lib/offline-maps-data';
import { fromPL1992, toPL1992 } from '@/lib/geo2180';
import { TerrainSheet, heightInSet } from '@/lib/terrain';
import { OsmBuilding, OsmScene, centroidOf, loadOsmScene } from '@/lib/osm-scene';
import { CLS_OTHER, CLS_ROOF, CLS_TREE, SurfaceMeshData, applyVerticalExaggeration, buildSurfaceMesh, hasMeshAt } from '@/lib/surface-mesh';

export interface Scene3DProps {
  terrain: TerrainSheet[]; // jeden lub kilka sąsiadujących arkuszy NMT
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

// ---------------------------------------------------------------------------
// Podkład: ortofotomapa Geoportalu (WMS, EPSG:2180 — pasuje 1:1 do siatki ASC), a gdy jej brak — kafle OSM,
// a gdy i tego brak (offline) — jednolity kolor (wtedy loadBaseTexture zwraca null).
// ---------------------------------------------------------------------------
type Box = { minX: number; maxX: number; minY: number; maxY: number }; // PL-1992
type UV = [number, number];
interface BaseTexture {
  tex: THREE.CanvasTexture;
  source: 'ortho' | 'osm' | 'none';
  uvAt: (fx: number, fz: number) => UV; // fx: 0 = zachód … 1 = wschód, fz: 0 = północ … 1 = południe (w obrębie Box)
}
// kolory obiektów, gdy nie ma zdjęcia (albo tryb „kolor”): dach, drzewo, inne, podstawa ściany
const COL_ROOF = new THREE.Color(0x8a6f62);
const COL_TREE = new THREE.Color(0x3d6b3a);
const COL_OTHER = new THREE.Color(0x8b929b);
const COL_WALL = new THREE.Color(0x6b6560);
const ORTO_WMS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

function finishTexture(canvas: HTMLCanvasElement, source: BaseTexture['source'], corners: [UV, UV, UV, UV]): BaseTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const uvAt = (fx: number, fz: number): UV => {
    const [nw, ne, sw, se] = corners;
    const u = (1 - fz) * ((1 - fx) * nw[0] + fx * ne[0]) + fz * ((1 - fx) * sw[0] + fx * se[0]);
    const v = (1 - fz) * ((1 - fx) * nw[1] + fx * ne[1]) + fz * ((1 - fx) * sw[1] + fx * se[1]);
    return [u, v];
  };
  return { tex, source, uvAt };
}

async function loadOrtho(box: Box, px: number): Promise<BaseTexture | null> {
  const url = `${ORTO_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Raster&STYLES=&SRS=EPSG:2180&BBOX=${box.minX},${box.minY},${box.maxX},${box.maxY}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/jpeg`;
  const img = await loadImage(`/api/tiles?url=${encodeURIComponent(url)}`);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvas.getContext('2d')!.drawImage(img, 0, 0, px, px);
  return finishTexture(canvas, 'ortho', [[0, 1], [1, 1], [0, 0], [1, 0]]);
}

async function loadOsmTiles(box: Box): Promise<BaseTexture | null> {
  const ll = (x: number, y: number) => fromPL1992(x, y);
  const nw = ll(box.minX, box.maxY), ne = ll(box.maxX, box.maxY), sw = ll(box.minX, box.minY), se = ll(box.maxX, box.minY);
  const lats = [nw.lat, ne.lat, sw.lat, se.lat], lngs = [nw.lng, ne.lng, sw.lng, se.lng];
  const a = tileXY(Math.max(...lats), Math.min(...lngs));
  const b = tileXY(Math.min(...lats), Math.max(...lngs));
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
        loadImage(`/api/tiles?url=${encodeURIComponent(`https://tile.openstreetmap.org/${TILE_Z}/${tx}/${ty}.png`)}`).then((img) => {
          if (img) {
            ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256);
            loaded++;
          }
        })
      );
  await Promise.all(jobs);
  if (!loaded) return null;
  ctx.fillStyle = 'rgba(9,9,11,0.28)'; // przyciemnienie pod ciemny interfejs
  ctx.fillRect(0, 0, W, H);
  const toUV = (p: { lat: number; lng: number }): UV => {
    const t = tileXY(p.lat, p.lng);
    return [((t.x - x0) * 256) / W, 1 - ((t.y - y0) * 256) / H];
  };
  return finishTexture(canvas, 'osm', [toUV(nw), toUV(ne), toUV(sw), toUV(se)]);
}

async function loadBaseTexture(box: Box, orthoPx: number): Promise<BaseTexture | null> {
  return (await loadOrtho(box, orthoPx)) ?? (await loadOsmTiles(box));
}

/** Obrysy budynków (lat/lng) → maska na siatce wierzchołków (1 = wewnątrz obrysu, z lekkim poszerzeniem o ~1 px). */
function rasterFootprints(polys: [number, number][][], toLocal: (lat: number, lng: number) => { x: number; z: number }, half: number, step: number, n: number): Uint8Array {
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  for (const poly of polys) {
    if (poly.length < 3) continue;
    g.beginPath();
    poly.forEach((p, i) => {
      const l = toLocal(p[0], p[1]);
      const px = (l.x + half) / step + 0.5, py = (l.z + half) / step + 0.5;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
    g.stroke();
  }
  const d = g.getImageData(0, 0, n, n).data;
  const m = new Uint8Array(n * n);
  for (let k = 0; k < m.length; k++) m[k] = d[k * 4] > 100 ? 1 : 0;
  return m;
}

/**
 * Dach dwuspadowy / czterospadowy / namiotowy dla prawie-prostokątnego obrysu (tylko gdy ktoś zmapował roof:shape w OSM).
 * Zwraca null, gdy obrys nie jest dość prostokątny — wtedy zostaje płaski dach.
 */
function pitchedRoofGeometry(pts: { x: number; z: number }[], shape: string, eaveY: number, roofH: number): THREE.BufferGeometry | null {
  if (pts.length < 3 || roofH < 0.3) return null;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p.x * q.z - q.x * p.z;
  }
  area = Math.abs(area / 2);
  let best: { ang: number; minU: number; maxU: number; minV: number; maxV: number; a: number } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ang = Math.atan2(q.z - p.z, q.x - p.x);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const r of pts) {
      const u = r.x * c + r.z * s, v = -r.x * s + r.z * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const a = (maxU - minU) * (maxV - minV);
    if (!best || a < best.a) best = { ang, minU, maxU, minV, maxV, a };
  }
  if (!best || area / best.a < 0.8) return null;
  const c = Math.cos(best.ang), s = Math.sin(best.ang);
  let eu = { x: c, z: s }, ev = { x: -s, z: c };
  let lenU = best.maxU - best.minU, lenV = best.maxV - best.minV;
  const cu = (best.minU + best.maxU) / 2, cv = (best.minV + best.maxV) / 2;
  const cx = eu.x * cu + ev.x * cv, cz = eu.z * cu + ev.z * cv;
  if (lenU < lenV) { [eu, ev] = [ev, { x: -eu.x, z: -eu.z }]; [lenU, lenV] = [lenV, lenU]; }
  const L = lenU / 2, W = lenV / 2;
  const P = (t: number, q: number, y: number) => new THREE.Vector3(cx + eu.x * t + ev.x * q, y, cz + eu.z * t + ev.z * q);
  const top = eaveY + roofH;
  const tri: THREE.Vector3[] = [];
  const hip = shape === 'hipped' && L - W > 0.3;
  if (shape === 'pyramidal' || (shape === 'hipped' && !hip)) {
    const apex = P(0, 0, top);
    const c1 = P(-L, -W, eaveY), c2 = P(L, -W, eaveY), c3 = P(L, W, eaveY), c4 = P(-L, W, eaveY);
    tri.push(c1, c2, apex, c2, c3, apex, c3, c4, apex, c4, c1, apex);
  } else if (hip) {
    const r1 = P(-(L - W), 0, top), r2 = P(L - W, 0, top);
    const c1 = P(-L, -W, eaveY), c2 = P(L, -W, eaveY), c3 = P(L, W, eaveY), c4 = P(-L, W, eaveY);
    tri.push(c1, c2, r2, c1, r2, r1, c3, c4, r1, c3, r1, r2, c4, c1, r1, c2, c3, r2);
  } else {
    const r1 = P(-L, 0, top), r2 = P(L, 0, top);
    const c1 = P(-L, -W, eaveY), c2 = P(L, -W, eaveY), c3 = P(L, W, eaveY), c4 = P(-L, W, eaveY);
    tri.push(c1, c2, r2, c1, r2, r1, c3, c4, r1, c3, r1, r2, c1, r1, c4, c2, c3, r2);
  }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}

const plSheets = (n: number) => (n === 1 ? 'arkusz' : n < 5 ? 'arkusze' : 'arkuszy');

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

/** Materiał dachów/ścian: zdjęcie lotnicze (jeśli jest) albo kolory wierzchołków. */
function applyRoofMode(m: THREE.MeshStandardMaterial, photo: THREE.Texture | null, mode: 'photo' | 'color') {
  const usePhoto = mode === 'photo' && !!photo;
  m.map = usePhoto ? photo : null;
  m.vertexColors = !usePhoto;
  m.color.set(0xffffff);
  m.needsUpdate = true;
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
  // NMT (kind 'ground') = sam teren; NMPT (kind 'surface') = dachy i korony drzew
  const surfaceSet = React.useMemo(() => terrain.filter((t) => t.kind === 'surface'), [terrain]);
  const groundOnly = React.useMemo(() => terrain.filter((t) => t.kind !== 'surface'), [terrain]);
  const groundSet = groundOnly.length ? groundOnly : surfaceSet; // bez NMT teren liczymy z NMPT (dachy zostają w terenie)

  const [ve, setVe] = useState(surfaceSet.length ? 1 : 3);
  const [ready, setReady] = useState(0);
  const [tex, setTex] = useState<'loading' | 'ortho' | 'osm' | 'none'>('loading');
  const [roofMode, setRoofMode] = useState<'photo' | 'color'>('photo');
  const [meshInfo, setMeshInfo] = useState<SurfaceMeshData['stats'] | null>(null);
  const [osm, setOsm] = useState<OsmScene | null>(null);
  const headings = useRef(new Map<string, { x: number; z: number; h: number }>());
  const fineRef = useRef<{ key: string; data: SurfaceMeshData; idx: Uint32Array; groundCount: number; colors: Float32Array } | null>(null);
  const fineMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const texCache = useRef(new Map<string, Promise<BaseTexture | null>>());
  const fineDataRef = useRef<SurfaceMeshData | null>(null);
  const roofModeRef = useRef<'photo' | 'color'>('photo');

  const origin = React.useMemo(() => toPL1992(center[0], center[1]), [center]);
  const h0 = React.useMemo(() => heightInSet(groundSet, origin.x, origin.y) ?? groundSet[0].zeroM, [groundSet, origin]);

  // z NMPT budynki mają prawdziwą wysokość — przewyższenie ×3 tylko by je zniekształciło, więc startujemy od ×1
  useEffect(() => {
    if (surfaceSet.length) setVe(1);
  }, [surfaceSet.length]);

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

  // ---- teren: gruby (NMT, cały obszar) + gęsty z prawdziwymi dachami (NMPT, okolica akcji) ----
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
      const h = heightInSet(groundSet, p.x, p.y);
      return h === null ? 0 : (h - h0) * ve;
    };
    c.toLocal = toLocal;
    c.groundY = groundY;
    clearGroup(c.terrainG);
    fineMatRef.current = null;

    const cachedTexture = (key: string, box: Box, px: number) => {
      let pr = texCache.current.get(key);
      if (!pr) {
        pr = loadBaseTexture(box, px);
        texCache.current.set(key, pr);
      }
      return pr;
    };

    const R = radiusM * 1.15;
    setTex('loading');

    // ---------- gęsta siatka z dachami (tylko gdy jest NMPT) ----------
    const fineHalf = Math.max(50, Math.min(300, Math.floor(R * 0.8)));
    let fine: SurfaceMeshData | null = null;
    if (surfaceSet.length) {
      const key = [surfaceSet.map((t) => t.id).join('|'), groundOnly.map((t) => t.id).join('|'), origin.x.toFixed(0), origin.y.toFixed(0), fineHalf, osm ? osm.buildings.length : -1].join('#');
      if (fineRef.current?.key !== key) {
        const n = 2 * fineHalf + 1;
        const polys: [number, number][][] = [...(osm?.buildings.map((b) => b.polygon) ?? []), ...OFFLINE_FACILITY_BUILDINGS.map((b) => b.polygon)];
        const mask = polys.length ? rasterFootprints(polys, toLocal, fineHalf, 1, n) : null;
        const data = buildSurfaceMesh({ ground: groundOnly, surface: surfaceSet, ox: origin.x, oy: origin.y, half: fineHalf, step: 1, h0, buildingMask: mask });
        // trójkąty terenu (wszystkie 3 wierzchołki = teren) idą do grupy 0 z teksturą, reszta (dachy + ściany) do grupy 1
        const I = data.indices;
        const gi: number[] = [];
        const oi: number[] = [];
        for (let t = 0; t < I.length; t += 3) {
          const target = data.cls[I[t]] || data.cls[I[t + 1]] || data.cls[I[t + 2]] ? oi : gi;
          target.push(I[t], I[t + 1], I[t + 2]);
        }
        const idx = new Uint32Array(gi.length + oi.length);
        idx.set(gi, 0);
        idx.set(oi, gi.length);
        const colors = new Float32Array(data.n * data.n * 3);
        for (let k = 0; k < data.n * data.n; k++) {
          const cl = data.cls[k];
          const col = cl === CLS_ROOF ? COL_ROOF : cl === CLS_TREE ? COL_TREE : cl === CLS_OTHER ? COL_OTHER : COL_WALL;
          colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
        }
        fineRef.current = { key, data, idx, groundCount: gi.length, colors };
      }
      fine = fineRef.current!.data;
      applyVerticalExaggeration(fine, ve);
      setMeshInfo(fine.stats);

      const fr = fineRef.current!;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(fine.positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(fr.colors, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(fine.n * fine.n * 2), 2));
      geo.setIndex(new THREE.BufferAttribute(fr.idx, 1));
      geo.addGroup(0, fr.groundCount, 0);
      geo.addGroup(fr.groundCount, fr.idx.length - fr.groundCount, 1);
      geo.computeVertexNormals();
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x3f4a3f, roughness: 1, metalness: 0 });
      const objMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
      fineMatRef.current = objMat;
      c.terrainG.add(new THREE.Mesh(geo, [groundMat, objMat]));

      const fbox: Box = { minX: origin.x - fineHalf, maxX: origin.x + fineHalf, minY: origin.y - fineHalf, maxY: origin.y + fineHalf };
      const fd = fine;
      cachedTexture(`fine|${fbox.minX.toFixed(0)}|${fbox.minY.toFixed(0)}|${fineHalf}`, fbox, 2048).then((bt) => {
        if (cancelled) return;
        if (!bt) return setTex('none');
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const n = fd.n;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const [u, v] = bt.uvAt(i / (n - 1), j / (n - 1));
            uv.setXY(j * n + i, u, v);
          }
        uv.needsUpdate = true;
        groundMat.map = bt.tex;
        groundMat.color.set(0xffffff);
        groundMat.needsUpdate = true;
        if (bt.source === 'ortho') {
          objMat.userData.photo = bt.tex;
        }
        setTex(bt.source);
        // dachy: zdjęcie lotnicze (prawdziwe kolory pokryć) albo jednolity kolor z cieniowaniem — patrz przełącznik
        applyRoofMode(objMat, bt.source === 'ortho' ? bt.tex : null, roofModeRef.current);
      });
    } else {
      fineRef.current = null;
      setMeshInfo(null);
    }
    fineDataRef.current = fine;

    // ---------- gruby teren (NMT) ----------
    const seg = 240;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
    geo.rotateX(-Math.PI / 2); // północ = −Z
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const valid = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const h = heightInSet(groundSet, origin.x + pos.getX(i), origin.y - pos.getZ(i));
      valid[i] = h === null ? 0 : 1;
      pos.setY(i, h === null ? 0 : (h - h0) * ve);
    }
    const idx = geo.getIndex()!.array;
    const keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], cc = idx[i + 2];
      if (!(valid[a] && valid[b] && valid[cc])) continue;
      if (fine) {
        // pod gęstą siatką z dachami gruby teren jest zbędny (i mógłby wystawać ponad nią)
        const mx = (pos.getX(a) + pos.getX(b) + pos.getX(cc)) / 3, mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(cc)) / 3;
        if (hasMeshAt(fine, mx, mz)) continue;
      }
      keep.push(a, b, cc);
    }
    geo.setIndex(keep);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f4a3f, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    c.terrainG.add(new THREE.Mesh(geo, mat));

    const cbox: Box = { minX: origin.x - R, maxX: origin.x + R, minY: origin.y - R, maxY: origin.y + R };
    cachedTexture(`coarse|${cbox.minX.toFixed(0)}|${cbox.minY.toFixed(0)}|${R.toFixed(0)}`, cbox, 2048).then((bt) => {
      if (cancelled || !bt) return;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const [u, v] = bt.uvAt((pos.getX(i) + R) / (2 * R), (pos.getZ(i) + R) / (2 * R));
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
      mat.map = bt.tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      if (!fine) setTex(bt.source);
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
  }, [groundSet, groundOnly, surfaceSet, origin, h0, ve, radiusM, osm]);

  // ---- przełącznik dachów: zdjęcie ↔ kolor (bez przebudowy siatki) ----
  useEffect(() => {
    roofModeRef.current = roofMode;
    const m = fineMatRef.current;
    if (m) applyRoofMode(m, (m.userData.photo as THREE.Texture | undefined) ?? null, roofMode);
  }, [roofMode]);

  // ---- budynki: obiekty akcji (kolor wg ryzyka) + budynki z OSM ----
  // Z NMPT dachy są już w siatce terenu (prawdziwy kształt i wysokość) — wtedy obiekty akcji to półprzezroczysta
  // nakładka z ryzykiem na prawdziwym budynku, a budynki OSM w zasięgu siatki nie są rysowane drugi raz.
  useEffect(() => {
    const c = ctx.current;
    if (!c || !ready) return;
    clearGroup(c.buildingsG);
    const fine = fineDataRef.current;

    // wysokość obiektu z nDSM (90. percentyl w obrysie) — albo null, gdy nie ma danych
    const measuredHeight = (poly: [number, number][]): number | null => {
      if (!surfaceSet.length || !groundOnly.length) return null;
      const lats = poly.map((p) => p[0]), lngs = poly.map((p) => p[1]);
      const vals: number[] = [];
      for (let i = 0; i <= 12; i++)
        for (let j = 0; j <= 12; j++) {
          const pt: [number, number] = [Math.min(...lats) + ((Math.max(...lats) - Math.min(...lats)) * i) / 12, Math.min(...lngs) + ((Math.max(...lngs) - Math.min(...lngs)) * j) / 12];
          if (!isPointInPolygon(pt, poly)) continue;
          const q = toPL1992(pt[0], pt[1]);
          const g = heightInSet(groundOnly, q.x, q.y), sf = heightInSet(surfaceSet, q.x, q.y);
          if (g !== null && sf !== null) vals.push(sf - g);
        }
      if (vals.length < 5) return null;
      vals.sort((x, y) => x - y);
      const v = vals[Math.floor(vals.length * 0.9)];
      return v >= 2 ? v : null;
    };

    const add = (poly: [number, number][], height: number, color: number, emissive = 0, edge = 0x18181b, opts: { roof?: { shape: string; h: number }; overlay?: boolean } = {}) => {
      const pts = poly.map((p) => c.toLocal(p[0], p[1]));
      if (pts.length < 3) return;
      const baseY = Math.min(...poly.map((p) => c.groundY(p[0], p[1]))) - 0.4;
      const wallH = opts.roof ? Math.max(2.5, height - opts.roof.h) : height;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z))), { depth: wallH + 0.4, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const matOpts: THREE.MeshStandardMaterialParameters = opts.overlay
        ? { color, roughness: 0.6, emissive, emissiveIntensity: emissive ? 0.35 : 0, transparent: true, opacity: 0.42, depthWrite: false }
        : { color, roughness: 0.85, emissive, emissiveIntensity: emissive ? 0.3 : 0 };
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(matOpts));
      m.position.y = baseY;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: edge }));
      e.position.y = baseY;
      c.buildingsG.add(m, e);
      if (opts.roof) {
        const rg = pitchedRoofGeometry(pts, opts.roof.shape, baseY + wallH + 0.4, opts.roof.h);
        if (rg) c.buildingsG.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x8a6f62, roughness: 0.9, side: THREE.DoubleSide })));
      }
    };

    OFFLINE_FACILITY_BUILDINGS.forEach((b) => {
      const risk = buildingDecayRisks[b.id] ?? 0;
      const col = risk > 30 ? 0xef4444 : risk > 10 ? 0xf59e0b : 0x38bdf8;
      const cen = centroidOf(b.polygon);
      const cl = c.toLocal(cen[0], cen[1]);
      const covered = !!fine && hasMeshAt(fine, cl.x, cl.z);
      if (covered) {
        const h = measuredHeight(b.polygon) ?? (b.type === 'STORAGE' ? 6 : 10);
        add(b.polygon, h, col, risk > 10 ? col : 0, 0xe4e4e7, { overlay: true });
      } else add(b.polygon, b.type === 'STORAGE' ? 6 : 10, col, risk > 10 ? col : 0, 0xe4e4e7);
    });
    osm?.buildings.forEach((b: OsmBuilding) => {
      const cen = centroidOf(b.polygon);
      if (OFFLINE_FACILITY_BUILDINGS.some((f) => isPointInPolygon(cen, f.polygon))) return; // nie dubluj obiektu akcji
      const l = c.toLocal(cen[0], cen[1]);
      if (fine && hasMeshAt(fine, l.x, l.z)) return; // dach z NMPT już jest w siatce
      const shape = b.roofShape;
      const pitched = shape === 'gabled' || shape === 'hipped' || shape === 'pyramidal';
      let roofH = b.roofH ?? 0;
      if (pitched && !roofH) roofH = 2.5; // zmapowany kształt dachu bez wysokości — skromny, ale nie płaski
      const total = b.heightTag ? b.heightM : b.heightM - 1.5 + (pitched ? roofH : 0);
      add(b.polygon, pitched ? total : b.heightM, b.measured ? 0x9aa4b2 : 0x71717a, 0, 0x18181b, pitched ? { roof: { shape: shape!, h: roofH } } : {});
    });
  }, [ready, osm, buildingDecayRisks, surfaceSet, groundOnly]);

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
          {surfaceSet.length > 0 && tex === 'ortho' && (
            <button onClick={() => setRoofMode((m) => (m === 'photo' ? 'color' : 'photo'))} className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded cursor-pointer">
              Dachy: {roofMode === 'photo' ? 'zdjęcie' : 'kolor'}
            </button>
          )}
          <label className="flex items-center gap-1.5 ml-1">
            Przewyższenie ×{ve}
            <input type="range" min={1} max={10} value={ve} onChange={(e) => setVe(Number(e.target.value))} className="w-20 accent-emerald-500" />
          </label>
        </div>
        <div className="pointer-events-auto max-w-[360px] bg-zinc-950/90 border border-zinc-800 rounded px-2 py-1.5 text-[10px] font-mono text-zinc-400 space-y-0.5">
          <div>Teren: <b className="text-emerald-400">{groundOnly.length ? `NMT: ${groundOnly.length} ${plSheets(groundOnly.length)}, ${Math.min(...groundOnly.map((t) => t.step))} m` : `z NMPT (brak NMT)`}</b></div>
          <div>
            Dachy:{' '}
            {surfaceSet.length ? (
              <b className="text-emerald-400">
                NMPT (LiDAR), {surfaceSet.length} {plSheets(surfaceSet.length)}
                {meshInfo?.separated ? ` · dachy ${meshInfo.roofVerts} pkt, drzewa ${meshInfo.treeVerts} pkt, maks. ${meshInfo.maxObjH.toFixed(0)} m` : ' · wgraj też NMT, by oddzielić budynki od terenu'}
              </b>
            ) : (
              <b className="text-amber-400">brak NMPT — budynki z OSM (płaskie dachy)</b>
            )}
          </div>
          {!surfaceSet.length && <div className="text-zinc-500">Sam NMT nie zawiera dachów. Wgraj NMPT (ASC) z Geoportalu.</div>}
          {!surfaceSet.length && <div>Budynki: <b className={osm?.buildings.length ? 'text-amber-400' : 'text-zinc-500'}>{osm ? `OSM ${osm.buildings.length} (wys. częściowo domyślne)` : 'ładowanie…'}</b></div>}
          <div>Podkład: <b className={tex === 'ortho' ? 'text-emerald-400' : 'text-amber-400'}>{tex === 'ortho' ? 'ortofotomapa Geoportal' : tex === 'osm' ? 'mapa OSM' : tex === 'loading' ? 'ładowanie…' : 'brak (offline)'}</b></div>
        </div>
      </div>
    </div>
  );
}
