import "server-only";
import { type Document, type Primitive, type Texture } from "@gltf-transform/core";
import { KHRDracoMeshCompression, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { clearNodeTransform, dedup, flatten, prune, simplify, textureCompress, weld, unpartition } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { AppError } from "../errors";

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export function triangleCount(doc: Document) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const idx = p.getIndices();
      const pos = p.getAttribute("POSITION");
      n += Math.floor((idx ? idx.getCount() : pos?.getCount() ?? 0) / 3);
    }
  }
  return n;
}

/** Bounds dei vertici dopo aver incorporato le trasformazioni (le mesh sono già in spazio mondo). */
export function computeBounds(doc: Document): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) {
          if (v[k] < min[k]) min[k] = v[k];
          if (v[k] > max[k]) max[k] = v[k];
        }
      }
    }
  }
  return { min, max };
}

function transformPositions(doc: Document, fn: (v: number[]) => void, normalFn?: (n: number[]) => void) {
  const seen = new Set<unknown>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      for (const [sem, f] of [["POSITION", fn], ["NORMAL", normalFn]] as const) {
        const acc = p.getAttribute(sem);
        if (!acc || !f || seen.has(acc)) continue;
        seen.add(acc);
        const v = [0, 0, 0];
        for (let i = 0; i < acc.getCount(); i++) {
          acc.getElement(i, v);
          f(v);
          acc.setElement(i, v);
        }
      }
      const tan = p.getAttribute("TANGENT");
      if (tan && normalFn && !seen.has(tan)) {
        seen.add(tan);
        const v = [0, 0, 0, 0];
        for (let i = 0; i < tan.getCount(); i++) {
          tan.getElement(i, v);
          const t = [v[0], v[1], v[2]];
          normalFn(t);
          tan.setElement(i, [t[0], t[1], t[2], v[3]]);
        }
      }
    }
  }
}

/** Ruota il modello di 180° attorno a Y (inverte anteriore e posteriore). */
export function rotate180(doc: Document) {
  transformPositions(doc, (v) => { v[0] = -v[0]; v[2] = -v[2]; }, (n) => { n[0] = -n[0]; n[2] = -n[2]; });
}

export interface NormalizeOptions {
  /** lunghezza reale in metri (se nota) */
  targetLength?: number;
  /** ruota di 180° (inverte anteriore/posteriore) */
  flipFront?: boolean;
}

export interface NormalizeReport {
  originalBounds: Bounds;
  rotatedUpAxis: boolean;
  rotatedLengthAxis: boolean;
  scale: number;
  dimensions: { length: number; width: number; height: number };
}

/**
 * Porta il modello in un sistema canonico:
 *  Y in alto, lunghezza lungo Z, anteriore verso +Z (convenzione glTF), centro in X/Z = 0, ruote a Y = 0, unità = metri.
 */
