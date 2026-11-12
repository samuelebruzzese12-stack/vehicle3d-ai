import { Client, handle_file } from "@gradio/client";
import { readFileSync, writeFileSync } from "node:fs";
const t = Date.now(); const log = (m: string) => console.log(`[${((Date.now() - t) / 1000).toFixed(0)}s] ${m}`);
const app = await Client.connect(process.env.SPACE ?? "trellis-community/TRELLIS", { events: ["data", "status"], ...(process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN as `hf_${string}` } : {}) });
log("connesso");
const img = new Blob([readFileSync(process.argv[2])], { type: "image/jpeg" });
const job = app.submit("/generate_and_extract_glb", { image: handle_file(img), multiimages: [], seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12, multiimage_algo: "stochastic", mesh_simplify: 0.95, texture_size: 1024 });
for await (const ev of job) {
  if (ev.type === "status") log(`stato ${ev.stage} ${ev.queue ? `coda pos ${ev.position ?? "?"}/${ev.size ?? "?"}` : ""} ${ev.message ?? ""} ${ev.progress_data?.map((p) => `${p.index}/${p.length}`).join(",") ?? ""}`);
  if (ev.type === "data") {
    const d = ev.data as { url?: string; path?: string }[];
    log("dati: " + JSON.stringify(d).slice(0, 400));
    const glb = d[1]?.url ?? d[2]?.url;
    if (glb) { const r = await fetch(glb); const b = Buffer.from(await r.arrayBuffer()); writeFileSync(process.argv[3], b); log(`GLB scaricato ${b.length} byte, http ${r.status}`); }
    break;
  }
}
process.exit(0);
