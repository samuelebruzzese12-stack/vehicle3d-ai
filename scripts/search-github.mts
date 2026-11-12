// Ricerca reale su GitHub di modelli 3D o addon (con licenza del repository).
import { searchGithubAssets } from "../src/lib/sources/github";
const kind = (process.argv[3] ?? "modello") as "modello" | "addon";
const r = await searchGithubAssets(process.argv[2], kind, 6);
console.log("==", process.argv[2], kind, r.length);
for (const a of r.slice(0, 6)) console.log("  ", a.license.label, a.repo, a.path, a.formats[0].size, a.relevance.toFixed(2));