export async function normalize(doc: Document, opts: NormalizeOptions = {}): Promise<NormalizeReport> {
  // decomprime e rimuove estensioni di compressione: lavoriamo su dati grezzi
  doc.getRoot().listExtensionsUsed().forEach((e) => {
    if (e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME || e.extensionName === EXTMeshoptCompression.EXTENSION_NAME) e.dispose();
  });
  await doc.transform(flatten(), unpartition());
  for (const node of doc.getRoot().listNodes()) clearNodeTransform(node);
  // eventuali nodi skinned/animati non sono supportati: rimuoviamo animazioni
  doc.getRoot().listAnimations().forEach((a) => a.dispose());
  doc.getRoot().listSkins().forEach((s) => s.dispose());

  const tris = triangleCount(doc);
  if (tris === 0) throw new AppError("INVALID_MODEL", "Il modello non contiene triangoli.");

  const originalBounds = computeBounds(doc);
  if (originalBounds.min.some((x) => !Number.isFinite(x))) throw new AppError("INVALID_MODEL", "Il modello contiene coordinate non valide.");

  let ext = originalBounds.max.map((m, i) => m - originalBounds.min[i]);
  let rotatedUpAxis = false, rotatedLengthAxis = false;

  // Se l'asse verticale sembra Z (nessun veicolo è più alto che lungo), ruota -90° attorno a X.
  if (ext[1] > ext[0] && ext[1] > ext[2]) {
    transformPositions(doc, (v) => { const y = v[1]; v[1] = v[2]; v[2] = -y; }, (n) => { const y = n[1]; n[1] = n[2]; n[2] = -y; });
    rotatedUpAxis = true;
  }
  let b = computeBounds(doc);
  ext = b.max.map((m, i) => m - b.min[i]);
  // Lunghezza lungo Z: se X è più esteso, ruota 90° attorno a Y.
  if (ext[0] > ext[2]) {
    transformPositions(doc, (v) => { const x = v[0]; v[0] = -v[2]; v[2] = x; }, (n) => { const x = n[0]; n[0] = -n[2]; n[2] = x; });
    rotatedLengthAxis = true;
  }
  if (opts.flipFront) {
    transformPositions(doc, (v) => { v[0] = -v[0]; v[2] = -v[2]; }, (n) => { n[0] = -n[0]; n[2] = -n[2]; });
  }
  b = computeBounds(doc);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, gy = b.min[1];
  const len = b.max[2] - b.min[2];
  const scale = opts.targetLength && len > 0 ? opts.targetLength / len : len > 0 && (len < 0.5 || len > 40) ? 4.5 / len : 1;
  transformPositions(doc, (v) => { v[0] = (v[0] - cx) * scale; v[1] = (v[1] - gy) * scale; v[2] = (v[2] - cz) * scale; });
  b = computeBounds(doc);
  return {
    originalBounds,
    rotatedUpAxis,
    rotatedLengthAxis,
    scale,
    dimensions: { length: b.max[2] - b.min[2], width: b.max[0] - b.min[0], height: b.max[1] - b.min[1] },
  };
}

export interface OptimizeReport { trianglesBefore: number; trianglesAfter: number; textures: number }

export async function optimize(doc: Document, targetTriangles: number, textureSize: number): Promise<OptimizeReport> {
  const before = triangleCount(doc);
  await doc.transform(dedup(), weld());
  if (before > targetTriangles) {
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: targetTriangles / before, error: 0.0008, lockBorder: false }));
  }
  await doc.transform(
    textureCompress({ encoder: sharp, resize: [textureSize, textureSize], targetFormat: undefined }),
    prune({ keepAttributes: true, keepLeaves: false }),
  );
  return { trianglesBefore: before, trianglesAfter: triangleCount(doc), textures: doc.getRoot().listTextures().length };
}

/* ------------------- campionamento colore ------------------- */

interface DecodedTexture { w: number; h: number; data: Buffer }
const texCache = new WeakMap<Texture, Promise<DecodedTexture | null>>();

export function decodeTexture(tex: Texture): Promise<DecodedTexture | null> {
  let p = texCache.get(tex);
  if (!p) {
    p = (async () => {
      const img = tex.getImage();
      if (!img) return null;
      try {
        const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
        return { w: info.width, h: info.height, data };
      } catch {
        return null;
      }
    })();
    texCache.set(tex, p);
  }
  return p;
}

export function sampleTexture(t: DecodedTexture, u: number, v: number, out: number[]) {
  u = u - Math.floor(u);
  v = v - Math.floor(v);
  const x = Math.min(t.w - 1, Math.floor(u * t.w));
  const y = Math.min(t.h - 1, Math.floor(v * t.h));
  const i = (y * t.w + x) * 4;
  out[0] = t.data[i] / 255; out[1] = t.data[i + 1] / 255; out[2] = t.data[i + 2] / 255; out[3] = t.data[i + 3] / 255;
}

/** Triangoli "piatti" in spazio mondo con informazioni colore, per segmentazione e voxelizzazione. */
export interface Soup {
  /** 9 float per triangolo */
  pos: Float32Array;
  /** colore medio RGBA per triangolo (0-1), 4 float */
  color: Float32Array;
  /** colore campionato ai 3 vertici + baricentro: per la voxelizzazione usiamo una funzione di campionamento */
  sampler: (tri: number, a: number, b: number, out: number[]) => void;
  /** riferimento al primitivo di origine e indice del triangolo al suo interno */
  prim: Primitive[];
  primIndex: Uint32Array;
  localTri: Uint32Array;
  count: number;
}

