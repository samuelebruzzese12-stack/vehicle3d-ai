import "server-only";
import { Client, handle_file } from "@gradio/client";
import { env } from "../env";
import { AppError } from "../errors";
import { fetchLimited } from "../http";
import { AI_MODELS, type AiModelInfo } from "./ai-models";

export interface AiAttempt { backend: string; model: string; ok: boolean; message: string; ms: number }
export interface AiResult { glb: Uint8Array; model: AiModelInfo; backend: string; attempts: AiAttempt[] }

/** Worker self-hosted (TripoSR/TRELLIS): POST /generate con l'immagine JPEG. */
async function viaWorker(image: Buffer, modelId: string): Promise<Uint8Array> {
  const url = env.aiWorkerUrl()!;
  const res = await fetch(`${url.replace(/\/$/, "")}/generate?model=${modelId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.aiWorkerToken() ?? ""}`, "Content-Type": "image/jpeg" },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) throw new Error(`worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Space Hugging Face pubblico. Quota ZeroGPU gratuita: con HF_TOKEN (gratuito) la quota è dell'account. */
async function viaSpace(model: AiModelInfo, images: Buffer[], onStatus?: (s: string) => void): Promise<Uint8Array> {
  const token = env.hfToken();
  const app = await Client.connect(model.space!, { events: ["data", "status"], ...(token ? { token: token as `hf_${string}` } : {}) });
  const blob = (b: Buffer) => handle_file(new Blob([new Uint8Array(b)], { type: "image/jpeg" }));
  let fileUrl: string | undefined;
  if (model.id === "trellis") {
    const job = app.submit("/generate_and_extract_glb", {
      image: blob(images[0]),
      multiimages: images.length > 1 ? images.map((b) => ({ image: blob(b), caption: null })) : [],
      seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12,
      multiimage_algo: "stochastic", mesh_simplify: 0.95, texture_size: 1024,
    });
    for await (const ev of job) {
      if (ev.type === "status") {
        if (ev.stage === "error") throw new Error(typeof ev.message === "string" ? ev.message : JSON.stringify(ev.message ?? "errore dello Space"));
        onStatus?.(ev.queue && ev.position != null ? `In coda (posizione ${ev.position})` : "Generazione in corso");
      }
      if (ev.type === "data") {
        const d = ev.data as ({ url?: string } | null)[];
        fileUrl = d[1]?.url ?? d[2]?.url ?? undefined;
        break;
      }
    }
  } else if (model.id === "trellis2") {
    // TRELLIS.2: due passi nella stessa sessione (generazione, poi estrazione GLB)
    const run = async (endpoint: string, data: Record<string, unknown>) => {
      const job = app.submit(endpoint, data);
      for await (const ev of job) {
        if (ev.type === "status" && ev.stage === "error") throw new Error(typeof ev.message === "string" ? ev.message : JSON.stringify(ev.message ?? "errore dello Space"));
        if (ev.type === "status") onStatus?.(ev.queue && ev.position != null ? `In coda (posizione ${ev.position})` : "Generazione in corso");
        if (ev.type === "data") return ev.data as unknown[];
      }
      throw new Error("nessuna risposta");
    };
    await run("/start_session", {});
    await run("/image_to_3d", { image: blob(images[0]), seed: 0, resolution: "1024" });
    const out = (await run("/extract_glb", { decimation_target: 300000, texture_size: 2048 })) as ({ url?: string } | null)[];
    fileUrl = out[0]?.url ?? out[1]?.url ?? undefined;
  } else throw new Error("modello non supportato sugli Spaces");
  if (!fileUrl) throw new Error("lo Space non ha restituito un GLB");
  const host = new URL(fileUrl).hostname;
  if (!host.endsWith(".hf.space")) throw new Error(`host del risultato non consentito: ${host}`);
  const { buffer } = await fetchLimited(fileUrl, { maxBytes: 200e6, timeoutMs: 120_000 });
  return new Uint8Array(buffer);
}

/** Modelli utilizzabili con la configurazione corrente, in ordine di qualità. */
export function availableAiModels() {
  return AI_MODELS.filter((m) => m.outputUsable || env.allowRegionRestrictedModels()).sort((a, b) => b.quality - a.quality);
}

/**
 * Genera un modello 3D da 1+ immagini provando, in ordine: worker self-hosted, poi Spaces gratuiti.
 * Ogni tentativo viene registrato (backend, esito, durata) e mostrato all'utente.
 */
export async function generateAi(images: Buffer[], opts: { preferred?: AiModelInfo["id"]; onStatus?: (s: string) => void } = {}): Promise<AiResult> {
  if (!images.length) throw new AppError("BAD_REQUEST", "Serve almeno un'immagine per la generazione AI.");
  const models = availableAiModels();
  const ordered = opts.preferred ? [...models.filter((m) => m.id === opts.preferred), ...models.filter((m) => m.id !== opts.preferred)] : models;
  const attempts: AiAttempt[] = [];
  const plan: { backend: string; model: AiModelInfo; run: () => Promise<Uint8Array> }[] = [];
  if (env.aiWorkerUrl()) for (const m of ordered.filter((x) => x.id === "triposr" || x.id === "trellis")) plan.push({ backend: "worker self-hosted", model: m, run: () => viaWorker(images[0], m.id) });
  for (const m of ordered.filter((x) => x.space)) plan.push({ backend: `Space ${m.space}`, model: m, run: () => viaSpace(m, images, opts.onStatus) });
  if (!plan.length) throw new AppError("NOT_CONFIGURED", "Nessun motore AI disponibile.");
  for (const p of plan) {
    const t = Date.now();
    try {
      opts.onStatus?.(`${p.model.name} – ${p.backend}`);
      const glb = await p.run();
      if (glb.byteLength < 1000 || Buffer.from(glb.subarray(0, 4)).toString() !== "glTF") throw new Error("il risultato non è un GLB valido");
      attempts.push({ backend: p.backend, model: p.model.name, ok: true, message: "completato", ms: Date.now() - t });
      return { glb, model: p.model, backend: p.backend, attempts };
    } catch (e) {
      const msg = (e as Error).message;
      attempts.push({ backend: p.backend, model: p.model.name, ok: false, message: /quota/i.test(msg) ? `quota gratuita esaurita: ${msg}` : msg, ms: Date.now() - t });
    }
  }
  throw new AppError("PROVIDER_ERROR", `Nessun motore AI gratuito ha completato la generazione: ${attempts.map((a) => `${a.model} (${a.backend}): ${a.message}`).join(" | ")}`, attempts);
}
