import "server-only";
import type { Soup } from "./scene";

export const PARTS = ["body", "glass", "light_front", "light_rear", "door_left", "door_right", "wheel"] as const;
export type PartKind = (typeof PARTS)[number];

export interface Wheel {
  name: string; // es. wheel_1_l
  axle: number;
  side: "l" | "r";
  center: [number, number, number];
  radius: number;
  width: number;
}

export interface Segmentation {
  /** per triangolo: indice in `labels` */
  tri: Uint16Array;
  labels: string[];
  wheels: Wheel[];
  frontDetected: "lights" | "assumed";
  flipSuggested: boolean;
  dims: { length: number; width: number; height: number; minZ: number; maxZ: number; maxY: number };
  stats: Record<string, number>;
  beltline: number;
  /** solo veicoli cingolati */
  tracked?: { hullFrontZ: number; barrelLength: number; turretY: number; trackY: number; deckY: number };
}

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max, s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

const isRed = (r: number, g: number, b: number) => { const c = hsv(r, g, b); return (c.h < 20 || c.h > 340) && c.s > 0.5 && c.v > 0.35; };
const isBright = (r: number, g: number, b: number) => { const c = hsv(r, g, b); return c.v > 0.82 && c.s < 0.25; };
const isGlassy = (r: number, g: number, b: number, a: number) => {
  const c = hsv(r, g, b);
  return a < 0.9 || (c.v < 0.33 && c.s < 0.45) || (c.h > 180 && c.h < 250 && c.v < 0.5 && c.s < 0.6);
};

function triArea(p: Float32Array, i: number) {
  const o = i * 9;
  const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
  const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}

/**
 * Segmentazione euristica in spazio canonico (Y su, lunghezza Z, anteriore +Z, centro X=0, suolo Y=0).
 */
