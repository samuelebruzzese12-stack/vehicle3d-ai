// Ricerca reale di modelli 3D e addon per un veicolo (motori C e D).
import { searchExternalModels, searchMinecraftAddons } from "../src/lib/engines/acquire";
const name = process.argv[2] ?? "T-90";
for (const [label, fn] of [["C", searchExternalModels], ["D", searchMinecraftAddons]] as const) {
  const r = await fn(name, false);
  console.log(`== Motore ${label} per "${name}"`);
  for (const s of r.summary) console.log(`  fonte ${s.source}: ${s.ok ? `${s.count} risultati` : `ERRORE ${s.message}`}`);
  for (const c of r.candidates.slice(0, 6)) console.log(`  ${c.usable ? "OK " : "NO "} ${c.source} "${c.name}" – ${c.author} – ${c.license.label} – pertinenza ${c.relevance.toFixed(2)}${c.blockedReason ? ` – ${c.blockedReason.slice(0, 90)}` : ""}`);
}
