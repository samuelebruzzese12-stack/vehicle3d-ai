import "server-only";
import { AppError } from "../errors";
import { fetchLimited } from "../http";
import { checkUse, type Credit } from "../licenses";
import { importModel, type ImportedModel } from "../formats/import";
import { searchCommons3D, type Commons3D } from "../sources/commons3d";
import { searchGithubAssets, type RepoAsset } from "../sources/github";
import { searchSketchfab, sketchfabDownloadUrls, SKETCHFAB_DOWNLOAD_HOSTS, type ExternalModel } from "../sources/sketchfab";

export type Candidate = (ExternalModel | RepoAsset | Commons3D) & { usable: boolean; blockedReason?: string };

const hostOk = (url: string, hosts: string[]) => { const h = new URL(url).hostname; return hosts.some((x) => h === x || h.endsWith(`.${x}`)); };

/** Valuta se una risorsa è riutilizzabile per l'intento dell'utente. */
export function judge<T extends { credit: Credit; downloadable: boolean }>(m: T, commercial: boolean): T & { usable: boolean; blockedReason?: string } {
  const c = checkUse([m.credit], { commercial });
  if (!m.downloadable) return { ...m, usable: false, blockedReason: "non scaricabile" };
  return { ...m, usable: c.allowed, blockedReason: c.allowed ? undefined : c.blocked.join(" ") };
}

export interface SearchSummary { source: string; ok: boolean; count: number; message?: string }

/** Motore C: modelli 3D esistenti (Sketchfab, Wikimedia Commons 3D, GitHub). */
export async function searchExternalModels(name: string, commercial: boolean) {
  const summary: SearchSummary[] = [];
  const all: Candidate[] = [];
  const run = async (source: string, fn: () => Promise<(ExternalModel | RepoAsset | Commons3D)[]>) => {
    try {
      const r = await fn();
      all.push(...r.map((m) => judge(m, commercial)));
      summary.push({ source, ok: true, count: r.length });
    } catch (e) {
      summary.push({ source, ok: false, count: 0, message: (e as Error).message });
    }
  };
  await run("Sketchfab", () => searchSketchfab(name, 12));
  await run("Wikimedia Commons (3D)", () => searchCommons3D(name, 8));
  await run("GitHub", () => searchGithubAssets(name, "modello", 4));
  all.sort((a, b) => Number(b.usable) - Number(a.usable) || b.relevance - a.relevance || (b.faces ?? 0) - (a.faces ?? 0));
  return { candidates: all, summary };
}

/** Motore D: addon/modelli Minecraft Bedrock esistenti con licenza esplicita. */
export async function searchMinecraftAddons(name: string, commercial: boolean) {
  const summary: SearchSummary[] = [];
  let candidates: Candidate[] = [];
  try {
    const r = await searchGithubAssets(name, "addon", 5);
    candidates = r.map((m) => judge(m, commercial));
    summary.push({ source: "GitHub (addon Bedrock)", ok: true, count: r.length });
  } catch (e) {
    summary.push({ source: "GitHub (addon Bedrock)", ok: false, count: 0, message: (e as Error).message });
  }
  summary.push({ source: "MCPEDL / CurseForge", ok: false, count: 0, message: "Non interrogati: MCPEDL non ha un'API e vieta lo scraping; CurseForge richiede una chiave approvata. Usa il link di ricerca manuale." });
  candidates.sort((a, b) => Number(b.usable) - Number(a.usable) || b.relevance - a.relevance);
  return { candidates, summary };
}

/** Scarica e converte un candidato in GLB (solo se la licenza lo consente). */
export async function downloadCandidate(c: Candidate, commercial: boolean): Promise<ImportedModel & { credit: Credit }> {
  const j = judge(c, commercial);
  if (!j.usable) throw new AppError("LICENSE_BLOCKED", `"${c.name}" non è utilizzabile: ${j.blockedReason}`);
  let data: Buffer, fileName = c.name;
  if (c.source === "sketchfab") {
    const urls = await sketchfabDownloadUrls(c.id);
    const pick = urls.glb ?? urls.gltf;
    if (!pick) throw new AppError("NOT_FOUND", "Sketchfab non offre GLB/glTF per questo modello.");
    if (!hostOk(pick.url, SKETCHFAB_DOWNLOAD_HOSTS) && !new URL(pick.url).hostname.endsWith(".amazonaws.com")) throw new AppError("PROVIDER_ERROR", "Host di download Sketchfab inatteso.");
    data = (await fetchLimited(pick.url, { maxBytes: 250e6, timeoutMs: 180_000 })).buffer;
    fileName = urls.glb ? "model.glb" : "model.zip";
  } else if ("fileUrl" in c) {
    if (!hostOk(c.fileUrl, ["upload.wikimedia.org"])) throw new AppError("PROVIDER_ERROR", "Host inatteso.");
    data = (await fetchLimited(c.fileUrl, { maxBytes: 100e6, timeoutMs: 120_000 })).buffer;
  } else if ("rawUrl" in c) {
    const isArchiveFolder = /\.geo\.json$|models\/entity\//i.test(c.path);
    if (isArchiveFolder) {
      // geometria sciolta in un repository: serve anche la texture → archivio del repository
      const url = `https://codeload.github.com/${c.repo}/zip/refs/heads/${encodeURIComponent(c.branch)}`;
      data = (await fetchLimited(url, { maxBytes: 80e6, timeoutMs: 120_000 })).buffer;
      fileName = "repo.zip";
    } else {
      if (!hostOk(c.rawUrl, ["raw.githubusercontent.com"])) throw new AppError("PROVIDER_ERROR", "Host inatteso.");
      data = (await fetchLimited(c.rawUrl, { maxBytes: 100e6, timeoutMs: 120_000 })).buffer;
    }
  } else throw new AppError("BAD_REQUEST", "Fonte non supportata.");
  const imported = await importModel(new Uint8Array(data), fileName);
  return { ...imported, credit: c.credit };
}

