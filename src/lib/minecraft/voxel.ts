import "server-only";
import type { Box } from "../mesh/parts";
import type { Soup } from "../mesh/scene";
import type { Segmentation } from "../mesh/segment";

export interface VoxelGrid {
  nx: number; ny: number; nz: number;
  /** dimensione voxel in metri */
  size: number;
  origin: [number, number, number];
  /** indice palette +1 (0 = vuoto) */
  cells: Uint16Array;
  /** etichetta (indice in labels) */
  part: Uint16Array;
  labels: string[];
  palette: [number, number, number, number][];
  filled: number;
}

/** Voxelizzazione di superficie con campionamento baricentrico dei triangoli. */
export function voxelize(soup: Soup, seg: Segmentation, voxelMeters: number, maxPalette: number, interior: Box[], interiorColorLabel = "interior"): VoxelGrid {
  const labels = [...seg.labels, interiorColorLabel];
  const interiorLabel = labels.length - 1;
  const { width: W, height: H, minZ, maxZ } = seg.dims;
  const s = voxelMeters;
  const origin: [number, number, number] = [-W / 2 - s, 0, minZ - s];
  const nx = Math.ceil((W + 2 * s) / s) + 1, ny = Math.ceil((H + s) / s) + 1, nz = Math.ceil((maxZ - minZ + 2 * s) / s) + 1;
  const N = nx * ny * nz;
  if (N > 60_000_000) throw new Error("Griglia voxel troppo grande");
  const sum = new Float32Array(N * 4);
  const hits = new Uint16Array(N);
  const votes = new Map<number, Map<number, number>>();
  const { pos, count, sampler } = soup;
  const col = [0, 0, 0, 0];
  const lin = (c: number) => c; // i colori texture sono già sRGB; la media in sRGB è sufficiente qui

  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const e1 = [pos[o + 3] - ax, pos[o + 4] - ay, pos[o + 5] - az];
    const e2 = [pos[o + 6] - ax, pos[o + 7] - ay, pos[o + 8] - az];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]), l2 = Math.hypot(e2[0], e2[1], e2[2]);
    const l3 = Math.hypot(e2[0] - e1[0], e2[1] - e1[1], e2[2] - e1[2]);
    const steps = Math.max(1, Math.ceil((Math.max(l1, l2, l3) / s) * 2));
    const lab = seg.tri[t];
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const a = i / steps, b = j / steps;
        const x = ax + e1[0] * a + e2[0] * b, y = ay + e1[1] * a + e2[1] * b, z = az + e1[2] * a + e2[2] * b;
        const ix = Math.floor((x - origin[0]) / s), iy = Math.floor((y - origin[1]) / s), iz = Math.floor((z - origin[2]) / s);
        if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) continue;
        const k = (iz * ny + iy) * nx + ix;
        sampler(t, a, b, col);
        sum[k * 4] += lin(col[0]); sum[k * 4 + 1] += lin(col[1]); sum[k * 4 + 2] += lin(col[2]); sum[k * 4 + 3] += col[3];
        if (hits[k] < 65535) hits[k]++;
        let v = votes.get(k);
        if (!v) votes.set(k, (v = new Map()));
        v.set(lab, (v.get(lab) ?? 0) + 1);
      }
    }
  }

  const part = new Uint16Array(N);
  const rgba: number[] = [];
  const idxs: number[] = [];
  for (let k = 0; k < N; k++) {
    if (!hits[k]) continue;
    const h = hits[k];
    let best = 0, bestN = -1;
    for (const [l, n] of votes.get(k)!) if (n > bestN) { best = l; bestN = n; }
    part[k] = best;
    const isGlass = labels[best] === "glass";
    rgba.push(sum[k * 4] / h, sum[k * 4 + 1] / h, sum[k * 4 + 2] / h, isGlass ? 0.55 : 1);
    idxs.push(k);
  }

  // abitacolo procedurale
  for (const b of interior) {
    const i0 = Math.floor((b.min[0] - origin[0]) / s), i1 = Math.ceil((b.max[0] - origin[0]) / s);
    const j0 = Math.floor((b.min[1] - origin[1]) / s), j1 = Math.ceil((b.max[1] - origin[1]) / s);
    const k0 = Math.floor((b.min[2] - origin[2]) / s), k1 = Math.ceil((b.max[2] - origin[2]) / s);
    for (let z = Math.max(0, k0); z < Math.min(nz, k1); z++)
      for (let y = Math.max(0, j0); y < Math.min(ny, j1); y++)
        for (let x = Math.max(0, i0); x < Math.min(nx, i1); x++) {
          const k = (z * ny + y) * nx + x;
          if (hits[k]) continue; // non sovrascrive la carrozzeria
          hits[k] = 1;
          part[k] = interiorLabel;
          rgba.push(b.color[0] / 255, b.color[1] / 255, b.color[2] / 255, 1);
          idxs.push(k);
        }
  }

  const { palette, assign } = quantize(rgba, maxPalette);
  const cells = new Uint16Array(N);
  idxs.forEach((k, i) => (cells[k] = assign[i] + 1));
  return { nx, ny, nz, size: s, origin, cells, part, labels, palette, filled: idxs.length };
}

