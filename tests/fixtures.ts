import { Document, NodeIO } from "@gltf-transform/core";

/** Veicolo sintetico: scocca, abitacolo vetrato, 4 ruote scure, fanali rossi (posteriori) su un lato scelto. */
export async function syntheticCar(opts: { rearAt: "+z" | "-z"; scale?: number } = { rearAt: "-z" }) {
  const s = opts.scale ?? 1;
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const mat = (name: string, c: [number, number, number, number]) => doc.createMaterial(name).setBaseColorFactor(c);
  const box = (name: string, min: number[], max: number[], m: ReturnType<typeof mat>) => {
    const [x0, y0, z0] = min.map((v) => v * s), [x1, y1, z1] = max.map((v) => v * s);
    const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    // facce subdivise non necessarie: il campionamento della voxelizzazione è denso
    const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(i)).setBuffer(buf))
      .setMaterial(m);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  };
  const cyl = (name: string, cx: number, cy: number, cz: number, r: number, w: number, m: ReturnType<typeof mat>) => {
    const N = 24, p: number[] = [], idx: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const y = cy + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      p.push((cx - w / 2) * s, y * s, z * s, (cx + w / 2) * s, y * s, z * s);
    }
    p.push((cx - w / 2) * s, cy * s, cz * s, (cx + w / 2) * s, cy * s, cz * s);
    const c0 = N * 2, c1 = N * 2 + 1;
    for (let k = 0; k < N; k++) {
      const a = k * 2, b = ((k + 1) % N) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1, c0, b, a, c1, a + 1, b + 1);
    }
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buf))
      .setMaterial(m);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  };
  const paint = mat("vernice", [0.1, 0.3, 0.8, 1]);
  const glass = mat("vetro", [0.05, 0.07, 0.1, 1]);
  const tyre = mat("gomma", [0.03, 0.03, 0.03, 1]);
  const red = mat("fanale", [0.9, 0.05, 0.05, 1]);
  const white = mat("faro", [1, 1, 1, 1]);
  const rear = opts.rearAt === "-z" ? -1 : 1;
  box("scocca", [-0.85, 0.3, -2.1], [0.85, 0.95, 2.1], paint);
  box("cabina", [-0.75, 0.95, -1.0], [0.75, 1.45, 0.9], glass);
  box("fanale_sx", [0.45, 0.6, rear * 2.1 - 0.02], [0.8, 0.8, rear * 2.1 + 0.02], red);
  box("fanale_dx", [-0.8, 0.6, rear * 2.1 - 0.02], [-0.45, 0.8, rear * 2.1 + 0.02], red);
  box("faro_sx", [0.45, 0.6, -rear * 2.1 - 0.02], [0.8, 0.75, -rear * 2.1 + 0.02], white);
  box("faro_dx", [-0.8, 0.6, -rear * 2.1 - 0.02], [-0.45, 0.75, -rear * 2.1 + 0.02], white);
  for (const z of [1.35, -1.35]) for (const x of [0.78, -0.78]) cyl(`ruota_${x}_${z}`, x, 0.33, z, 0.33, 0.24, tyre);
  return new NodeIO().writeBinary(doc);
}
