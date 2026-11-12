// Statistiche dei colori campionati da un GLB (debug del sistema materiali).
import { readFileSync } from "node:fs";
import { readGlb } from "../src/lib/mesh/io";
import { buildSoup } from "../src/lib/mesh/scene";
const doc = await readGlb(readFileSync(process.argv[2]));
const s = await buildSoup(doc);
const buckets = new Map<string, number>();
for (let i = 0; i < s.count; i++) {
  const k = [0, 1, 2].map((c) => Math.round(s.color[i * 4 + c] * 10) / 10).join(",");
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
console.log(s.count, "triangoli; texture:", doc.getRoot().listTextures().map((t) => `${t.getMimeType()} ${t.getImage()?.length}`));
console.log([...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
