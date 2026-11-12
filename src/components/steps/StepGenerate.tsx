"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, thumb } from "@/lib/client/api";
import type { Features, PipelineResult, WizardState } from "@/lib/client/state";
import { VIEW_LABELS, type Quality, type TaskStatus, type VerifiedReference, type View } from "@/lib/types";
import { Alert, Progress, Section, Spinner } from "../ui";

const PROVIDER_INFO = {
  meshy: { label: "Meshy – Multi-Image to 3D", max: 4, note: "Fino a 4 viste, texture PBR, remesh. Consuma crediti Meshy." },
  fal: { label: "fal.ai – Hunyuan3D v2 multi-view", max: 3, note: "Richiede vista anteriore, posteriore e laterale. A consumo su fal.ai." },
} as const;

const STAGES = ["Download del modello", "Normalizzazione e scala reale", "Ottimizzazione mesh e texture", "Separazione componenti", "Abitacolo", "Voxelizzazione Minecraft", "Esportazione GLB / OBJ / MCADDON", "Verifica degli output"];

export function StepGenerate(props: {
  state: WizardState;
  features?: Features;
  balance?: number | null;
  update: (p: Partial<WizardState>) => void;
  onBack: () => void;
  onDone: (r: PipelineResult) => void;
}) {
  const { state, features, update } = props;
  const configured = (["meshy", "fal"] as const).filter((p) => features?.providers[p]);
  const provider = state.provider ?? (configured.includes(features?.defaultProvider ?? "meshy") ? features!.defaultProvider : configured[0]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState(0);
  const [glbFile, setGlbFile] = useState<File | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refs: { view: View; url?: string; dataUri?: string; label: string; thumb: string }[] = [];
  if (state.usePhoto && state.photo) refs.push({ view: state.photoView, dataUri: state.photo, label: "La tua foto", thumb: state.photo });
  const vmap = new Map<string, VerifiedReference>(state.verified.map((v) => [v.id, v]));
  for (const c of state.candidates) {
    const view = state.selection[c.id];
    if (!view) continue;
    const v = vmap.get(c.id);
    if (v && (!v.ok || v.matches === false)) continue;
    refs.push({ view, url: c.imageUrl, label: c.title, thumb: c.thumbUrl });
  }
  const exterior = refs.filter((r) => r.view !== "interior" && r.view !== "dashboard");
  const interior = refs.filter((r) => r.view === "interior" || r.view === "dashboard");

  const runProcess = useCallback(async (task: NonNullable<WizardState["task"]>) => {
    setProcessing(true);
    setError(undefined);
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 4000);
    try {
      const r = await api<PipelineResult>("/api/process", {
        method: "POST",
        json: {
          provider: task.provider,
          taskId: task.taskId,
          vehicle: state.vehicle,
          quality: state.quality,
          orientation: state.orientation,
          interiorUrls: interior.filter((i) => i.url).map((i) => i.url).slice(0, 3),
          icon: state.photo,
        },
      });
      props.onDone(r);
    } catch (e) {
      const err = e as ApiError;
      setError(err.code === "VERIFICATION_FAILED" ? `${err.message} Dettagli nel report del server.` : err.message);
    } finally {
      clearInterval(timer);
      setProcessing(false);
    }
  }, [state.vehicle, state.quality, state.orientation, state.photo, interior, props]);

  const poll = useCallback(async (task: NonNullable<WizardState["task"]>) => {
    try {
      const s = await api<TaskStatus>(`/api/generate/${encodeURIComponent(task.taskId)}?provider=${task.provider}`);
      update({ taskStatus: s });
      if (s.status === "succeeded") {
        runProcess(task);
        return;
      }
      if (s.status === "failed" || s.status === "canceled") {
        setError(`Generazione ${s.status === "failed" ? "fallita" : "annullata"}${s.message ? `: ${s.message}` : ""}.`);
        return;
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== "NETWORK" && err.code !== "RATE_LIMITED" && err.code !== "UPSTREAM_TIMEOUT") {
        setError(err.message);
        return;
      }
    }
    pollRef.current = setTimeout(() => poll(task), 6000);
  }, [update, runProcess]);

  // riprende un task già avviato (es. dopo aver chiuso la pagina)
  useEffect(() => {
    if (state.task && !state.result && state.taskStatus?.status !== "failed") poll(state.task);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.task?.taskId]);

  async function start() {
    if (!provider) return;
    setBusy(true);
    setError(undefined);
    try {
      const max = PROVIDER_INFO[provider].max;
      const images = exterior.slice(0, max + 2).map(({ view, url, dataUri }) => ({ view, url, dataUri }));
      const r = await api<{ provider: "meshy" | "fal"; taskId: string; createdAt: number }>("/api/generate", {
        method: "POST",
        json: { provider, quality: state.quality, images },
      });
      update({ task: r, taskStatus: { status: "queued", progress: 0 }, result: undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function convertOwn() {
    if (!glbFile || !state.vehicle) return;
    setProcessing(true);
    setError(undefined);
    setStage(1);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 3000);
    try {
      const fd = new FormData();
      fd.append("model", glbFile);
      fd.append("vehicle", JSON.stringify(state.vehicle));
      fd.append("quality", state.quality);
      fd.append("orientation", state.orientation);
      props.onDone(await api<PipelineResult>("/api/convert", { method: "POST", body: fd }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(timer);
      setProcessing(false);
    }
  }

  const running = state.task && !state.result && ["queued", "running"].includes(state.taskStatus?.status ?? "");
  const elapsed = state.task ? Math.round((Date.now() - state.task.createdAt) / 60000) : 0;

  return (
    <Section
      title="4. Generazione 3D"
      subtitle="Le immagini verificate vengono inviate al provider AI. La ricostruzione richiede in genere alcuni minuti: puoi chiudere la pagina e tornare."
      actions={
        <>
          <button className="btn-ghost" onClick={props.onBack} disabled={busy || processing}>Indietro</button>
          {!state.task || state.taskStatus?.status === "failed" || state.taskStatus?.status === "canceled" ? (
            <button className="btn-primary flex-1 sm:flex-none" onClick={start} disabled={busy || !provider || exterior.length === 0}>
              {busy ? "Invio…" : "Genera modello 3D"}
            </button>
          ) : state.taskStatus?.status === "succeeded" && !processing && !state.result ? (
            <button className="btn-primary flex-1 sm:flex-none" onClick={() => runProcess(state.task!)}>Riprova elaborazione</button>
          ) : null}
        </>
      }
    >
      {configured.length === 0 && <Alert kind="warn">Nessun provider 3D configurato sul server (MESHY_API_KEY o FAL_KEY). Puoi comunque convertire un tuo file GLB qui sotto.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Provider</span>
          <select className="input" value={provider ?? ""} onChange={(e) => update({ provider: e.target.value as "meshy" | "fal" })} disabled={Boolean(running)}>
            {configured.map((p) => <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>)}
            {!configured.length && <option value="">Nessuno</option>}
          </select>
        </label>
        <label><span className="label">Qualità</span>
          <select className="input" value={state.quality} onChange={(e) => update({ quality: e.target.value as Quality })} disabled={Boolean(running)}>
            <option value="ULTRA">ULTRA (300k poligoni, texture 2K, voxel 1px)</option>
            <option value="ALTA">ALTA</option>
            <option value="STANDARD">STANDARD</option>
          </select>
        </label>
        <label className="sm:col-span-2"><span className="label">Fronte del veicolo</span>
          <select className="input" value={state.orientation} onChange={(e) => update({ orientation: e.target.value as WizardState["orientation"] })}>
            <option value="auto">Automatico (dai fanali)</option>
            <option value="normal">Come generato</option>
            <option value="flipped">Invertito (ruota di 180°)</option>
          </select>
        </label>
      </div>
      {provider && <p className="text-xs text-muted">{PROVIDER_INFO[provider].note}{props.balance != null && provider === "meshy" ? ` Saldo attuale: ${props.balance} crediti.` : ""}</p>}

      <div>
        <p className="label">Immagini inviate ({Math.min(exterior.length, provider ? PROVIDER_INFO[provider].max : 4)} esterne{interior.length ? `, ${interior.length} interni per i colori dell'abitacolo` : ""})</p>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {refs.map((r, i) => (
            <li key={i} className="w-24 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb(r.thumb)} alt={r.label} className="h-16 w-24 rounded-lg object-cover" />
              <p className="truncate text-[10px] text-muted">{VIEW_LABELS[r.view]}</p>
            </li>
          ))}
        </ul>
        {exterior.length === 0 && <Alert kind="warn">Seleziona almeno un&apos;immagine esterna del veicolo.</Alert>}
      </div>

      {state.task && !state.result && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Task {state.task.provider}: <code className="text-xs text-muted">{state.task.taskId.slice(0, 12)}…</code></span>
            <span className="text-muted">{elapsed} min</span>
          </div>
          {!processing && <Progress value={state.taskStatus?.progress ?? null} />}
          <p className="text-sm text-muted">
            {state.taskStatus?.status === "queued" && "In coda presso il provider…"}
            {state.taskStatus?.status === "running" && `Ricostruzione in corso${state.taskStatus.progress != null ? ` (${state.taskStatus.progress}%)` : ""}…`}
            {state.taskStatus?.status === "succeeded" && !processing && "Modello generato."}
            {state.taskStatus?.message && ` ${state.taskStatus.message}`}
          </p>
        </div>
      )}
      {processing && (
        <div className="card space-y-2">
          <Spinner label="Elaborazione sul server…" />
          <ol className="space-y-1 text-sm">
            {STAGES.map((s, i) => <li key={s} className={i < stage ? "text-accent" : i === stage ? "text-text" : "text-muted"}>{i < stage ? "✓" : i === stage ? "•" : "○"} {s}</li>)}
          </ol>
        </div>
      )}
      {error && <Alert>{error}</Alert>}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Hai già un modello GLB? Convertilo direttamente</summary>
        <div className="mt-3 space-y-2">
          <input type="file" accept=".glb,model/gltf-binary" onChange={(e) => setGlbFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          <p className="text-xs text-muted">Su Vercel il caricamento diretto è limitato a circa 4,5 MB.</p>
          <button className="btn-ghost w-full" onClick={convertOwn} disabled={!glbFile || processing}>Converti GLB</button>
        </div>
      </details>
    </Section>
  );
}
