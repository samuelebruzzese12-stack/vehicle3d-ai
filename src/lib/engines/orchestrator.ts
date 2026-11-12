import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import { importModel } from "../formats/import";
import { checkUse, type Credit } from "../licenses";
import { blenderPreprocess } from "../mesh/blender";
import type { BedrockGeometry } from "../minecraft/bedrock-import";
import type { EngineId, EnginePath } from "../pipeline";
import { generateAi } from "./ai";
import { downloadCandidate, searchExternalModels, searchMinecraftAddons, type Candidate } from "./acquire";

export type EngineMode = "auto" | EngineId;

export const ENGINE_LABELS: Record<EngineId, string> = {
  A: "Generazione AI open source",
  B: "Elaborazione Blender di un file",
  C: "Modello 3D esistente",
  D: "Addon Minecraft esistente",
  upload: "File caricato",
};

export interface AcquireRequest {
  name: string;
  mode: EngineMode;
  commercial: boolean;
  /** immagini di riferimento (JPEG) per il motore A, con i loro crediti */
  aiImages: { jpeg: Buffer; credit: Credit }[];
  /** candidato scelto manualmente (C o D) */
  candidate?: Candidate;
  /** file caricato dall'utente (motore B) */
  upload?: { data: Uint8Array; name: string };
  onStatus?: (s: string) => void;
}

export interface Acquired {
  glb: Uint8Array;
  bedrock?: { geometry: BedrockGeometry; texture: Uint8Array };
  credits: Credit[];
  path: EnginePath;
  notes: string[];
}

/**
 * Strategia: C (modello esistente con licenza compatibile) → D (addon Minecraft) → A (generazione AI).
 * Ogni passaggio fallito viene registrato e si prova l'alternativa gratuita successiva.
 */
