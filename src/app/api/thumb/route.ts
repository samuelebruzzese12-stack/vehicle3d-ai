import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { clientIp, fetchLimited, handler, rateLimit } from "@/lib/http";

export const runtime = "nodejs";

/** Miniature servite dal nostro server: decodifica reale, ridimensionamento, nessun hotlink dal browser. */
export const GET = handler(async (req) => {
  rateLimit(`thumb:${clientIp(req)}`, 200, 60_000);
  const src = new URL(req.url).searchParams.get("u");
  if (!src || src.length > 2000) throw new AppError("BAD_REQUEST", "URL mancante.");
  const { buffer } = await fetchLimited(src, { maxBytes: 12 * 1024 * 1024, timeoutMs: 15000 });
  let out: Buffer;
  try {
    out = await sharp(buffer, { failOn: "error" }).rotate().resize(480, 360, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
  } catch {
    throw new AppError("INVALID_IMAGE", "Immagine non valida.");
  }
  return new Response(new Uint8Array(out), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable" },
  });
});
