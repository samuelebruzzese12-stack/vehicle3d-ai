import { z } from "zod";
import { clientIp, handler, rateLimit, readJson, requireAccess } from "@/lib/http";
import { decodeDataUri, normalizeImage } from "@/lib/images";
import { identifyVehicle } from "@/lib/vehicle/identify";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ image: z.string().max(12_000_000) });

export const POST = handler(async (req) => {
  requireAccess(req);
  rateLimit(`identify:${clientIp(req)}`, 10, 60_000);
  const { image } = await readJson(req, (b) => Body.parse(b));
  const img = await normalizeImage(decodeDataUri(image), 1568);
  const result = await identifyVehicle(img.jpeg.toString("base64"));
  return { vehicle: result, image: { width: img.width, height: img.height } };
});
