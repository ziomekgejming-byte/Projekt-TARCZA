#!/usr/bin/env python3
"""
Zamienia pliki ASC (Geoportal, NMT w PL-1992) na kompaktowe arkusze dla widoku 3D.

  python scripts/build-scene.py plik1.asc [plik2.asc ...] [--decimate K] [--kind ground|surface]

Zapisuje public/scene/<id>.bin (Int16 LE, (wysokość - zeroM) * scale, brak danych = -32768)
i dopisuje arkusz do public/scene/manifest.json. Format zgodny z lib/asc.ts / lib/terrain.ts.

Typ arkusza:
  ground  = NMT  (sam teren)                        → id kończy się na -NMT
  surface = NMPT (dachy i korony drzew — LiDAR)     → id kończy się na -NMPT
Bez --kind typ jest zgadywany z nazwy pliku (NMPT/DSM → surface, NMT/DTM → ground). Domyślnie ground.
Dachy w widoku 3D pochodzą WYŁĄCZNIE z arkuszy typu surface — sam NMT ich nie zawiera.
Domyślny --decimate dobiera krok siatki ≥ 1 m (0,5 m → 2, 1 m → 1).
"""
import json, os, re, sys
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'scene')
NODATA16 = -32768


def read_asc(path):
    hdr = {}
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for _ in range(12):
            pos = f.tell()
            line = f.readline()
            m = re.match(r'^\s*([A-Za-z_]+)\s+([-+0-9.eE,]+)\s*$', line)
            if not m:
                f.seek(pos)
                break
            hdr[m.group(1).lower()] = float(m.group(2).replace(',', '.'))
        ncols, nrows, cs = int(hdr['ncols']), int(hdr['nrows']), hdr['cellsize']
        nodata = hdr.get('nodata_value', -9999)
        xll = hdr['xllcenter'] if 'xllcenter' in hdr else hdr['xllcorner'] + cs / 2
        yll = hdr['yllcenter'] if 'yllcenter' in hdr else hdr['yllcorner'] + cs / 2
        a = np.fromstring(f.read(), dtype=np.float64, sep=' ')
    if a.size < ncols * nrows:
        sys.exit(f'{path}: plik ucięty ({a.size} z {ncols*nrows})')
    a = a[: ncols * nrows].reshape(nrows, ncols)
    a[a == nodata] = np.nan
    if yll > 1e6 or not (0 < xll < 1e6):
        sys.exit(f'{path}: to nie wygląda na PL-1992 (EPSG:2180)')
    return a, ncols, nrows, cs, xll, yll


def detect_kind(name):
    n = os.path.basename(name).lower()
    if re.search(r'nmpt|npmt|dsm|pokryci|surface|ndsm', n):
        return 'surface'
    if re.search(r'(^|[^a-z])nmt([^a-z]|$)|dtm|teren|ground|bare', n):
        return 'ground'
    return None


def decimate(a, k):
    if k == 1:
        return a
    nr, nc = a.shape
    pr, pc = (-nr) % k, (-nc) % k
    a = np.pad(a, ((0, pr), (0, pc)), constant_values=np.nan)
    b = a.reshape(a.shape[0] // k, k, a.shape[1] // k, k)
    valid = ~np.isnan(b)
    cnt = valid.sum(axis=(1, 3))
    s = np.where(valid, b, 0).sum(axis=(1, 3))
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(cnt > 0, s / cnt, np.nan)


def main():
    args = sys.argv[1:]
    k = None
    kind_arg = None
    if '--decimate' in args:
        i = args.index('--decimate'); k = int(args[i + 1]); del args[i:i + 2]
    if '--kind' in args:
        i = args.index('--kind'); kind_arg = args[i + 1]; del args[i:i + 2]
        if kind_arg not in ('ground', 'surface'):
            sys.exit('--kind: ground albo surface')
    if not args:
        sys.exit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    mp = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mp)) if os.path.exists(mp) else {'sheets': []}
    for path in args:
        base = re.sub(r'(?i)[-_](NMT|NMPT)$', '', os.path.splitext(os.path.basename(path))[0])
        kind = kind_arg or detect_kind(path) or 'ground'
        sid = f"{base}-{'NMPT' if kind == 'surface' else 'NMT'}"
        a, ncols, nrows, cs, xll, yll = read_asc(path)
        kk = k if k else max(1, int(np.ceil(0.99 / cs)))
        vmin, vmax = float(np.nanmin(a)), float(np.nanmax(a))
        nodata_frac = float(np.isnan(a).mean())
        d = decimate(a, kk)
        step = cs * kk
        scale = 100 if vmax - vmin < 300 else 10 if vmax - vmin < 3000 else 1
        zero = int(np.floor(vmin))
        q = np.where(np.isnan(d), NODATA16, np.round((d - zero) * scale)).astype('<i2')
        shift = (kk - 1) / 2 * cs
        x0 = xll + shift
        y0 = yll + (nrows - 1) * cs - shift
        nr, nc = q.shape
        fn = f'{sid}.bin'
        q.tofile(os.path.join(OUT, fn))
        entry = dict(id=sid, name=sid, kind=kind, file=fn, step=step, ncols=nc, nrows=nr, zeroM=zero, scale=scale,
                     x0=x0, y0=y0, minX=x0, maxX=x0 + (nc - 1) * step, minY=y0 - (nr - 1) * step, maxY=y0)
        man['sheets'] = [s for s in man['sheets'] if s['id'] != sid] + [entry]
        print(f'{sid} [{kind}]: {ncols}x{nrows} @ {cs} m -> {nc}x{nr} @ {step} m, {vmin:.2f}..{vmax:.2f} m, '
              f'brak danych {nodata_frac*100:.1f}%, {q.nbytes/1e6:.1f} MB')
    json.dump(man, open(mp, 'w'), indent=1)


if __name__ == '__main__':
    main()
