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
