"use client";
import { useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import type { PipelineResult, Status, WizardState } from "@/lib/client/state";
import type { CamoKind } from "@/lib/materials/camo";
import type { Quality } from "@/lib/types";
import { Alert, Section, Spinner } from "../ui";

const ENGINES = [
  { id: "auto", title: "Automatico", desc: "Prima un modello 3D esistente con licenza compatibile, poi un addon Minecraft, infine la generazione AI. Ogni tentativo è registrato." },
  { id: "C", title: "C · Modello 3D esistente", desc: "Usa il modello scelto al passo precedente (o il migliore trovato)." },
  { id: "D", title: "D · Addon Minecraft esistente", desc: "Riusa geometria e texture di un addon con licenza esplicita, mantenendo i crediti." },
  { id: "A", title: "A · Generazione AI open source", desc: "TRELLIS / TRELLIS.2 (MIT) su Spaces gratuiti o worker proprio. Usa la tua foto e i riferimenti scelti." },
  { id: "B", title: "B · Elabora un file con Blender", desc: "Carica GLB, glTF (zip), OBJ, STL, FBX o BLEND: pulizia e ottimizzazione nel worker Blender." },
  { id: "upload", title: "Converti un mio file", desc: "Come B ma senza Blender: GLB, glTF (zip), OBJ, STL, MCADDON/MCPACK." },
] as const;

const STAGES = ["Acquisizione del modello", "Normalizzazione e scala reale", "Ottimizzazione", "Separazione componenti", "Abitacolo e materiali", "Voxelizzazione Minecraft", "Esportazione GLB / OBJ / MCADDON", "Verifica e licenze"];

export function StepBuild({ state, status, update, onBack, onDone }: { state: WizardState; status?: Status; update: (p: Partial<WizardState>) => void; onBack: () => void; onDone: (r: PipelineResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<{ message: string; attempts?: { label: string; ok: boolean; message: string }[] }>();
  const [file, setFile] = useState<File | null>(null);
  const needsFile = state.mode === "B" || state.mode === "upload";
  const engineAvailable = (id: string) => id !== "B" || status?.engines.B.available;

  async function build() {
    setBusy(true); setError(undefined); setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), state.mode === "A" || state.mode === "auto" ? 15000 : 4000);
    try {
      const fd = new FormData();
      fd.append("request", JSON.stringify({
        name: state.vehicle!.label, vehicle: state.vehicleInput, mode: state.mode, quality: state.quality, orientation: state.orientation, commercial: state.commercial,
        livery: state.livery, candidate: state.mode === "C" || state.mode === "D" ? state.candidateId : undefined, aiImages: state.aiImages,
        userPhoto: state.inputMode === "foto" ? state.photo : undefined,
      }));
      if (needsFile && file) fd.append("model", file);
      onDone(await api<PipelineResult>("/api/build", { method: "POST", body: fd }));
    } catch (e) {
      const err = e as ApiError;
      const d = err.details as { label: string; ok: boolean; message: string }[] | { blocked?: string[] } | undefined;
      setError({ message: err.message, attempts: Array.isArray(d) ? d : undefined });
    } finally { clearInterval(timer); setBusy(false); }
  }

  const camo = (k: CamoKind) => update({ livery: { mode: "mimetica", camo: k } });
  return (
    <Section title="3. Costruzione del modello" subtitle="Scegli il percorso, la livrea e l'uso previsto. Tutti i motori sono gratuiti: nessun credito viene acquistato."
      actions={<><button className="btn-ghost" onClick={onBack} disabled={busy}>Indietro</button><button className="btn-primary flex-1 sm:flex-none" onClick={build} disabled={busy || (needsFile && !file) || !engineAvailable(state.mode)}>{busy ? "Elaborazione…" : "Costruisci"}</button></>}>
      <fieldset className="space-y-2">
        <legend className="label">Motore</legend>
        {ENGINES.map((e) => (
          <label key={e.id} className={`card flex cursor-pointer gap-3 ${state.mode === e.id ? "border-accent" : ""} ${!engineAvailable(e.id) ? "opacity-50" : ""}`}>
            <input type="radio" name="engine" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={state.mode === e.id} disabled={!engineAvailable(e.id)} onChange={() => update({ mode: e.id })} />
            <span className="text-sm"><strong>{e.title}</strong><br /><span className="text-xs text-muted">{e.desc}{e.id === "B" && !status?.engines.B.available ? " (worker Blender non configurato su questo server)" : ""}{(e.id === "C" || e.id === "D") && state.candidateId && state.mode === e.id ? ` – selezionato: ${state.candidateId.id.split(/[:/]/).pop()}` : ""}</span></span>
          </label>
        ))}
      </fieldset>
      {needsFile && <input type="file" accept=".glb,.gltf,.zip,.obj,.stl,.fbx,.blend,.mcaddon,.mcpack" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />}
      {(state.mode === "A" || state.mode === "auto") && status && (
        <details className="card text-xs">
          <summary className="cursor-pointer text-sm font-semibold">Modelli AI e licenze</summary>
          <ul className="mt-2 space-y-2">
            {status.aiModels.map((m) => <li key={m.id} className={m.enabled ? "" : "text-muted line-through"}><strong>{m.name}</strong> – <a className="underline" href={m.licenseUrl} target="_blank" rel="noreferrer">{m.license}</a> – GPU: {m.gpu}{m.restrictions ? <span className="block text-warn no-underline">{m.restrictions}</span> : null}</li>)}
          </ul>
          <p className="mt-2 text-muted">Gli Spaces gratuiti hanno code e una quota GPU giornaliera: se è esaurita il motore lo segnala e prova l&apos;alternativa.</p>
        </details>
      )}

      <fieldset className="space-y-2">
        <legend className="label">Livrea e materiali</legend>
        <div className="flex flex-wrap gap-2 text-xs">
          <button className={`rounded-full border px-3 py-1.5 ${state.livery.mode === "originale" ? "border-accent" : "border-line"}`} onClick={() => update({ livery: { mode: "originale" } })}>Originale del modello</button>
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${state.livery.mode === "vernice" ? "border-accent" : "border-line"}`}>
            <button onClick={() => update({ livery: { mode: "vernice", color: state.livery.color ?? [150, 20, 24] } })}>Vernice</button>
            <input type="color" aria-label="Colore vernice" value={`#${(state.livery.color ?? [150, 20, 24]).map((c) => c.toString(16).padStart(2, "0")).join("")}`}
              onChange={(e) => { const h = e.target.value; update({ livery: { mode: "vernice", color: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number] } }); }} className="h-5 w-8" />
          </span>
          {(["woodland", "deserto", "digitale", "invernale", "verde_nato"] as CamoKind[]).map((k) => (
            <button key={k} className={`rounded-full border px-3 py-1.5 ${state.livery.mode === "mimetica" && state.livery.camo === k ? "border-accent" : "border-line"}`} onClick={() => camo(k)}>Mimetica {k.replace("_", " ")}</button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Qualità</span>
          <select className="input" value={state.quality} onChange={(e) => update({ quality: e.target.value as Quality })}>
            <option value="ULTRA">ULTRA (voxel 1 px, adattato per Android)</option><option value="ALTA">ALTA</option><option value="STANDARD">STANDARD (più leggero)</option>
          </select>
        </label>
        <label><span className="label">Fronte del veicolo</span>
          <select className="input" value={state.orientation} onChange={(e) => update({ orientation: e.target.value as WizardState["orientation"] })}>
            <option value="auto">Automatico (fanali / cannone)</option><option value="normal">Come il modello</option><option value="flipped">Ruota di 180°</option>
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={state.commercial} onChange={(e) => update({ commercial: e.target.checked })} />
        <span>Uso commerciale<br /><span className="text-xs text-muted">Se attivo, le risorse con licenza &quot;non commerciale&quot; vengono escluse.</span></span>
      </label>

      {busy && (
        <div className="card space-y-2">
          <Spinner label="Elaborazione sul server (la generazione AI può richiedere alcuni minuti)…" />
          <ol className="space-y-1 text-sm">{STAGES.map((s, i) => <li key={s} className={i < stage ? "text-accent" : i === stage ? "" : "text-muted"}>{i < stage ? "✓" : i === stage ? "•" : "○"} {s}</li>)}</ol>
        </div>
      )}
      {error && (
        <div className="space-y-2">
          <Alert>{error.message}</Alert>
          {error.attempts && <ul className="card space-y-1 text-xs">{error.attempts.map((a, i) => <li key={i} className={a.ok ? "text-accent" : "text-warn"}>{a.ok ? "✓" : "✗"} {a.label}: {a.message}</li>)}</ul>}
        </div>
      )}
    </Section>
  );
}
