import { z } from "zod";
import { revalidateCandidate, commonsImageCredits } from "@/lib/engines/acquire";
import { acquire } from "@/lib/engines/orchestrator";
import { AppError } from "@/lib/errors";
import { clientIp, fetchLimited, handler, rateLimit, requireAccess } from "@/lib/http";
import { decodeDataUri, normalizeImage } from "@/lib/images";
import { parseLicense, type Credit } from "@/lib/licenses";
import { runPipeline } from "@/lib/pipeline";
import { findTexture } from "@/lib/sources/polyhaven";
import { VehicleInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Req = z.object({
  name: z.string().trim().min(2).max(100),
  vehicle: VehicleInputSchema,
  mode: z.enum(["auto", "A", "B", "C", "D", "upload"]),
  quality: z.enum(["ULTRA", "ALTA", "STANDARD"]).default("ULTRA"),
  orientation: z.enum(["auto", "normal", "flipped"]).default("auto"),
  commercial: z.boolean().default(false),
  livery: z.object({ mode: z.enum(["originale", "vernice", "mimetica"]), color: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional(), camo: z.enum(["woodland", "deserto", "digitale", "invernale", "verde_nato"]).optional() }).default({ mode: "originale" }),
  candidate: z.object({ id: z.string().max(400), source: z.enum(["sketchfab", "github", "commons"]) }).optional(),
  /** titoli di file Commons scelti come riferimento per l'AI (licenza riverificata sul server) */
  aiImages: z.array(z.string().max(300)).max(4).default([]),
  /** foto dell'utente (data URI): di sua proprietà, usata come riferimento per l'AI */
  userPhoto: z.string().max(12_000_000).optional(),
  seatTexture: z.boolean().default(true),
});

export const POST = handler(async (req) => {
  requireAccess(req);
  rateLimit(`build:${clientIp(req)}`, 4, 10 * 60_000);
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError("BAD_REQUEST", "Richiesta non valida.");
  let r: z.infer<typeof Req>;
  try {
    r = Req.parse(JSON.parse(String(form.get("request") ?? "{}")));
  } catch (e) {
    throw new AppError("BAD_REQUEST", "Parametri non validi.", (e as Error).message);
  }
  const file = form.get("model");
  const upload = file instanceof File ? { data: new Uint8Array(await file.arrayBuffer()), name: file.name } : undefined;
  if (upload && upload.data.byteLength > 60e6) throw new AppError("BAD_REQUEST", "File troppo grande (max 60 MB).");

  // immagini per l'AI: foto dell'utente + riferimenti Commons con licenza riverificata
  const aiImages: { jpeg: Buffer; credit: Credit }[] = [];
  if (r.userPhoto) {
    const img = await normalizeImage(decodeDataUri(r.userPhoto), 1280);
    aiImages.push({ jpeg: img.jpeg, credit: { title: "Foto dell'utente", sourceName: "caricata dall'utente", license: parseLicense("CC0"), usage: "riferimento-ai" } });
  }
  if ((r.mode === "auto" || r.mode === "A") && r.aiImages.length) {
    const credits = await commonsImageCredits(r.aiImages);
    for (const c of credits.values()) {
      try {
        const { buffer } = await fetchLimited(c.url, { maxBytes: 15e6, timeoutMs: 30000 });
        const { url: _u, ...credit } = c;
        void _u;
        aiImages.push({ jpeg: (await normalizeImage(buffer, 1280)).jpeg, credit });
      } catch { /* immagine non scaricabile: si prosegue con le altre */ }
    }
  }

  const candidate = r.candidate ? await revalidateCandidate(r.candidate.id, r.candidate.source, r.commercial) : undefined;
  const acquired = await acquire({ name: r.name, mode: r.mode, commercial: r.commercial, aiImages, candidate, upload });

  let seatTexture;
  if (r.seatTexture && !acquired.bedrock) {
    try {
      const t = await findTexture("tessuto");
      if (t?.maps.diffuse) {
        const { buffer } = await fetchLimited(t.maps.diffuse, { maxBytes: 10e6, timeoutMs: 30000 });
        seatTexture = { image: new Uint8Array(buffer), mime: "image/jpeg", credit: t.credit };
      }
    } catch { /* texture opzionale */ }
  }

  const result = await runPipeline(acquired.glb, {
    vehicle: r.vehicle, quality: r.quality, orientation: r.orientation, livery: r.livery, commercial: r.commercial,
    credits: acquired.credits, path: acquired.path, bedrock: acquired.bedrock, seatTexture,
    icon: aiImages[0]?.jpeg, source: acquired.path.label,
  });
  return { ...result, notes: acquired.notes };
});
