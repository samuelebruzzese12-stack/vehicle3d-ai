import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
import { decodeDataUri, normalizeImage } from "./images";
import type { ProviderImage } from "./providers/types";
import { downloadReference } from "./search/verify";
import { VIEWS } from "./types";

export const ImageInput = z.object({
  view: z.enum(VIEWS),
  dataUri: z.string().max(12_000_000).optional(),
  url: z.string().url().max(2000).optional(),
});

/** Converte ogni immagine in JPEG validato (data URI): il provider riceve solo immagini verificate dal server. */
export async function prepareImages(list: z.infer<typeof ImageInput>[]): Promise<ProviderImage[]> {
  const out: ProviderImage[] = [];
  for (const it of list) {
    if (it.dataUri) {
      const img = await normalizeImage(decodeDataUri(it.dataUri), 1600);
      out.push({ view: it.view, dataUri: img.dataUri });
    } else if (it.url) {
      const d = await downloadReference({ id: "x", source: "upload", imageUrl: it.url, thumbUrl: it.url, title: "", queryView: it.view });
      if (!d.jpeg) throw new AppError("INVALID_IMAGE", `Riferimento non scaricabile: ${d.error}`);
      out.push({ view: it.view, dataUri: `data:image/jpeg;base64,${d.jpeg.toString("base64")}` });
    }
  }
  if (!out.length) throw new AppError("BAD_REQUEST", "Nessuna immagine valida.");
  return out;
}
