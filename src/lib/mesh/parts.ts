import "server-only";
import { type Document, type Material, type Node } from "@gltf-transform/core";
import { compactPrimitive, prune } from "@gltf-transform/functions";
import type { Soup } from "./scene";
import type { Segmentation } from "./segment";

const PART_NAMES_IT: Record<string, string> = {
  body: "Carrozzeria",
  glass: "Vetri",
  light_front: "Fari_anteriori",
  light_rear: "Fanali_posteriori",
  door_left: "Porta_sinistra",
  door_right: "Porta_destra",
  interior: "Abitacolo",
  turret: "Torretta",
  barrel: "Cannone",
  track_l: "Cingolo_sinistro",
  track_r: "Cingolo_destro",
};

export function partDisplayName(label: string) {
  if (PART_NAMES_IT[label]) return PART_NAMES_IT[label];
  const m = /^wheel_(\d+)_(l|r)$/.exec(label);
  if (m) return `Ruota_asse${m[1]}_${m[2] === "l" ? "sinistra" : "destra"}`;
  return label;
}

/** Divide i primitivi originali in nodi per componente. */
export async function applySegmentation(doc: Document, soup: Soup, seg: Segmentation) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0] ?? doc.createScene("Scene");
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const vehicle = doc.createNode("Veicolo");

  // triangoli per (primitivo, etichetta)
  const groups = new Map<string, number[]>();
  for (let t = 0; t < soup.count; t++) {
    const key = `${soup.primIndex[t]}:${seg.tri[t]}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(soup.localTri[t]);
  }

  const glassMats = new Map<Material, Material>();
  const glassMaterial = (m: Material | null) => {
    const base = m ?? doc.createMaterial("Base");
    let gm = glassMats.get(base);
    if (!gm) {
      gm = base.clone().setName("Vetro").setAlphaMode("BLEND").setDoubleSided(true);
      const f = gm.getBaseColorFactor();
      gm.setBaseColorFactor([f[0] * 0.6, f[1] * 0.65, f[2] * 0.7, 0.45]);
      gm.setMetallicFactor(0).setRoughnessFactor(0.05);
      glassMats.set(base, gm);
    }
    return gm;
  };

  const nodes = new Map<number, Node>();
  for (const [key, tris] of groups) {
    const [pi, li] = key.split(":").map(Number);
    const label = seg.labels[li];
    const src = soup.prim[pi];
    const srcIdx = src.getIndices();
    const idx = new Uint32Array(tris.length * 3);
    tris.forEach((k, j) => {
      for (let c = 0; c < 3; c++) idx[j * 3 + c] = srcIdx ? srcIdx.getScalar(k * 3 + c) : k * 3 + c;
    });
    const prim = doc.createPrimitive().setMode(4).setMaterial(label === "glass" ? glassMaterial(src.getMaterial()) : src.getMaterial());
    for (const sem of src.listSemantics()) prim.setAttribute(sem, src.getAttribute(sem));
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buffer));
    compactPrimitive(prim);

    let node = nodes.get(li);
    if (!node) {
      node = doc.createNode(partDisplayName(label)).setMesh(doc.createMesh(partDisplayName(label)));
      node.setExtras({ vehicle3d_part: label });
      nodes.set(li, node);
      vehicle.addChild(node);
    }
    node.getMesh()!.addPrimitive(prim);
  }

  // pivot delle ruote sul centro: traslazione del nodo + offset dei vertici
  for (const [li, node] of nodes) {
    const w = seg.wheels.find((x) => x.name === seg.labels[li]);
    if (!w) continue;
    for (const p of node.getMesh()!.listPrimitives()) {
      const P = p.getAttribute("POSITION")!;
      const v = [0, 0, 0];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        P.setElement(i, [v[0] - w.center[0], v[1] - w.center[1], v[2] - w.center[2]]);
      }
    }
    node.setTranslation(w.center);
  }

  // rimuove la gerarchia originale
  for (const n of scene.listChildren()) scene.removeChild(n);
  const keep = new Set<Node>([vehicle, ...nodes.values()]);
  for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
  scene.addChild(vehicle);
  await doc.transform(prune({ keepAttributes: true }));
  return { parts: [...nodes.entries()].map(([li, n]) => ({ label: seg.labels[li], name: n.getName() })) };
}

/* ---------------- abitacolo procedurale ---------------- */

export interface Box { min: [number, number, number]; max: [number, number, number]; part: string; kind: "dash" | "seat" | "backrest" | "steering"; color: [number, number, number] }

/**
 * Stima l'abitacolo (sedili, plancia, volante) dalle proporzioni del veicolo.
 * È una ricostruzione procedurale: i generatori image-to-3D producono solo il guscio esterno.
 */
export function estimateInterior(seg: Segmentation, opts: { seats: number; category: string; seatColor: [number, number, number]; dashColor: [number, number, number] }): Box[] {
  const { width: W, height: H, minZ, maxZ } = seg.dims;
  const L = maxZ - minZ;
  const front = seg.wheels.find((w) => w.axle === 1);
  const lastAxle = Math.max(1, ...seg.wheels.map((w) => w.axle));
  const rear = seg.wheels.find((w) => w.axle === lastAxle && lastAxle > 1);
  const isBus = opts.category === "autobus";
  const isTruck = opts.category === "camion" || opts.category === "trattore";
  const cabinZ1 = isBus ? maxZ - 0.06 * L : front ? front.center[2] - front.radius * (isTruck ? 0.2 : 0.6) : maxZ - 0.3 * L;
  const cabinZ0 = isTruck ? cabinZ1 - Math.min(1.6, 0.35 * L) : rear ? rear.center[2] + rear.radius * 0.3 : minZ + 0.3 * L;
  const floor = Math.max(0.18 * H, front ? front.radius * 0.9 : 0.25);
  const innerW = W * 0.78;
  const seatW = Math.min(0.55, innerW / 3.2);
  const seatD = 0.5, seatH = 0.12, backH = Math.min(0.6, 0.4 * H), backT = 0.1;
  const boxes: Box[] = [];
  const seatColor = opts.seatColor, dash = opts.dashColor;

  // plancia
  const dashZ = cabinZ1 - 0.05;
  boxes.push({ part: "interior", kind: "dash", min: [-innerW / 2, floor + 0.35, dashZ - 0.35], max: [innerW / 2, Math.min(seg.beltline + 0.05, floor + 0.65), dashZ], color: dash });

  const rearPerRow = isBus ? 4 : W > 1.55 ? 3 : 2;
  const pitch = isBus ? 0.8 : 0.9;
  const usable = cabinZ1 - cabinZ0 - 0.45;
  const maxRows = Math.max(1, Math.floor(usable / pitch) + 1);
  const seats: { x: number; z: number }[] = [];
  let remaining = Math.max(1, opts.seats);
  for (let r = 0; r < maxRows && remaining > 0; r++) {
    const zFront = dashZ - 0.45 - r * pitch;
    const count = Math.min(remaining, r === 0 && !isBus ? 2 : rearPerRow);
    remaining -= count;
    for (let s = 0; s < count; s++) {
      let x: number;
      if (isBus) x = [-1, -0.55, 0.55, 1][s] * (innerW / 2 - seatW / 2);
      else if (count === 1) x = innerW / 4; // posto guida a sinistra (+X)
      else if (count === 2) x = (s === 0 ? 1 : -1) * (innerW / 4);
      else x = (1 - s) * (innerW / 3);
      seats.push({ x, z: zFront - seatD / 2 });
      boxes.push({ part: "interior", kind: "seat", min: [x - seatW / 2, floor, zFront - seatD], max: [x + seatW / 2, floor + 0.3 + seatH, zFront], color: seatColor });
      boxes.push({ part: "interior", kind: "backrest", min: [x - seatW / 2, floor + 0.3, zFront - seatD - backT], max: [x + seatW / 2, floor + 0.3 + backH, zFront - seatD], color: seatColor });
    }
  }
  // volante davanti al primo sedile (guida a sinistra: +X)
  if (seats.length) {
    const d = seats[0];
    const cx = d.x, cy = floor + 0.62, cz = dashZ - 0.32, R = 0.18, t = 0.03;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      boxes.push({ part: "interior", kind: "steering", min: [x - t, y - t, cz - t], max: [x + t, y + t, cz + t], color: [25, 25, 25] });
    }
  }
  return boxes.filter((b) => b.max[2] > minZ && b.min[2] < maxZ);
}

export function interiorSeatPositions(boxes: Box[]) {
  return boxes.filter((b) => b.kind === "seat").map((b) => ({
    x: (b.min[0] + b.max[0]) / 2, y: b.max[1], z: (b.min[2] + b.max[2]) / 2,
  }));
}

export function addInteriorToDoc(doc: Document, boxes: Box[]) {
  if (!boxes.length) return;
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const parent = doc.getRoot().listNodes().find((n) => n.getName() === "Veicolo") ?? doc.getRoot().listScenes()[0];
  const mesh = doc.createMesh("Abitacolo");
  const byColor = new Map<string, Box[]>();
  for (const b of boxes) {
    const k = b.color.join(",");
    byColor.set(k, [...(byColor.get(k) ?? []), b]);
  }
  for (const [k, list] of byColor) {
    const [r, g, bl] = k.split(",").map(Number);
    const mat = doc.createMaterial("Abitacolo_stimato").setBaseColorFactor([(r / 255) ** 2.2, (g / 255) ** 2.2, (bl / 255) ** 2.2, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (const b of list) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const faces: [number[], number[][]][] = [
        [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
        [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
        [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
        [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
        [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
        [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
      ];
      for (const [n, vs] of faces) {
        const base = pos.length / 3;
        for (const v of vs) { pos.push(...v); nor.push(...n); }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(nor)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer))
      .setMaterial(mat);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode("Abitacolo").setMesh(mesh).setExtras({ vehicle3d_part: "interior", procedural: true });
  parent.addChild(node);
}
