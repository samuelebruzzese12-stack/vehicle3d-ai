// Proiezioni ortografiche (lato, fronte, alto) di una geometria Bedrock, con colori dalla texture palette.
import { readFileSync } from "node:fs";
import sharp from "sharp";
const [geoPath, texPath, out] = process.argv.slice(2);
const geo = JSON.parse(readFileSync(geoPath, "utf8"))["minecraft:geometry"][0];
const tex = await sharp(readFileSync(texPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const col = (u: number, v: number) => { const i = (v * tex.info.width + u) * 4; return [tex.data[i], tex.data[i + 1], tex.data[i + 2]]; };
const cubes: { o: number[]; s: number[]; c: number[]; bone: string }[] = [];
for (const b of geo.bones) for (const c of b.cubes ?? []) cubes.push({ o: c.origin, s: c.size, c: col(c.uv.north.uv[0], c.uv.north.uv[1]), bone: b.name });
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const c of cubes) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c.o[k]); mx[k] = Math.max(mx[k], c.o[k] + c.s[k]); }
const S = 4;
// view: axes (u,v) and depth axis + direction (pick nearest)
function view(ua: number, va: number, da: number, dir: number, flipU: boolean, bone?: string) {
  const W = Math.ceil(mx[ua] - mn[ua]) * S + 2, H = Math.ceil(mx[va] - mn[va]) * S + 2;
  const img = Buffer.alloc(W * H * 3, 235); const depth = new Float32Array(W * H).fill(-1e9);
  for (const c of cubes) {
    const d = dir > 0 ? c.o[da] + c.s[da] : -(c.o[da]);
    const shade = bone && c.bone !== bone ? null : c.c;
    for (let u = Math.floor((c.o[ua] - mn[ua]) * S); u < Math.ceil((c.o[ua] + c.s[ua] - mn[ua]) * S); u++)
      for (let v = Math.floor((c.o[va] - mn[va]) * S); v < Math.ceil((c.o[va] + c.s[va] - mn[va]) * S); v++) {
        const x = flipU ? W - 1 - u : u, y = H - 1 - v; const i = y * W + x;
        if (d > depth[i]) { depth[i] = d; const cc = shade ?? [200, 200, 200]; img.set(cc, i * 3); }
      }
  }
  return { img, W, H };
}
const views = [view(2, 1, 0, 1, false), view(0, 1, 2, -1, false), view(2, 0, 1, 1, false)];
const pad = 10; const W = Math.max(...views.map((v) => v.W)) + 2 * pad; const H = views.reduce((a, v) => a + v.H + pad, pad);
const comp = await Promise.all(views.map(async (v) => sharp(v.img, { raw: { width: v.W, height: v.H, channels: 3 } }).png().toBuffer()));
let y = pad; const layers = comp.map((b, i) => { const l = { input: b, left: pad, top: y }; y += views[i].H + pad; return l; });
await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(layers).png().toFile(out);
console.log("cubi", cubes.length, "bones", [...new Set(cubes.map((c) => c.bone))].join(","), "bbox px", mn, mx);