export function segment(soup: Soup, opts: { category?: string } = {}): Segmentation {
  if (opts.category === "carro_armato") return segmentTracked(soup);
  const { pos, color, count } = soup;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  const cen = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    for (let c = 0; c < 3; c++) {
      const x = pos[o + c * 3], y = pos[o + c * 3 + 1], z = pos[o + c * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (y > maxY) maxY = y;
    }
    cen[i * 3] = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    cen[i * 3 + 1] = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    cen[i * 3 + 2] = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
  }
  const L = maxZ - minZ, W = maxX - minX, H = maxY;
  const halfW = W / 2;

  /* -------- anteriore/posteriore: le luci rosse indicano il retro -------- */
  let redFront = 0, redRear = 0, whiteFront = 0, whiteRear = 0;
  for (let i = 0; i < count; i++) {
    const z = cen[i * 3 + 2], y = cen[i * 3 + 1];
    if (y < 0.2 * H || y > 0.8 * H) continue;
    const a = triArea(pos, i);
    const r = color[i * 4], g = color[i * 4 + 1], b = color[i * 4 + 2];
    if (z > maxZ - 0.1 * L) { if (isRed(r, g, b)) redFront += a; if (isBright(r, g, b)) whiteFront += a; }
    if (z < minZ + 0.1 * L) { if (isRed(r, g, b)) redRear += a; if (isBright(r, g, b)) whiteRear += a; }
  }
  const scoreFrontIsFront = (redRear - redFront) + 0.3 * (whiteFront - whiteRear);
  const signal = Math.abs(redRear - redFront) + Math.abs(whiteFront - whiteRear);
  const frontDetected = signal > 1e-4 * L * H ? "lights" : "assumed";
  const flipSuggested = frontDetected === "lights" && scoreFrontIsFront < 0;

  /* -------- ruote: gruppi di contatto col suolo lungo Z -------- */
  const groundH = Math.max(0.06 * H, 0.03);
  const bins = 100;
  const occ = new Float32Array(bins);
  const xs: number[][] = Array.from({ length: bins }, () => []);
  for (let i = 0; i < count; i++) {
    if (cen[i * 3 + 1] > groundH) continue;
    if (Math.abs(cen[i * 3]) < 0.2 * halfW) continue; // ignora il sottoscocca centrale
    const k = Math.min(bins - 1, Math.floor(((cen[i * 3 + 2] - minZ) / L) * bins));
    occ[k] += triArea(pos, i);
    xs[k].push(cen[i * 3]);
  }
  const thr = Math.max(...occ) * 0.08;
  const clusters: { a: number; b: number }[] = [];
  for (let k = 0; k < bins; k++) {
    if (occ[k] <= thr) continue;
    const last = clusters[clusters.length - 1];
    if (last && k - last.b <= 2) last.b = k; else clusters.push({ a: k, b: k });
  }
  const wheels: Wheel[] = [];
  const axles = clusters
    .map((c) => {
      const z0 = minZ + (c.a / bins) * L, z1 = minZ + ((c.b + 1) / bins) * L;
      const chord = (z1 - z0) / 2;
      // raggio dal profilo di contatto: r = (c² + h²) / 2h, limitato a valori plausibili
      let r = (chord * chord + groundH * groundH) / (2 * groundH);
      r = Math.min(Math.max(r, 0.12 * H), 0.3 * H);
      return { zc: (z0 + z1) / 2, r, span: z1 - z0 };
    })
    .filter((a) => a.span < 0.35 * L)
    .sort((a, b) => b.zc - a.zc); // dall'anteriore al posteriore
  const wheelWidth = Math.min(0.32 * halfW * 2, 0.6);
  axles.forEach((ax, i) => {
    for (const side of ["l", "r"] as const) {
      const sx = side === "l" ? 1 : -1; // glTF: +X = sinistra del veicolo quando guarda verso +Z
      wheels.push({ name: `wheel_${i + 1}_${side}`, axle: i + 1, side, center: [sx * (halfW - wheelWidth / 2), ax.r, ax.zc], radius: ax.r, width: wheelWidth });
    }
  });

  /* -------- classificazione triangoli -------- */
  const labels: string[] = ["body", "glass", "light_front", "light_rear", "door_left", "door_right", ...wheels.map((w) => w.name)];
  const L_BODY = 0, L_GLASS = 1, L_LF = 2, L_LR = 3, L_DL = 4, L_DR = 5;
  const tri = new Uint16Array(count);
  const beltline = (opts.category === "autobus" || opts.category === "camion" ? 0.45 : 0.55) * H;
  const frontZ = maxZ, rearZ = minZ;
  const front = axles[0], rear = axles[axles.length - 1];
  const doorZ0 = rear ? rear.zc + rear.r * 1.15 : minZ + 0.3 * L;
  const doorZ1 = front ? front.zc - front.r * 1.15 : maxZ - 0.3 * L;
  const stats: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const x = cen[i * 3], y = cen[i * 3 + 1], z = cen[i * 3 + 2];
    const r = color[i * 4], g = color[i * 4 + 1], b = color[i * 4 + 2], a = color[i * 4 + 3];
    let lab = L_BODY;
    // ruote
    for (let w = 0; w < wheels.length; w++) {
      const wh = wheels[w];
      const dy = y - wh.center[1], dz = z - wh.center[2];
      if (dy * dy + dz * dz <= wh.radius * wh.radius * 1.1 && Math.sign(x) === Math.sign(wh.center[0]) && Math.abs(x) > halfW - wh.width * 1.1) {
        lab = 6 + w;
        break;
      }
    }
    if (lab === L_BODY) {
      if (y > beltline && isGlassy(r, g, b, a)) lab = L_GLASS;
      else if (z > frontZ - 0.08 * L && y > 0.2 * H && y < 0.75 * H && (isBright(r, g, b) || (hsv(r, g, b).h > 20 && hsv(r, g, b).h < 50 && hsv(r, g, b).s > 0.6))) lab = L_LF;
      else if (z < rearZ + 0.08 * L && y > 0.2 * H && y < 0.85 * H && isRed(r, g, b)) lab = L_LR;
      else if (Math.abs(x) > 0.8 * halfW && z > doorZ0 && z < doorZ1 && y > 0.12 * H && y < beltline + 0.05 * H && doorZ1 > doorZ0) lab = x > 0 ? L_DL : L_DR;
    }
    tri[i] = lab;
    stats[labels[lab]] = (stats[labels[lab]] ?? 0) + 1;
  }
  return { tri, labels, wheels, frontDetected, flipSuggested, dims: { length: L, width: W, height: H, minZ, maxZ, maxY }, stats, beltline };
}

/**
 * Veicoli cingolati (carri armati): cingoli sinistro/destro, torretta, cannone, scafo.
 * Spazio canonico: anteriore +Z, sinistra +X, suolo Y=0.
 */
