import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "../env";
import { fetchLimited } from "../http";
import { normalizeImage } from "../images";
import { anthropic, mapAnthropicError } from "../vehicle/identify";
import { VIEWS, type ReferenceCandidate, type VehicleInput, type VerifiedReference } from "../types";

export interface DownloadedRef {
  candidate: ReferenceCandidate;
  jpeg?: Buffer;
  width?: number;
  height?: number;
  error?: string;
}

/** Scarica e valida un riferimento (decodifica reale dell'immagine). */
export async function downloadReference(c: ReferenceCandidate, maxSide = 1600): Promise<DownloadedRef> {
  try {
    const { buffer } = await fetchLimited(c.imageUrl, { maxBytes: 15 * 1024 * 1024, timeoutMs: 20000 });
    const img = await normalizeImage(buffer, maxSide);
    return { candidate: c, jpeg: img.jpeg, width: img.width, height: img.height };
  } catch (e) {
    return { candidate: c, error: (e as Error).message };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const ClassificationSchema = z.object({
  images: z.array(z.object({
    index: z.number().int(),
    matches_vehicle: z.boolean(),
    view: z.enum(VIEWS),
    quality: z.number().min(0).max(1),
    reason: z.string(),
  })),
});

const BATCH = 10;

async function classifyBatch(vehicle: VehicleInput, refs: DownloadedRef[]) {
  const c = anthropic();
  const desc = `${vehicle.make} ${vehicle.model}${vehicle.year ? ` (${vehicle.year})` : ""}, categoria ${vehicle.category}`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (let i = 0; i < refs.length; i++) {
    const { jpeg } = await normalizeImage(refs[i].jpeg!, 640);
    content.push({ type: "text", text: `Immagine ${i}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } });
  }
  content.push({
    type: "text",
    text: `Veicolo di riferimento: ${desc}.
Per ogni immagine indica:
- matches_vehicle: true solo se mostra proprio questo modello/generazione (non un modello simile, non un giocattolo o rendering molto diverso).
- view: angolazione (front, rear, left, right, top, front_three_quarter, rear_three_quarter, interior, dashboard, other). "left" = lato sinistro del veicolo (lato guida nei paesi con guida a destra).
- quality: 0-1 utilità come riferimento per una ricostruzione 3D (veicolo intero, nitido, poco coperto, sfondo pulito).
- reason: breve motivazione in italiano.`,
  });
  const res = await c.beta.messages.parse({
    model: env.anthropicModel(),
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ClassificationSchema) },
    messages: [{ role: "user", content }],
  });
  return res.parsed_output?.images ?? [];
}

export async function verifyReferences(vehicle: VehicleInput, candidates: ReferenceCandidate[], useAI: boolean) {
  const downloaded = await pool(candidates, 4, (c) => downloadReference(c));
  const ok = downloaded.filter((d) => d.jpeg);
  const results = new Map<string, VerifiedReference>();

  for (const d of downloaded) {
    results.set(d.candidate.id, {
      ...d.candidate,
      ok: Boolean(d.jpeg),
      problem: d.error,
      width: d.width ?? d.candidate.width,
      height: d.height ?? d.candidate.height,
      view: d.candidate.queryView,
      matches: null,
      quality: null,
      verifiedBy: "none",
    });
  }

  let aiError: string | undefined;
  if (useAI && env.anthropicKey() && ok.length) {
    try {
      for (let i = 0; i < ok.length; i += BATCH) {
        const batch = ok.slice(i, i + BATCH);
        const cls = await classifyBatch(vehicle, batch);
        for (const r of cls) {
          const ref = batch[r.index];
          if (!ref) continue;
          const v = results.get(ref.candidate.id)!;
          Object.assign(v, { view: r.view, matches: r.matches_vehicle, quality: r.quality, reason: r.reason, verifiedBy: "ai" });
        }
      }
    } catch (e) {
      try {
        mapAnthropicError(e);
      } catch (mapped) {
        aiError = (mapped as Error).message;
      }
    }
  }
  return { references: [...results.values()], aiUsed: useAI && Boolean(env.anthropicKey()) && !aiError, aiError };
}
