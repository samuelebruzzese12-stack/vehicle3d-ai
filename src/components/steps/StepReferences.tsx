"use client";
import { useEffect, useMemo, useState } from "react";
import { api, thumb } from "@/lib/client/api";
import type { Features } from "@/lib/client/state";
import { VIEW_LABELS, VIEWS, type ReferenceCandidate, type VehicleInput, type VerifiedReference, type View } from "@/lib/types";
import { Alert, Badge, Section, Spinner } from "../ui";

const MAX_SELECTED = 8;

export function StepReferences(props: {
  vehicle: VehicleInput;
  features?: Features;
  photo?: string;
  usePhoto: boolean;
  photoView: View;
  candidates: ReferenceCandidate[];
  verified: VerifiedReference[];
  selection: Record<string, View>;
  onCandidates: (c: ReferenceCandidate[]) => void;
  onVerified: (v: VerifiedReference[]) => void;
  onSelection: (s: Record<string, View>) => void;
  onPhoto: (use: boolean, view: View) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { candidates, verified, selection, vehicle } = props;
  const [searching, setSearching] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [filter, setFilter] = useState<View | "all">("all");

  async function search() {
    setSearching(true);
    setError(undefined);
    try {
      const r = await api<{ candidates: ReferenceCandidate[]; sources: { name: string; used: boolean; error?: string }[] }>("/api/references/search", { method: "POST", json: { vehicle } });
      props.onCandidates(r.candidates);
      props.onVerified([]);
      // preselezione: la prima immagine per ogni vista utile
      const sel: Record<string, View> = {};
      for (const v of ["front", "rear", "left", "front_three_quarter", "rear_three_quarter", "interior"] as View[]) {
        const c = r.candidates.find((x) => x.queryView === v && !sel[x.id]);
        if (c) sel[c.id] = v;
      }
      props.onSelection(sel);
      const used = r.sources.filter((s) => s.used).map((s) => s.name).join(", ");
      const errs = r.sources.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`);
      setInfo(`${r.candidates.length} immagini trovate (fonti: ${used}).`);
      if (errs.length) setError(errs.join(" · "));
      if (!r.candidates.length) setError("Nessuna immagine trovata. Prova a semplificare il modello o togliere l'anno.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!candidates.length && !searching) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    const chosen = candidates.filter((c) => selection[c.id]);
    if (!chosen.length) return;
    setVerifying(true);
    setError(undefined);
    try {
      const r = await api<{ references: VerifiedReference[]; aiUsed: boolean; aiError?: string }>("/api/references/verify", {
        method: "POST",
        json: { vehicle, candidates: chosen, useAI: Boolean(props.features?.referenceVerificationAI) },
      });
      props.onVerified(r.references);
      const next = { ...selection };
      for (const ref of r.references) {
        if (!ref.ok || ref.matches === false) delete next[ref.id];
        else if (ref.verifiedBy === "ai") next[ref.id] = ref.view;
      }
      props.onSelection(next);
      const bad = r.references.filter((x) => !x.ok || x.matches === false).length;
      setInfo(`${r.references.length - bad} riferimenti validi${bad ? `, ${bad} scartati` : ""}${r.aiUsed ? " (verifica AI)" : " (solo controllo tecnico: verifica le viste a mano)"}.`);
      if (r.aiError) setError(`Verifica AI non riuscita: ${r.aiError}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  const vmap = useMemo(() => new Map(verified.map((v) => [v.id, v])), [verified]);
  const selectedCount = Object.keys(selection).length;
  const shown = candidates.filter((c) => filter === "all" || c.queryView === filter || selection[c.id] === filter);
  const allSelectedVerified = Object.keys(selection).every((id) => vmap.get(id)?.ok);
  const toggle = (c: ReferenceCandidate) => {
    const next = { ...selection };
    if (next[c.id]) delete next[c.id];
    else if (selectedCount < MAX_SELECTED) next[c.id] = vmap.get(c.id)?.view ?? c.queryView;
    props.onSelection(next);
  };

  return (
    <Section
      title="3. Immagini di riferimento"
      subtitle={`Ricerca automatica per ${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ""}. Seleziona fino a ${MAX_SELECTED} immagini, verifica e controlla le viste.`}
      actions={
        <>
          <button className="btn-ghost" onClick={props.onBack}>Indietro</button>
          {!allSelectedVerified && selectedCount > 0 ? (
            <button className="btn-primary flex-1 sm:flex-none" onClick={verify} disabled={verifying}>{verifying ? "Verifica…" : `Verifica ${selectedCount} selezionate`}</button>
          ) : (
            <button className="btn-primary flex-1 sm:flex-none" onClick={props.onNext} disabled={!selectedCount && !props.usePhoto}>Continua</button>
          )}
        </>
      }
    >
      {props.photo && (
        <div className="card flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.photo} alt="" className="h-16 w-24 rounded-lg object-cover" />
          <div className="flex-1 space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.usePhoto} onChange={(e) => props.onPhoto(e.target.checked, props.photoView)} className="h-5 w-5 accent-[var(--accent)]" /> Usa anche la tua foto</label>
            <select className="input py-2 text-sm" value={props.photoView} onChange={(e) => props.onPhoto(props.usePhoto, e.target.value as View)}>
              {VIEWS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", ...VIEWS] as const).filter((v) => v === "all" || candidates.some((c) => c.queryView === v)).map((v) => (
          <button key={v} onClick={() => setFilter(v)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${filter === v ? "border-accent text-accent" : "border-line text-muted"}`}>
            {v === "all" ? "Tutte" : VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      {searching && <Spinner label="Ricerca immagini in corso…" />}
      {info && <Alert kind="info">{info}</Alert>}
      {error && <Alert kind="warn">{error}</Alert>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((c) => {
          const v = vmap.get(c.id);
          const sel = selection[c.id];
          return (
            <li key={c.id} className={`overflow-hidden rounded-xl border ${sel ? "border-accent" : "border-line"} bg-panel`}>
              <button className="relative block w-full" onClick={() => toggle(c)} aria-pressed={Boolean(sel)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(c.thumbUrl)} alt={c.title} loading="lazy" className="aspect-[4/3] w-full bg-panel-2 object-cover" onError={(e) => { e.currentTarget.style.opacity = "0"; }} />
                <span className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${sel ? "bg-accent text-accent-ink" : "bg-black/50 text-white"}`}>{sel ? "✓" : ""}</span>
                {v && (
                  <span className="absolute right-2 top-2">
                    {!v.ok ? <Badge tone="danger">non valida</Badge> : v.matches === false ? <Badge tone="danger">altro modello</Badge> : v.matches ? <Badge tone="ok">verificata</Badge> : <Badge>scaricata</Badge>}
                  </span>
                )}
              </button>
              <div className="space-y-1 p-2">
                {sel ? (
                  <select className="input py-1.5 text-xs" value={sel} onChange={(e) => props.onSelection({ ...selection, [c.id]: e.target.value as View })} aria-label="Vista">
                    {VIEWS.map((x) => <option key={x} value={x}>{VIEW_LABELS[x]}</option>)}
                  </select>
                ) : (
                  <p className="text-[11px] text-muted">Ricerca: {VIEW_LABELS[c.queryView]}</p>
                )}
                {v?.reason && <p className="line-clamp-2 text-[11px] text-muted">{v.reason}</p>}
                {v?.problem && <p className="text-[11px] text-danger">{v.problem}</p>}
                <p className="truncate text-[10px] text-muted" title={`${c.license ?? ""} ${c.author ?? ""}`}>
                  {c.license}{c.author ? ` · ${c.author}` : ""} {c.pageUrl && <a className="underline" href={c.pageUrl} target="_blank" rel="noreferrer">fonte</a>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn-ghost w-full" onClick={search} disabled={searching}>Ripeti ricerca</button>
    </Section>
  );
}