export function segmentTracked(soup: Soup): Segmentation {
  const { pos, count } = soup;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  const cen = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    for (let c = 0; c < 3; c++) {
      const x = pos[o + c * 3], y = pos[o + c * 3 + 1], z = pos[o + c * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; if (y > maxY) maxY = y;
    }
    for (let k = 0; k < 3; k++) cen[i * 3 + k] = (pos[o + k] + pos[o + 3 + k] + pos[o + 6 + k]) / 3;
  }
  const H = maxY, halfW = (maxX - minX) / 2;
  // profilo dell'altezza lungo Z: il cannone sporge davanti allo scafo a quota elevata e sottile
  const bins = 60, top = new Float32Array(bins), low = new Float32Array(bins).fill(Infinity), wid = new Float32Array(bins);
  const zb = (z: number) => Math.min(bins - 1, Math.max(0, Math.floor(((z - minZ) / (maxZ - minZ)) * bins)));
  // ogni triangolo contribuisce a tutte le sezioni che attraversa (robusto anche per mesh low-poly)
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const zs = [pos[o + 2], pos[o + 5], pos[o + 8]], ys = [pos[o + 1], pos[o + 4], pos[o + 7]], xs = [pos[o], pos[o + 3], pos[o + 6]];
    const b0 = zb(Math.min(...zs)), b1 = zb(Math.max(...zs));
    const ty = Math.max(...ys), ly = Math.min(...ys), wx = Math.max(...xs.map(Math.abs));
    for (let b = b0; b <= b1; b++) {
      top[b] = Math.max(top[b], ty);
      low[b] = Math.min(low[b], ly);
      wid[b] = Math.max(wid[b], wx);
    }
  }
  // scafo: bin con larghezza > 60% della larghezza massima; il cannone è oltre l'estremità anteriore dello scafo
  let hullFrontBin = bins - 1;
  while (hullFrontBin > 0 && wid[hullFrontBin] < 0.6 * halfW) hullFrontBin--;
  const hullFrontZ = minZ + ((hullFrontBin + 1) / bins) * (maxZ - minZ);
  const barrelLen = maxZ - hullFrontZ;
  let hullRearBin = 0;
  while (hullRearBin < bins - 1 && wid[hullRearBin] < 0.6 * halfW) hullRearBin++;
  const rearProtrusion = minZ + (hullRearBin / bins) * (maxZ - minZ) - minZ;
  // quota della torretta: sopra il ponte dello scafo (mediana dell'altezza massima per bin dello scafo, scontata)
  const hullTops = Array.from(top.slice(0, hullFrontBin + 1)).sort((a, b) => a - b);
  const deck = hullTops[Math.floor(hullTops.length * 0.35)] ?? H * 0.6;
  const turretY = Math.min(deck + 0.05 * H, H * 0.75);
  const trackY = Math.min(0.45 * H, deck * 0.8);
  const barrelY = barrelLen > 0.3 ? (top[bins - 1] + low[bins - 1]) / 2 : turretY;
  const labels = ["body", "turret", "barrel", "track_l", "track_r", "glass", "light_front", "light_rear"];
  const tri = new Uint16Array(count);
  const stats: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const x = cen[i * 3], y = cen[i * 3 + 1], z = cen[i * 3 + 2];
    let lab = 0;
    if (barrelLen > 0.3 && z > hullFrontZ && Math.abs(x) < 0.3 * halfW && Math.abs(y - barrelY) < 0.12 * H) lab = 2;
    else if (y < trackY && Math.abs(x) > 0.55 * halfW) lab = x > 0 ? 3 : 4;
    else if (y > turretY && Math.abs(x) < 0.85 * halfW) lab = 1;
    tri[i] = lab;
    stats[labels[lab]] = (stats[labels[lab]] ?? 0) + 1;
  }
  return {
    tri, labels, wheels: [], frontDetected: barrelLen > 0.3 || rearProtrusion > 0.3 ? "lights" : "assumed",
    // per i carri armati il cannone indica il fronte: se sporge dietro, il modello va girato
    flipSuggested: rearProtrusion > 0.3 && rearProtrusion > barrelLen * 1.5,
    dims: { length: maxZ - minZ, width: maxX - minX, height: H, minZ, maxZ, maxY },
    stats, beltline: turretY,
    tracked: { hullFrontZ, barrelLength: barrelLen, turretY, trackY, deckY: deck },
  } as Segmentation;
}