/** Quantizzazione colori: median cut separato per opachi e trasparenti, poi k-means di rifinitura. */
function quantize(rgba: number[], maxColors: number) {
  const n = rgba.length / 4;
  const opaque: number[] = [], trans: number[] = [];
  for (let i = 0; i < n; i++) (rgba[i * 4 + 3] < 0.9 ? trans : opaque).push(i);
  const nTrans = trans.length ? Math.max(2, Math.round(maxColors * 0.12)) : 0;
  const palette: [number, number, number, number][] = [];
  const assign = new Int32Array(n);

  const run = (ids: number[], k: number, alpha: number) => {
    if (!ids.length) return;
    let boxes: number[][] = [ids];
    while (boxes.length < k) {
      let bi = -1, bestRange = 0, ch = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let c = 0; c < 3; c++) {
          let mn = 1, mx = 0;
          for (const id of b) { const v = rgba[id * 4 + c]; if (v < mn) mn = v; if (v > mx) mx = v; }
          const r = (mx - mn) * Math.sqrt(b.length);
          if (r > bestRange) { bestRange = r; bi = i; ch = c; }
        }
      });
      if (bi < 0 || bestRange < 1e-3) break;
      const b = boxes[bi].sort((a, c) => rgba[a * 4 + ch] - rgba[c * 4 + ch]);
      const mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    let centers = boxes.map((b) => {
      const c = [0, 0, 0];
      for (const id of b) for (let j = 0; j < 3; j++) c[j] += rgba[id * 4 + j];
      return c.map((x) => x / b.length);
    });
    for (let it = 0; it < 4; it++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (const id of ids) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const dr = rgba[id * 4] - centers[c][0], dg = rgba[id * 4 + 1] - centers[c][1], db = rgba[id * 4 + 2] - centers[c][2];
          const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
          if (d < bd) { bd = d; best = c; }
        }
        acc[best][0] += rgba[id * 4]; acc[best][1] += rgba[id * 4 + 1]; acc[best][2] += rgba[id * 4 + 2]; acc[best][3]++;
        assign[id] = best;
      }
      centers = acc.map((a, i) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : centers[i]));
    }
    const base = palette.length;
    centers.forEach((c) => palette.push([Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), Math.round(alpha * 255)]));
    for (const id of ids) assign[id] += base;
  };
  run(opaque, maxColors - nTrans, 1);
  run(trans, nTrans, 0.55);
  return { palette, assign };
}

export interface MergedBox { x: number; y: number; z: number; w: number; h: number; d: number; color: number; part: number }

/** Greedy meshing: unisce voxel adiacenti con stesso colore e stessa parte in parallelepipedi. */
export function greedyBoxes(g: VoxelGrid): MergedBox[] {
  const { nx, ny, nz, cells, part } = g;
  const used = new Uint8Array(cells.length);
  const id = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  const out: MergedBox[] = [];
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const k = id(x, y, z);
        if (!cells[k] || used[k]) continue;
        const c = cells[k], p = part[k];
        const same = (i: number) => cells[i] === c && part[i] === p && !used[i];
        let w = 1;
        while (x + w < nx && same(id(x + w, y, z))) w++;
        let h = 1;
        outer: while (y + h < ny) {
          for (let i = 0; i < w; i++) if (!same(id(x + i, y + h, z))) break outer;
          h++;
        }
        let d = 1;
        outer2: while (z + d < nz) {
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!same(id(x + i, y + j, z + d))) break outer2;
          d++;
        }
        for (let dz = 0; dz < d; dz++) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[id(x + dx, y + dy, z + dz)] = 1;
        out.push({ x, y, z, w, h, d, color: c - 1, part: p });
      }
  return out;
}
