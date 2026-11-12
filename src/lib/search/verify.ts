import "server-only";
import { fetchLimited } from "../http";
import { normalizeImage } from "../images";
import type { ReferenceCandidate, VerifiedReference } from "../types";

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

export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
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

export async function verifyReferences(candidates: ReferenceCandidate[]) {
  const downloaded = await pool(candidates, 4, (c) => downloadReference(c));
  const references: VerifiedReference[] = downloaded.map((d) => ({
    ...d.candidate,
    ok: Boolean(d.jpeg),
    problem: d.error,
    width: d.width ?? d.candidate.width,
    height: d.height ?? d.candidate.height,
    view: d.candidate.queryView,
    matches: null,
    quality: null,
    verifiedBy: "none",
  }));
  return { references };
}
