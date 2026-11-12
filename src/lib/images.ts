import "server-only";
import sharp from "sharp";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MIN_SIDE = 256;

export interface NormalizedImage {
  jpeg: Buffer;
  width: number;
  height: number;
  dataUri: string;
}

/** Decodifica davvero l'immagine (non si fida del MIME), ruota secondo EXIF, ridimensiona e ricodifica in JPEG. */
export async function normalizeImage(input: Buffer, maxSide = 1600): Promise<NormalizedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new AppError("INVALID_IMAGE", "Il file non è un'immagine valida.");
  }
  if (!meta.width || !meta.height) throw new AppError("INVALID_IMAGE", "Dimensioni immagine non leggibili.");
  if (Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new AppError("INVALID_IMAGE", `Immagine troppo piccola (${meta.width}×${meta.height}). Minimo ${MIN_SIDE}px per lato.`);
  }
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height, dataUri: `data:image/jpeg;base64,${data.toString("base64")}` };
}

export function decodeDataUri(uri: string): Buffer {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (!m) throw new AppError("INVALID_IMAGE", "Formato immagine non riconosciuto (atteso data URI base64).");
  const buf = Buffer.from(m[1], "base64");
  if (buf.byteLength > MAX_UPLOAD_BYTES) throw new AppError("INVALID_IMAGE", "Immagine troppo grande (max 8 MB).");
  return buf;
}

/** Colori dominanti (per l'abitacolo): media su zona centrale, ignorando pixel quasi bianchi/neri estremi. */
export async function dominantColor(jpeg: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 16; y < 48; y++) {
    for (let x = 8; x < 56; x++) {
      const i = (y * info.width + x) * 3;
      const s = data[i] + data[i + 1] + data[i + 2];
      if (s < 30 || s > 720) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  if (n === 0) return [60, 60, 60];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
