import { AppError } from "@/lib/errors";
import { clientIp, handler, rateLimit, requireAccess } from "@/lib/http";
import { runPipeline } from "@/lib/pipeline";
import { VehicleInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Converte un GLB caricato dall'utente (senza generazione AI).
 * Su Vercel il corpo della richiesta è limitato a ~4,5 MB.
 */
export const POST = handler(async (req) => {
  requireAccess(req);
  rateLimit(`convert:${clientIp(req)}`, 6, 10 * 60_000);
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError("BAD_REQUEST", "Richiesta multipart non valida.");
  const file = form.get("model");
  if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "Nessun file GLB.");
  if (file.size > 60 * 1024 * 1024) throw new AppError("BAD_REQUEST", "File troppo grande (max 60 MB).");
  let vehicle;
  try {
    vehicle = VehicleInputSchema.parse(JSON.parse(String(form.get("vehicle") ?? "{}")));
  } catch {
    throw new AppError("BAD_REQUEST", "Dati veicolo non validi.");
  }
  const quality = (["ULTRA", "ALTA", "STANDARD"] as const).find((q) => q === form.get("quality")) ?? "ULTRA";
  const orientation = (["auto", "normal", "flipped"] as const).find((q) => q === form.get("orientation")) ?? "auto";
  const buf = Buffer.from(await file.arrayBuffer());
  return runPipeline(buf, { vehicle, quality, orientation, source: `file caricato (${file.name.slice(0, 60)})` });
});
