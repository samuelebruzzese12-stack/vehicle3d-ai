// Costruzione completa da riga di comando, con gli stessi moduli della route /api/build.
// Uso: tsx scripts/build-vehicle.mts "T-80" [mimetica|vernice|originale] [immagini-locali...]
import { readFileSync } from "node:fs";
import { commonsImageCredits } from "../src/lib/engines/acquire";
import { acquire } from "../src/lib/engines/orchestrator";
import { fetchLimited } from "../src/lib/http";
import { normalizeImage } from "../src/lib/images";
import { parseLicense, type Credit } from "../src/lib/licenses";
import { runPipeline } from "../src/lib/pipeline";
import { commonsCategoryImages } from "../src/lib/sources/commons";
import { identifyByName, toVehicleInput } from "../src/lib/sources/wikidata";

const t = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t) / 1000).toFixed(0)}s] ${m}`);
const name = process.argv[2] ?? "T-80";
const liveryArg = process.argv[3] ?? "originale";
const localImages = process.argv.slice(4);

const [v] = await identifyByName(name);
if (!v) throw new Error("veicolo non trovato");
log(`identificato: ${v.label} (${v.qid}) ${v.category} ${JSON.stringify(v.dimensions_m)} commons=${v.commonsCategory}`);

const aiImages: { jpeg: Buffer; credit: Credit }[] = [];
for (const f of localImages) aiImages.push({ jpeg: (await normalizeImage(readFileSync(f), 1280)).jpeg, credit: { title: f.split("/").pop()!, sourceName: "file locale", license: parseLicense("CC0"), usage: "riferimento-ai" } });
if (!aiImages.length && v.commonsCategory) {
  const photos = (await commonsCategoryImages(v.commonsCategory, 40)).filter((p) => p.licenseId && !["unknown", "cc-by-nd", "cc-by-nc-nd"].includes(p.licenseId));
  log(`${photos.length} foto con licenza utilizzabile`);
  const credits = await commonsImageCredits(photos.slice(0, 6).map((p) => p.title));
  for (const c of credits.values()) {
    if (aiImages.length >= 2) break;
    try {
      const { buffer } = await fetchLimited(c.url, { maxBytes: 15e6, timeoutMs: 30000 });
      const { url: _u, ...credit } = c; void _u;
      aiImages.push({ jpeg: (await normalizeImage(buffer, 1280)).jpeg, credit });
      log(`riferimento: ${c.title} – ${c.author} – ${c.license.label}`);
    } catch (e) { log(`riferimento non scaricabile (${c.title}): ${(e as Error).message}`); }
  }
}

const acquired = await acquire({ name: v.label, mode: "auto", commercial: false, aiImages, onStatus: (s) => log(s) }).catch((e) => {
  log("ACQUISIZIONE FALLITA: " + e.message);
  for (const a of (e.details ?? []) as { label: string; ok: boolean; message: string }[]) log(`  ${a.ok ? "✓" : "✗"} ${a.label}: ${a.message}`);
  process.exit(2);
});
log(`modello ottenuto: ${acquired.path.label}`);
const livery = liveryArg === "mimetica" ? { mode: "mimetica" as const, camo: "verde_nato" as const } : liveryArg === "vernice" ? { mode: "vernice" as const } : { mode: "originale" as const };
const r = await runPipeline(acquired.glb, { vehicle: toVehicleInput(v), quality: "ULTRA", source: acquired.path.label, credits: acquired.credits, path: acquired.path, livery, icon: aiImages[0]?.jpeg, log });
log(`FATTO job ${r.jobId}: ${r.files.map((f) => `${f.name} (${(f.bytes / 1e6).toFixed(2)} MB)`).join(", ")}`);
