import { z } from "zod";
import { clientIp, handler, rateLimit, readJson, requireAccess } from "@/lib/http";
import { ImageInput, prepareImages } from "@/lib/provider-images";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  provider: z.enum(["meshy", "fal"]),
  quality: z.enum(["ULTRA", "ALTA", "STANDARD"]).default("ULTRA"),
  images: z.array(ImageInput).min(1).max(6),
});

export const POST = handler(async (req) => {
  requireAccess(req);
  rateLimit(`generate:${clientIp(req)}`, 3, 10 * 60_000);
  const body = await readJson(req, (b) => Body.parse(b));
  const provider = getProvider(body.provider);
  const images = await prepareImages(body.images.slice(0, provider.maxImages + 2));
  const taskId = await provider.createTask({ images, quality: body.quality });
  return { provider: provider.id, taskId, imagesUsed: Math.min(images.length, provider.maxImages), createdAt: Date.now() };
});