export async function buildSoup(doc: Document): Promise<Soup> {
  const prims: Primitive[] = [];
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4 || !p.getAttribute("POSITION")) continue;
      prims.push(p);
      const idx = p.getIndices();
      total += Math.floor((idx ? idx.getCount() : p.getAttribute("POSITION")!.getCount()) / 3);
    }
  }
  const pos = new Float32Array(total * 9);
  const uv = new Float32Array(total * 6);
  const vcol = new Float32Array(total * 12);
  const hasUv = new Uint8Array(total);
  const primIndex = new Uint32Array(total);
  const localTri = new Uint32Array(total);
  const texOf: (DecodedTexture | null)[] = [];
  const factorOf: number[][] = [];
  let t = 0;
  for (let pi = 0; pi < prims.length; pi++) {
    const p = prims[pi];
    const mat = p.getMaterial();
    factorOf.push(mat ? mat.getBaseColorFactor() : [0.7, 0.7, 0.7, 1]);
    const tex = mat?.getBaseColorTexture();
    const texInfo = mat?.getBaseColorTextureInfo();
    texOf.push(tex ? await decodeTexture(tex) : null);
    const uvSet = texInfo ? texInfo.getTexCoord() : 0;
    const P = p.getAttribute("POSITION")!, UV = p.getAttribute(`TEXCOORD_${uvSet}`), C = p.getAttribute("COLOR_0");
    const idx = p.getIndices();
    const n = Math.floor((idx ? idx.getCount() : P.getCount()) / 3);
    const v = [0, 0, 0, 0];
    for (let k = 0; k < n; k++, t++) {
      primIndex[t] = pi;
      localTri[t] = k;
      hasUv[t] = UV && texOf[pi] ? 1 : 0;
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getScalar(k * 3 + c) : k * 3 + c;
        P.getElement(vi, v);
        pos[t * 9 + c * 3] = v[0]; pos[t * 9 + c * 3 + 1] = v[1]; pos[t * 9 + c * 3 + 2] = v[2];
        if (UV) {
          UV.getElement(vi, v);
          uv[t * 6 + c * 2] = v[0]; uv[t * 6 + c * 2 + 1] = v[1];
        }
        if (C) {
          v[3] = 1;
          C.getElement(vi, v);
          vcol.set([v[0], v[1], v[2], C.getElementSize() === 4 ? v[3] : 1], t * 12 + c * 4);
        } else vcol.set([1, 1, 1, 1], t * 12 + c * 4);
      }
    }
  }
  const tmp = [0, 0, 0, 0];
  const sampler = (tri: number, a: number, b: number, out: number[]) => {
    const c = 1 - a - b;
    const f = factorOf[primIndex[tri]];
    let r = f[0], g = f[1], bl = f[2], al = f[3];
    const tex = texOf[primIndex[tri]];
    if (hasUv[tri] && tex) {
      const o = tri * 6;
      sampleTexture(tex, uv[o] * c + uv[o + 2] * a + uv[o + 4] * b, uv[o + 1] * c + uv[o + 3] * a + uv[o + 5] * b, tmp);
      r *= tmp[0]; g *= tmp[1]; bl *= tmp[2]; al *= tmp[3];
    }
    const o = tri * 12;
    out[0] = r * (vcol[o] * c + vcol[o + 4] * a + vcol[o + 8] * b);
    out[1] = g * (vcol[o + 1] * c + vcol[o + 5] * a + vcol[o + 9] * b);
    out[2] = bl * (vcol[o + 2] * c + vcol[o + 6] * a + vcol[o + 10] * b);
    out[3] = al * (vcol[o + 3] * c + vcol[o + 7] * a + vcol[o + 11] * b);
  };
  const color = new Float32Array(total * 4);
  const acc = [0, 0, 0, 0];
  const pts = [[1 / 3, 1 / 3], [0.1, 0.1], [0.8, 0.1], [0.1, 0.8]];
  for (let i = 0; i < total; i++) {
    let r = 0, g = 0, bb = 0, aa = 0;
    for (const [a, b] of pts) { sampler(i, a, b, acc); r += acc[0]; g += acc[1]; bb += acc[2]; aa += acc[3]; }
    color.set([r / 4, g / 4, bb / 4, aa / 4], i * 4);
  }
  return { pos, color, sampler, prim: prims, primIndex, localTri, count: total };
}
