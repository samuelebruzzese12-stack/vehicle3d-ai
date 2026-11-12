import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { AppError } from "../errors";
import type { ReferenceCandidate, VehicleInput, View } from "../types";

const UA = "Vehicle3D-AI/1.0 (https://github.com/samuelebruzzese12-stack/vehicle3d-ai)";

export const SEARCH_VIEWS: { view: View; terms: string[] }[] = [
  { view: "front", terms: ["front"] },
  { view: "rear", terms: ["rear"] },
  { view: "left", terms: ["side", "profile"] },
  { view: "front_three_quarter", terms: ["front three quarter"] },
  { view: "rear_three_quarter", terms: ["rear three quarter"] },
  { view: "top", terms: ["top view", "aerial"] },
  { view: "interior", terms: ["interior"] },
  { view: "dashboard", terms: ["dashboard"] },
];

const id = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

function baseQuery(v: VehicleInput) {
  return [v.make, v.model, v.year ? String(v.year) : ""].filter(Boolean).join(" ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}, attempt = 0): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: ctrl.signal });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 2) * 1000, 5000);
      clearTimeout(t);
      await sleep(wait);
      return getJson(url, headers, attempt + 1);
    }
    if (res.status === 429) throw new AppError("PROVIDER_RATE_LIMIT", "Limite del motore di ricerca immagini raggiunto.");
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `Ricerca immagini fallita (${res.status}).`);
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UPSTREAM_TIMEOUT", "Motore di ricerca immagini non raggiungibile.");
  } finally {
    clearTimeout(t);
  }
}

const stripHtml = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/* ---------------- Wikimedia Commons (nessuna chiave) ---------------- */
export async function searchWikimedia(q: string, view: View, limit = 8): Promise<ReferenceCandidate[]> {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1600",
    origin: "*",
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`);
  const pages = ((data.query as { pages?: unknown[] })?.pages ?? []) as {
    title: string;
    index?: number;
    imageinfo?: { url: string; thumburl?: string; width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[];
  }[];
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((pg) => {
      const ii = pg.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return [];
      if (Math.min(ii.width, ii.height) < 400) return [];
      const thumb = ii.thumburl ?? ii.url;
      return [{
        id: id(ii.url),
        source: "wikimedia" as const,
        imageUrl: thumb,
        thumbUrl: thumb.replace(/\/\d+px-/, "/400px-"),
        pageUrl: ii.descriptionurl,
        title: pg.title.replace(/^File:/, ""),
        width: ii.width,
        height: ii.height,
        license: stripHtml(ii.extmetadata?.LicenseShortName?.value),
        author: stripHtml(ii.extmetadata?.Artist?.value).slice(0, 120),
        queryView: view,
      }];
    });
}

/* ---------------- Brave Image Search ---------------- */
export async function searchBrave(q: string, view: View, limit = 8): Promise<ReferenceCandidate[]> {
  const key = env.braveKey();
  if (!key) return [];
  const p = new URLSearchParams({ q, count: String(limit), safesearch: "strict" });
  const data = await getJson(`https://api.search.brave.com/res/v1/images/search?${p}`, { "X-Subscription-Token": key });
  const results = (data.results ?? []) as { title?: string; url?: string; source?: string; properties?: { url?: string; width?: number; height?: number }; thumbnail?: { src?: string } }[];
  return results.flatMap((r) => {
    const img = r.properties?.url;
    if (!img || !img.startsWith("https://")) return [];
    return [{ id: id(img), source: "brave" as const, imageUrl: img, thumbUrl: r.thumbnail?.src ?? img, pageUrl: r.url, title: r.title ?? "", width: r.properties?.width, height: r.properties?.height, license: "Sconosciuta (verificare i diritti)", author: r.source, queryView: view }];
  });
}

/* ---------------- Google Programmable Search ---------------- */
export async function searchGoogle(q: string, view: View, limit = 8): Promise<ReferenceCandidate[]> {
  const key = env.googleKey(), cx = env.googleCx();
  if (!key || !cx) return [];
  const p = new URLSearchParams({ key, cx, q, searchType: "image", num: String(Math.min(limit, 10)), safe: "active", imgSize: "large" });
  const data = await getJson(`https://www.googleapis.com/customsearch/v1?${p}`);
  const items = (data.items ?? []) as { title?: string; link?: string; image?: { contextLink?: string; thumbnailLink?: string; width?: number; height?: number } }[];
  return items.flatMap((r) => {
    if (!r.link?.startsWith("https://")) return [];
    return [{ id: id(r.link), source: "google" as const, imageUrl: r.link, thumbUrl: r.image?.thumbnailLink ?? r.link, pageUrl: r.image?.contextLink, title: r.title ?? "", width: r.image?.width, height: r.image?.height, license: "Sconosciuta (verificare i diritti)", queryView: view }];
  });
}

export interface SearchResult {
  candidates: ReferenceCandidate[];
  sources: { name: string; used: boolean; error?: string }[];
}

export async function searchReferences(v: VehicleInput, perView = 6): Promise<SearchResult> {
  const base = baseQuery(v);
  const engines: { name: string; enabled: boolean; fn: typeof searchWikimedia }[] = [
    { name: "wikimedia", enabled: true, fn: searchWikimedia },
    { name: "brave", enabled: Boolean(env.braveKey()), fn: searchBrave },
    { name: "google", enabled: Boolean(env.googleKey() && env.googleCx()), fn: searchGoogle },
  ];
  const sources: SearchResult["sources"] = [];
  const all: ReferenceCandidate[] = [];
  for (const eng of engines) {
    if (!eng.enabled) {
      sources.push({ name: eng.name, used: false });
      continue;
    }
    // Richieste sequenziali: rispetta i limiti delle API (Wikimedia chiede di non parallelizzare).
    const settled: PromiseSettledResult<ReferenceCandidate[]>[] = [];
    for (const { view, terms } of SEARCH_VIEWS) {
      try {
        settled.push({ status: "fulfilled", value: await eng.fn(`${base} ${terms[0]}`, view, perView) });
      } catch (reason) {
        settled.push({ status: "rejected", reason });
      }
    }
    const errors = settled.filter((s) => s.status === "rejected").map((s) => ((s as PromiseRejectedResult).reason as Error).message);
    settled.forEach((s) => s.status === "fulfilled" && all.push(...s.value));
    sources.push({ name: eng.name, used: true, error: errors.length === settled.length ? errors[0] : undefined });
  }
  // Fallback Wikimedia: se la query con anno non restituisce nulla, riprova senza anno.
  if (all.length === 0 && v.year) {
    for (const { view, terms } of SEARCH_VIEWS) {
      try {
        all.push(...(await searchWikimedia(`${v.make} ${v.model} ${terms[0]}`, view, perView)));
      } catch {
        /* già segnalato sopra */
      }
    }
  }
  const seen = new Set<string>();
  const candidates = all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return { candidates, sources };
}
