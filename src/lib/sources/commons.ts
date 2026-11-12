import "server-only";
import { createHash } from "node:crypto";
import { parseLicense } from "../licenses";
import type { ReferenceCandidate, View } from "../types";
import { getJson } from "./net";

const API = "https://commons.wikimedia.org/w/api.php";
const id = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Deduce la vista dal nome del file o della categoria (più lingue). */
export function inferView(text: string): View | null {
  const t = text.toLowerCase().replace(/[_-]/g, " ");
  if (/interior|innenraum|intérieur|interni|cockpit|cabin|abitacolo|seats?\b|sedili|inside/.test(t)) return /dash|instrument|armatur|plancia|cockpit/.test(t) ? "dashboard" : "interior";
  if (/dashboard|instrument panel|armaturenbrett|plancia|tableau de bord/.test(t)) return "dashboard";
  if (/aerial|top view|from above|overhead|vue de dessus|draufsicht/.test(t)) return "top";
  const front = /\bfront\b|vorne|avant|anteriore|frontal|frontansicht|\bfl\b|\bfr\b/.test(t);
  const rear = /\brear\b|\bback\b|heck|arrière|posteriore|hinten|\brl\b|\brr\b/.test(t);
  const three = /three quarter|3\/4|3 4\b|quarter|left front|right front|front left|front right|rear left|rear right/.test(t);
  if (front && three) return "front_three_quarter";
  if (rear && three) return "rear_three_quarter";
  if (front) return "front";
  if (rear) return "rear";
  if (/\bside\b|profile|profil|seitenansicht|laterale|lato/.test(t)) return "left";
  return null;
}

interface Page {
  title: string;
  imageinfo?: { url: string; thumburl?: string; width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[];
}

function toCandidate(pg: Page, fallbackView: View, context: string): ReferenceCandidate | null {
  const ii = pg.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || Math.min(ii.width, ii.height) < 400) return null;
  const thumb = ii.thumburl ?? ii.url;
  const name = pg.title.replace(/^File:/, "");
  const lic = parseLicense(strip(ii.extmetadata?.LicenseShortName?.value));
  return {
    id: id(ii.url),
    source: "wikimedia",
    imageUrl: thumb,
    // 500px è una dimensione standard di Wikimedia (altre restituiscono 400/429)
    thumbUrl: thumb.replace(/\/\d+px-/, "/500px-"),
    pageUrl: ii.descriptionurl,
    title: name,
    width: ii.width,
    height: ii.height,
    license: lic.label,
    licenseId: lic.id,
    author: strip(ii.extmetadata?.Artist?.value).slice(0, 120),
    queryView: inferView(`${name} ${context}`) ?? fallbackView,
  };
}

const IMAGE_PROPS = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist" };

/** File di una categoria Commons (e delle sottocategorie di primo livello pertinenti). */
export async function commonsCategoryImages(category: string, maxFiles = 60): Promise<ReferenceCandidate[]> {
  const out: ReferenceCandidate[] = [];
  const cats: { name: string; depth: number }[] = [{ name: category, depth: 0 }];
  const seen = new Set<string>();
  while (cats.length && out.length < maxFiles) {
    const { name, depth } = cats.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const p = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", generator: "categorymembers",
      gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "40", ...IMAGE_PROPS,
    });
    const r = await getJson<{ query?: { pages?: Page[] } }>(`${API}?${p}`, { source: "Wikimedia Commons" });
    for (const pg of r.query?.pages ?? []) {
      const c = toCandidate(pg, "front_three_quarter", name);
      if (c) out.push(c);
    }
    if (depth === 0) {
      const sp = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "categorymembers", cmtitle: `Category:${name}`, cmtype: "subcat", cmlimit: "50" });
      const subs = await getJson<{ query?: { categorymembers?: { title: string }[] } }>(`${API}?${sp}`, { source: "Wikimedia Commons" });
      // privilegia sottocategorie con viste e interni, poi le altre
      const list = (subs.query?.categorymembers ?? []).map((m) => m.title.replace(/^Category:/, ""));
      list.sort((a, b) => Number(Boolean(inferView(b))) - Number(Boolean(inferView(a))));
      for (const s of list.slice(0, 8)) cats.push({ name: s, depth: 1 });
    }
  }
  const dedup = new Map(out.map((c) => [c.id, c]));
  return [...dedup.values()].slice(0, maxFiles);
}

/** Ricerca testuale su Commons (fallback quando non c'è una categoria). */
export async function commonsSearch(q: string, view: View, limit = 8): Promise<ReferenceCandidate[]> {
  const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: String(limit), ...IMAGE_PROPS });
  const r = await getJson<{ query?: { pages?: (Page & { index?: number })[] } }>(`${API}?${p}`, { source: "Wikimedia Commons" });
  return (r.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((pg) => toCandidate(pg, view, q)).filter((c): c is ReferenceCandidate => Boolean(c));
}
