import "server-only";
import { env } from "../env";
import { parseLicense } from "../licenses";
import { getJson } from "./net";
import type { ExternalModel } from "./sketchfab";

/**
 * GitHub: repository pubblici con modelli 3D o addon Bedrock.
 * Ricerca repository senza token (limite 10 richieste/minuto); GITHUB_TOKEN gratuito alza i limiti.
 * La licenza è quella dichiarata dal repository (campo SPDX). Repository senza licenza = tutti i diritti riservati → non utilizzabili.
 */
const API = "https://api.github.com";
const MODEL_EXT = /\.(glb|gltf|obj|stl|fbx|blend|zip)$/i;
const ADDON_EXT = /\.(mcaddon|mcpack)$|\.geo\.json$|models\/entity\/[^/]+\.json$/i;

function headers() {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const t = env.githubToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

interface Repo { full_name: string; html_url: string; description: string | null; default_branch: string; license: { spdx_id: string; name: string } | null; owner: { login: string; html_url: string }; size: number; stargazers_count: number }

export interface RepoAsset extends ExternalModel {
  repo: string;
  branch: string;
  path: string;
  rawUrl: string;
  kind: "modello" | "addon";
}

async function searchRepos(q: string, limit: number) {
  const r = await getJson<{ items: Repo[] }>(`${API}/search/repositories?q=${encodeURIComponent(q)}&per_page=${limit}&sort=stars`, { source: "GitHub", headers: headers() });
  return r.items;
}

async function treeFiles(repo: Repo): Promise<{ path: string; size?: number }[]> {
  if (repo.size > 400_000) return []; // repository enormi (>400 MB): non scansionati
  const r = await getJson<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `${API}/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, { source: "GitHub", headers: headers() });
  return r.tree.filter((t) => t.type === "blob");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Cerca file di modelli (kind="modello") o addon Bedrock (kind="addon") pertinenti al veicolo. */
export async function searchGithubAssets(vehicleName: string, kind: "modello" | "addon", maxRepos = 5): Promise<RepoAsset[]> {
  const queries = kind === "addon"
    ? [`${vehicleName} minecraft bedrock`, `${vehicleName} mcaddon`, `${vehicleName.split(" ").slice(-1)[0]} bedrock addon vehicle`]
    : [`${vehicleName} 3d model`, `${vehicleName} glb`, `${vehicleName} gltf`];
  const repos = new Map<string, Repo>();
  for (const q of queries) {
    for (const r of await searchRepos(q, maxRepos)) repos.set(r.full_name, r);
    if (repos.size >= maxRepos) break;
  }
  const words = norm(vehicleName).split(" ").filter((w) => w.length > 1);
  const out: RepoAsset[] = [];
  for (const repo of [...repos.values()].slice(0, maxRepos)) {
    const license = parseLicense(repo.license?.spdx_id === "NOASSERTION" ? "" : repo.license?.spdx_id ?? "");
    let files: { path: string; size?: number }[] = [];
    try { files = await treeFiles(repo); } catch { continue; }
    const re = kind === "addon" ? ADDON_EXT : MODEL_EXT;
    for (const f of files.filter((x) => re.test(x.path) && (x.size ?? 0) < 80e6)) {
      const hay = norm(`${repo.full_name} ${repo.description ?? ""} ${f.path}`);
      const relevance = words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0;
      if (relevance < 0.5) continue;
      const pageUrl = `${repo.html_url}/blob/${repo.default_branch}/${f.path}`;
      out.push({
        source: "github", kind, id: `${repo.full_name}:${f.path}`, repo: repo.full_name, branch: repo.default_branch, path: f.path,
        rawUrl: `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
        name: f.path.split("/").pop()!, author: repo.owner.login, authorUrl: repo.owner.html_url, pageUrl, license,
        formats: [{ type: f.path.split(".").pop()!.toLowerCase(), size: f.size }], downloadable: true, relevance,
        credit: { title: `${repo.full_name}/${f.path}`, author: repo.owner.login, sourceName: "GitHub", sourceUrl: pageUrl, license, usage: kind === "addon" ? "addon" : "modello" },
      });
    }
  }
  return out.sort((a, b) => b.relevance - a.relevance);
}
