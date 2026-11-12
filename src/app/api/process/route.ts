import { z } from "zod";
import { AppError } from "@/lib/errors";
import { clientIp, fetchLimited, handler, rateLimit, readJson, requireAccess } from "@/lib/http";
import { decodeDataUri, dominantColor, normalizeImage } from "@/lib/images";
import { runPipeline } from "@/lib/pipeline";
import { getProvider } from "@/lib/providers";
import { downloadReference } from "@/lib/search/verify";
import { VehicleInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  provider: z.enum(["meshy", "fal"]),
  taskId: z.string().regex(/^[A-Za-z0-9_-]{4,100}$/),
  vehicle: VehicleInputSchema,
  quality: z.enum(["ULTRA", "ALTA", "STANDARD"]).default("ULTRA"),
  orientation: z.enum(["auto", "normal", "flipped"]).default("auto"),
  interiorUrls: z.array(z.string().url().max(2000)).max(3).default([]),
  icon: z.string().max(12_000_000).optional(),
});

export const POST = handler(async (req) => {
  requireAccess(req);
  rateLimit(`process:${clientIp(req)}`, 6, 10 * 60_000);
  const body = await readJson(req, (b) => Body.parse(b));
  const provider = getProvider(body.provider);

  // L'URL del modello arriva dal provider, non dal client; accettiamo solo host noti.
  const modelUrl = await provider.getResultModelUrl(body.taskId);
  const host = new URL(modelUrl).hostname;
  if (!provider.allowedDownloadHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new AppError("PROVIDER_ERROR", `Host del modello non riconosciuto: ${host}`);
  }
  const { buffer } = await fetchLimited(modelUrl, { maxBytes: 250 * 1024 * 1024, timeoutMs: 120_000 });

  const colors: [number, number, number][] = [];
  for (const u of body.interiorUrls) {
    const d = await downloadReference({ id: "i", source: "upload", imageUrl: u, thumbUrl: u, title: "", queryView: "interior" });
    if (d.jpeg) colors.push(await dominantColor(d.jpeg));
  }
  const icon = body.icon ? (await normalizeImage(decodeDataUri(body.icon), 512)).jpeg : undefined;

  const result = await runPipeline(buffer, {
    vehicle: body.vehicle,
    quality: body.quality,
    orientation: body.orientation,
    seatColor: colors[0],
    dashColor: colors[1] ?? (colors[0] ? (colors[0].map((c) => Math.round(c * 0.6)) as [number, number, number]) : undefined),
    icon,
    source: `${provider.label}, task ${body.taskId}`,
  });
  return result;
});
