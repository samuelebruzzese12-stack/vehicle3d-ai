"use client";
import { useRef, useState } from "react";
import { api, fileToJpegDataUri } from "@/lib/client/api";
import type { WikiCandidate, WizardState } from "@/lib/client/state";
import { Alert, Badge, Section, Spinner } from "../ui";

const CAT: Record<string, string> = { auto: "Automobile", suv: "SUV", furgone: "Furgone", camion: "Camion", autobus: "Autobus", moto: "Moto", pickup: "Pick-up", trattore: "Trattore", carro_armato: "Carro armato", blindato: "Blindato", altro: "Altro" };

export function StepVehicle({ state, update, onNext }: { state: WizardState; update: (p: Partial<WizardState>) => void; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [clip, setClip] = useState<{ status: string; suggestions: { label: string; score: number }[]; category?: string } | null>(null);
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);

  async function search(q = state.query) {
    if (q.trim().length < 2) return;
    setBusy(true); setError(undefined);
    try {
      const r = await api<{ candidates: WikiCandidate[] }>("/api/identify", { method: "POST", json: { query: q } });
      update({ query: q, candidates: r.candidates });
      if (!r.candidates.length) setError("Nessun veicolo trovato su Wikidata con questo nome. Prova la denominazione ufficiale (es. \"Alfa Romeo 159\", \"T-90\").");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function onPhoto(file?: File) {
    if (!file) return;
    setError(undefined);
    try { update({ photo: await fileToJpegDataUri(file), candidates: [] }); setClip(null); } catch (e) { setError((e as Error).message); }
  }

  async function recognize() {
    if (!state.photo) return;
    setClip({ status: "Caricamento del modello CLIP (open source, ~90 MB, solo la prima volta)…", suggestions: [] });
    try {
      const { loadClip, suggestCategoryAndMake, rankModels } = await import("@/lib/vision/clip");
      await loadClip((p) => setClip((c) => ({ ...(c ?? { suggestions: [] }), status: `Download modello CLIP: ${p}%` })));
      const { RawImage } = await import("@huggingface/transformers");
      const img = await RawImage.fromURL(state.photo);
      setClip({ status: "Riconoscimento di tipo e marca…", suggestions: [] });
      const s = await suggestCategoryAndMake(img);
      setClip({ status: "Confronto con i modelli su Wikidata…", suggestions: [], category: s.category });
      const list = await api<{ models: { label: string }[] }>("/api/models-list", { method: "POST", json: { make: s.makes[0]?.label, category: s.category } });
      const ranked = list.models.length ? await rankModels(img, list.models.map((m) => m.label)) : s.makes;
      setClip({ status: `Categoria stimata: ${CAT[s.category] ?? s.category}${s.makes[0] ? ` · marca probabile: ${s.makes[0].label}` : ""}. Scegli il modello corretto (stima, da confermare).`, suggestions: ranked, category: s.category });
    } catch (e) {
      setClip({ status: `Riconoscimento non riuscito: ${(e as Error).message}. Inserisci il nome a mano.`, suggestions: [] });
    }
  }

  const choose = (c: WikiCandidate) => update({ vehicle: c, vehicleInput: c.input, sources: undefined, aiImages: [], candidateId: undefined, livery: c.category === "carro_armato" ? { mode: "originale" } : state.livery });

  return (
    <Section title="1. Veicolo" subtitle="Scrivi il nome del veicolo oppure parti da una fotografia."
      actions={<button className="btn-primary w-full sm:w-auto" disabled={!state.vehicle} onClick={onNext}>Cerca fonti e modelli</button>}>
      <div className="flex rounded-xl border border-line bg-panel-2 p-1 text-sm" role="tablist">
        {(["nome", "foto"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={state.inputMode === m} className={`flex-1 rounded-lg py-2 ${state.inputMode === m ? "bg-panel font-semibold" : "text-muted"}`} onClick={() => update({ inputMode: m })}>
            {m === "nome" ? "Nome del veicolo" : "Fotografia"}
          </button>
        ))}
      </div>

      {state.inputMode === "foto" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-ghost h-20 flex-col" onClick={() => cam.current?.click()}><span aria-hidden>📷</span>Scatta foto</button>
            <button className="btn-ghost h-20 flex-col" onClick={() => gal.current?.click()}><span aria-hidden>🖼️</span>Dalla galleria</button>
          </div>
          <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          <input ref={gal} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {state.photo && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.photo} alt="Foto caricata" className="max-h-64 w-full rounded-2xl border border-line object-contain" />
              <button className="btn-ghost w-full" onClick={recognize}>Riconosci con AI open source (CLIP, nel telefono)</button>
            </>
          )}
          {clip && (
            <div className="card space-y-2 text-sm">
              <p className="text-muted">{clip.status}</p>
              <div className="flex flex-wrap gap-2">
                {clip.suggestions.map((s) => (
                  <button key={s.label} className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-accent" onClick={() => { update({ query: s.label }); search(s.label); }}>
                    {s.label} <span className="text-muted">{Math.round(s.score * 100)}%</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" value={state.query} onChange={(e) => update({ query: e.target.value })} placeholder={state.inputMode === "foto" ? "Oppure scrivi il modello…" : "es. Alfa Romeo 159, T-90, Iveco Daily"} aria-label="Nome del veicolo" />
        <button className="btn-primary shrink-0" disabled={busy || state.query.trim().length < 2}>Cerca</button>
      </form>
      {busy && <Spinner label="Ricerca su Wikidata e Wikipedia…" />}
      {error && <Alert kind="warn">{error}</Alert>}

      <ul className="space-y-2">
        {state.candidates.map((c) => (
          <li key={c.qid}>
            <button onClick={() => choose(c)} className={`card w-full text-left ${state.vehicle?.qid === c.qid ? "border-accent" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{c.label}</strong>
                <Badge tone="ok">{CAT[c.category] ?? c.category}</Badge>
                {state.vehicle?.qid === c.qid && <Badge tone="ok">selezionato</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">{c.description}</p>
              <p className="mt-1 text-xs text-muted">
                {[c.manufacturer, c.yearFrom && `${c.yearFrom}${c.yearTo ? `–${c.yearTo}` : ""}${c.yearsSource === "wikipedia-testo" ? " (dal testo Wikipedia)" : ""}`,
                  c.dimensions_m && `${c.dimensions_m.length.toFixed(2)} × ${c.dimensions_m.width.toFixed(2)} × ${c.dimensions_m.height.toFixed(2)} m`, c.massKg && `${(c.massKg / 1000).toFixed(1)} t`, c.crew && `equipaggio ${c.crew}`]
                  .filter(Boolean).join(" · ")}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {state.vehicle && (
        <div className="card space-y-2 text-sm">
          {state.vehicle.wikipedia.find((w) => w.extract) && <p className="text-muted">{state.vehicle.wikipedia.find((w) => w.extract)!.extract!.slice(0, 500)}</p>}
          {state.vehicle.variants.length > 0 && <p className="text-xs text-muted">Varianti: {state.vehicle.variants.map((v) => v.label).join(", ")}</p>}
          <p className="text-xs text-muted">Fonti: {state.vehicle.sources.map((s, i) => <a key={i} className="mr-2 underline" href={s.sourceUrl} target="_blank" rel="noreferrer">{s.sourceName}</a>)}</p>
        </div>
      )}
    </Section>
  );
}
