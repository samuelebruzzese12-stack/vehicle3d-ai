/**
 * Generatore procedurale di mimetiche (algoritmo originale, nessun vincolo di licenza).
 * Rumore a valori su più ottave → soglie → palette. Isomorfo: restituisce RGBA grezzo.
 */
export type CamoKind = "woodland" | "deserto" | "digitale" | "invernale" | "verde_nato";

export const CAMO_PALETTES: Record<CamoKind, [number, number, number][]> = {
  woodland: [[79, 88, 54], [42, 49, 34], [116, 98, 66], [20, 20, 18]],
  deserto: [[196, 172, 128], [168, 136, 94], [128, 100, 68], [214, 196, 160]],
  digitale: [[94, 100, 74], [62, 70, 52], [132, 124, 96], [34, 38, 30]],
  invernale: [[230, 232, 234], [186, 190, 194], [120, 126, 132], [70, 74, 78]],
  verde_nato: [[73, 82, 52], [73, 82, 52], [44, 44, 36], [92, 74, 52]],
};

function hash(x: number, y: number, seed: number) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, seed: number) {
  let s = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { s += amp * smooth(x * f, y * f, seed + o * 17); amp *= 0.5; f *= 2; }
  return s / 0.9375;
}

/** Colore della mimetica nel punto (u, v) espresso in metri sulla superficie. */
export function camoColor(kind: CamoKind, u: number, v: number, seed = 7): [number, number, number] {
  const pal = CAMO_PALETTES[kind];
  const scale = kind === "digitale" ? 1 : 0.9;
  let x = u * scale, y = v * scale;
  if (kind === "digitale") { x = Math.floor(x * 8) / 8; y = Math.floor(y * 8) / 8; }
  const n1 = fbm(x, y, seed), n2 = fbm(x + 31.7, y - 12.3, seed + 99);
  if (kind === "verde_nato") return n1 > 0.62 ? pal[2] : n2 > 0.64 ? pal[3] : pal[0];
  if (n1 > 0.64) return pal[3];
  if (n1 > 0.52) return pal[1];
  if (n2 > 0.55) return pal[2];
  return pal[0];
}

/** Texture RGBA (per GLB) di dimensione size×size che rappresenta `meters` metri di superficie. */
export function camoTexture(kind: CamoKind, size = 512, meters = 4): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = camoColor(kind, (x / size) * meters, (y / size) * meters);
    out.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
  }
  return out;
}