/**
 * Riverifica alla fonte un candidato ricevuto dal client (licenza, autore, scaricabilità):
 * il client non può dichiarare una licenza diversa da quella reale.
 */
export async function revalidateCandidate(id: string, source: string, commercial: boolean): Promise<Candidate> {
  const { getJson } = await import("../sources/net");
  const { parseLicense } = await import("../licenses");
  if (source === "sketchfab") {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new AppError("BAD_REQUEST", "ID non valido.");
    const m = await getJson<{ uid: string; name: string; viewerUrl: string; isDownloadable: boolean; faceCount: number; license?: { label: string; slug?: string } | null; user: { displayName: string; username: string; profileUrl: string } }>(`https://api.sketchfab.com/v3/models/${id}`, { source: "Sketchfab" });
    const license = parseLicense(m.license?.slug ?? m.license?.label ?? "");
    const author = m.user.displayName || m.user.username;
    return judge<ExternalModel>({ source: "sketchfab", id: m.uid, name: m.name, author, authorUrl: m.user.profileUrl, pageUrl: m.viewerUrl, license, faces: m.faceCount, formats: [], downloadable: m.isDownloadable, relevance: 1,
      credit: { title: m.name, author, sourceName: "Sketchfab", sourceUrl: m.viewerUrl, license, usage: "modello" } }, commercial);
  }
  if (source === "commons") {
    const name = id.replace(/^commons:/, "");
    const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: `File:${name}`, prop: "imageinfo", iiprop: "url|size|extmetadata", iiextmetadatafilter: "LicenseShortName|Artist" });
    const r = await getJson<{ query: { pages: { imageinfo?: { url: string; size: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(`https://commons.wikimedia.org/w/api.php?${p}`, { source: "Wikimedia Commons" });
    const ii = r.query.pages[0]?.imageinfo?.[0];
    if (!ii) throw new AppError("NOT_FOUND", "File non trovato su Commons.");
    const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
    const license = parseLicense(strip(ii.extmetadata?.LicenseShortName?.value));
    const author = strip(ii.extmetadata?.Artist?.value).slice(0, 120);
    return judge({ source: "github" as const, id, name, author, pageUrl: ii.descriptionurl, license, fileUrl: ii.url, formats: [{ type: "stl", size: ii.size }], downloadable: true, relevance: 1,
      credit: { title: name, author, sourceName: "Wikimedia Commons", sourceUrl: ii.descriptionurl, license, usage: "modello" as const } }, commercial);
  }
  if (source === "github") {
    const m = /^([\w.-]+\/[\w.-]+):(.+)$/.exec(id);
    if (!m) throw new AppError("BAD_REQUEST", "ID non valido.");
    const repo = await getJson<{ full_name: string; html_url: string; default_branch: string; license: { spdx_id: string } | null; owner: { login: string; html_url: string } }>(`https://api.github.com/repos/${m[1]}`, { source: "GitHub" });
    const license = parseLicense(repo.license?.spdx_id === "NOASSERTION" ? "" : repo.license?.spdx_id ?? "");
    const p = m[2];
    const kind = /\.(mcaddon|mcpack)$|\.geo\.json$|models\/entity\//i.test(p) ? "addon" : "modello";
    const pageUrl = `${repo.html_url}/blob/${repo.default_branch}/${p}`;
    return judge({ source: "github" as const, kind, id, repo: repo.full_name, branch: repo.default_branch, path: p, name: p.split("/").pop()!, author: repo.owner.login, authorUrl: repo.owner.html_url, pageUrl, license,
      rawUrl: `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/${p.split("/").map(encodeURIComponent).join("/")}`,
      formats: [{ type: p.split(".").pop()!.toLowerCase() }], downloadable: true, relevance: 1,
      credit: { title: `${repo.full_name}/${p}`, author: repo.owner.login, sourceName: "GitHub", sourceUrl: pageUrl, license, usage: kind } } as RepoAsset, commercial);
  }
  throw new AppError("BAD_REQUEST", "Fonte sconosciuta.");
}

/** Licenze reali (da Commons) delle immagini scelte come riferimento per l'AI. */
export async function commonsImageCredits(titles: string[]) {
  const { getJson } = await import("../sources/net");
  const { parseLicense } = await import("../licenses");
  if (!titles.length) return new Map<string, Credit & { url: string }>();
  const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: titles.map((t) => `File:${t}`).join("|"), prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist" });
  const r = await getJson<{ query: { pages: { title: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(`https://commons.wikimedia.org/w/api.php?${p}`, { source: "Wikimedia Commons" });
  const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
  const out = new Map<string, Credit & { url: string }>();
  for (const pg of r.query.pages) {
    const ii = pg.imageinfo?.[0];
    if (!ii) continue;
    const title = pg.title.replace(/^File:/, "");
    out.set(title, { title, author: strip(ii.extmetadata?.Artist?.value).slice(0, 120), sourceName: "Wikimedia Commons", sourceUrl: ii.descriptionurl, license: parseLicense(strip(ii.extmetadata?.LicenseShortName?.value)), usage: "riferimento-ai", url: ii.thumburl ?? ii.url });
  }
  return out;
}
