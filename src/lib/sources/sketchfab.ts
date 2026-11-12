import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import { parseLicense, type Credit, type LicenseInfo } from "../licenses";
import { getJson } from "./net";

/**
 * Sketchfab Data API v3.
 * - Ricerca: pubblica, senza autenticazione.
 * - Download: richiede il token API di un account (anche gratuito). Solo modelli con isDownloadable=true.
 * I modelli a pagamento del negozio non vengono mai acquistati né scaricati.
 */
const API = "https://api.sketchfab.com/v3";

export interface ExternalModel {
  source: "sketchfab" | "github";
  id: string;
  name: string;
  author: string;
  authorUrl?: string;
  pageUrl: string;
  thumbnail?: string;
  license: LicenseInfo;
  faces?: number;
  /** formati disponibili e dimensione in byte */
  formats: { type: string; size?: number }[];
  downloadable: boolean;
  /** pertinenza rispetto alla query (0-1) */
  relevance: number;
  credit: Credit;
}

interface SfModel {
  uid: string; name: string; viewerUrl: string; faceCount: number; isDownloadable: boolean;
  license?: { label: string; slug?: string } | null;
  user: { displayName: string; username: string; profileUrl: string };
  thumbnails?: { images: { url: string; width: number }[] };
  archives?: Record<string, { size?: number } | null>;
  tags?: { name: string }[];
}

function relevance(name: string, tags: string[], query: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = norm(query).split(" ").filter(Boolean);
  const hay = norm(`${name} ${tags.join(" ")}`);
  const hit = q.filter((w) => hay.includes(w)).length;
  return q.length ? hit / q.length : 0;
}

export async function searchSketchfab(query: string, limit = 12): Promise<ExternalModel[]> {
  const p = new URLSearchParams({ type: "models", q: query, downloadable: "true", count: String(Math.min(limit, 24)), sort_by: "-likeCount" });
  // nessun header Authorization: la ricerca è pubblica
  const r = await getJson<{ results: SfModel[] }>(`${API}/search?${p}`, { source: "Sketchfab" });
  return r.results.map((m) => {
    const license = parseLicense(m.license?.slug ?? m.license?.label ?? "");
    const thumbs = (m.thumbnails?.images ?? []).sort((a, b) => Math.abs(a.width - 480) - Math.abs(b.width - 480));
    const pageUrl = m.viewerUrl;
    return {
      source: "sketchfab" as const,
      id: m.uid,
      name: m.name,
      author: m.user.displayName || m.user.username,
      authorUrl: m.user.profileUrl,
      pageUrl,
      thumbnail: thumbs[0]?.url,
      license,
      faces: m.faceCount,
      formats: Object.entries(m.archives ?? {}).filter(([, v]) => v).map(([type, v]) => ({ type, size: v?.size })),
      downloadable: m.isDownloadable,
      relevance: relevance(m.name, (m.tags ?? []).map((t) => t.name), query),
      credit: { title: m.name, author: m.user.displayName || m.user.username, sourceName: "Sketchfab", sourceUrl: pageUrl, license, usage: "modello" as const },
    };
  });
}

/** URL firmati (scadono dopo pochi minuti) per scaricare il modello. Richiede SKETCHFAB_API_TOKEN. */
export async function sketchfabDownloadUrls(uid: string): Promise<Record<string, { url: string; size?: number }>> {
  const token = env.sketchfabToken();
  if (!token) throw new AppError("NOT_CONFIGURED", "Download da Sketchfab non configurato: serve SKETCHFAB_API_TOKEN (gratuito, dalle impostazioni del tuo account Sketchfab).");
  if (!/^[a-f0-9]{32}$/.test(uid)) throw new AppError("BAD_REQUEST", "ID modello Sketchfab non valido.");
  return getJson(`${API}/models/${uid}/download`, { source: "Sketchfab", headers: { Authorization: `Token ${token}` }, cache: false, retries: 1 });
}

/** Host da cui è lecito scaricare gli archivi firmati di Sketchfab. */
export const SKETCHFAB_DOWNLOAD_HOSTS = ["sketchfab-prod-media.s3.amazonaws.com", "media.sketchfab.com"];