export async function acquire(req: AcquireRequest): Promise<Acquired> {
  const attempts: EnginePath["attempts"] = [];
  const status = req.onStatus ?? (() => {});
  const note = (engine: EngineId, ok: boolean, message: string) => attempts.push({ engine, label: ENGINE_LABELS[engine], ok, message });

  const tryCandidate = async (engine: "C" | "D", c: Candidate): Promise<Acquired | null> => {
    try {
      status(`${ENGINE_LABELS[engine]}: scarico "${c.name}"`);
      const m = await downloadCandidate(c, req.commercial);
      note(engine, true, `"${c.name}" di ${c.author} (${c.license.label}) – ${c.pageUrl}`);
      const bedrock = engine === "D" && m.bedrock?.texture ? { geometry: m.bedrock.geometry as BedrockGeometry, texture: m.bedrock.texture } : undefined;
      return { glb: m.glb, bedrock, credits: [m.credit], path: { engine, label: ENGINE_LABELS[engine], attempts }, notes: m.notes };
    } catch (e) {
      note(engine, false, `"${c.name}": ${(e as Error).message}`);
      return null;
    }
  };

  // scelta manuale di un candidato specifico
  if (req.candidate) {
    const engine = req.candidate.credit.usage === "addon" ? "D" : "C";
    const r = await tryCandidate(engine, req.candidate);
    if (r) return r;
    throw new AppError("PROVIDER_ERROR", attempts.at(-1)!.message, attempts);
  }

  if (req.mode === "B" || req.mode === "upload") {
    if (!req.upload) throw new AppError("BAD_REQUEST", "Carica un file (GLB, glTF zip, OBJ, STL, FBX, BLEND).");
    const imported = await importModel(req.upload.data, req.upload.name);
    let glb = imported.glb;
    const notes = [...imported.notes];
    if (req.mode === "B") {
      if (!env.blenderWorkerUrl()) throw new AppError("NOT_CONFIGURED", "Il motore B richiede il worker Blender (BLENDER_WORKER_URL).");
      const b = await blenderPreprocess(glb, 300000);
      if (b) { glb = b.glb; notes.push(`Blender ${b.report.blender}: ${b.report.triangles_after} triangoli.`); }
    }
    note(req.mode, true, `file "${req.upload.name}" (${imported.format})`);
    return { glb, credits: [], path: { engine: req.mode, label: ENGINE_LABELS[req.mode], attempts }, notes };
  }

  if (req.mode === "auto" || req.mode === "C") {
    status("Ricerca di modelli 3D esistenti");
    const { candidates, summary } = await searchExternalModels(req.name, req.commercial);
    summary.filter((s) => !s.ok).forEach((s) => note("C", false, `${s.source}: ${s.message}`));
    const usable = candidates.filter((c) => c.usable && c.relevance >= 0.6).slice(0, 3);
    if (!usable.length) note("C", false, `nessun modello pertinente con licenza compatibile (${candidates.length} trovati, ${candidates.filter((c) => !c.usable).length} esclusi per licenza o download)`);
    for (const c of usable) {
      const r = await tryCandidate("C", c);
      if (r) return r;
    }
    if (req.mode === "C") throw new AppError("NOT_FOUND", "Nessun modello 3D esistente utilizzabile.", attempts);
  }

  if (req.mode === "auto" || req.mode === "D") {
    status("Ricerca di addon Minecraft esistenti");
    const { candidates, summary } = await searchMinecraftAddons(req.name, req.commercial);
    summary.filter((s) => !s.ok && s.source.startsWith("GitHub")).forEach((s) => note("D", false, `${s.source}: ${s.message}`));
    const usable = candidates.filter((c) => c.usable && c.relevance >= 0.6).slice(0, 2);
    if (!usable.length) note("D", false, `nessun addon pertinente con licenza esplicita (${candidates.length} trovati)`);
    for (const c of usable) {
      const r = await tryCandidate("D", c);
      if (r) return r;
    }
    if (req.mode === "D") throw new AppError("NOT_FOUND", "Nessun addon Minecraft utilizzabile.", attempts);
  }

  // A: generazione AI dalle immagini (che devono consentire opere derivate)
  if (!req.aiImages.length) {
    note("A", false, "nessuna immagine di riferimento disponibile");
    throw new AppError("NOT_FOUND", "Nessun percorso ha prodotto un modello: servono immagini per la generazione AI.", attempts);
  }
  const okImages = req.aiImages.filter((i) => checkUse([i.credit], { commercial: req.commercial }).allowed);
  if (!okImages.length) {
    note("A", false, "le immagini disponibili non consentono opere derivate");
    throw new AppError("LICENSE_BLOCKED", "Le licenze delle immagini non consentono la generazione di un modello derivato.", attempts);
  }
  try {
    const r = await generateAi(okImages.slice(0, 4).map((i) => i.jpeg), { onStatus: status });
    r.attempts.forEach((a) => note("A", a.ok, `${a.model} (${a.backend}): ${a.message} in ${(a.ms / 1000).toFixed(0)} s`));
    const modelCredit: Credit = { title: `Generato con ${r.model.name}`, sourceName: r.backend, sourceUrl: r.model.licenseUrl, license: { id: "mit", label: r.model.license, policy: { derivatives: true, commercial: true, attribution: false, shareAlike: false, redistribution: true } }, usage: "documentazione" };
    return { glb: r.glb, credits: [...okImages.slice(0, 4).map((i) => i.credit), modelCredit], path: { engine: "A", label: `${ENGINE_LABELS.A} – ${r.model.name}`, attempts }, notes: [] };
  } catch (e) {
    if ((e as AppError).details) ((e as AppError).details as { model: string; backend: string; message: string }[]).forEach((a) => note("A", false, `${a.model} (${a.backend}): ${a.message}`));
    else note("A", false, (e as Error).message);
    throw new AppError("PROVIDER_ERROR", "Tutti i percorsi gratuiti sono falliti. Dettagli nel percorso.", attempts);
  }
}
