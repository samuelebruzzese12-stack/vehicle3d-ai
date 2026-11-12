// Esegue la pipeline su un file locale (debug/prove). Uso: tsx scripts/run-pipeline.mts file.glb [vernice|mimetica]
import { readFileSync } from "node:fs";
import { runPipeline } from "../src/lib/pipeline";
import { findTexture } from "../src/lib/sources/polyhaven";
import { fetchLimited } from "../src/lib/http";
const t = Date.now();
const livery = process.argv[3] === "mimetica" ? { mode: "mimetica" as const, camo: "woodland" as const } : process.argv[3] === "vernice" ? { mode: "vernice" as const, color: [200, 30, 30] as [number, number, number] } : { mode: "originale" as const };
let seatTexture;
if (process.argv[4] === "tessuto") {
  const tx = await findTexture("tessuto");
  const { buffer } = await fetchLimited(tx!.maps.diffuse!, { maxBytes: 10e6, timeoutMs: 30000 });
  seatTexture = { image: new Uint8Array(buffer), mime: "image/jpeg", credit: tx!.credit };
  console.log("texture", buffer.length);
}
const r = await runPipeline(readFileSync(process.argv[2]), {
  vehicle: { make: "Alfa Romeo", model: "159", category: "auto", dimensions_m: { length: 4.661, width: 1.83, height: 1.417 } }, quality: "ULTRA", source: "debug", livery, seatTexture,
  log: (m) => console.log(`[${((Date.now() - t) / 1000).toFixed(1)}s] ${m}`),
});
console.log("ok", r.jobId, (r.report as { minecraft: { cubes: number } }).minecraft.cubes, "cubi");
