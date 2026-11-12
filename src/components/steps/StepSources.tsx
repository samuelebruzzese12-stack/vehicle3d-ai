"use client";
import { useEffect, useState } from "react";
import { api, thumb } from "@/lib/client/api";
import type { ModelCandidate, SourcesResult, WizardState } from "@/lib/client/state";
import { licenseInfo, parseLicense, type LicenseId } from "@/lib/licenses";
import { VIEW_LABELS, type View } from "@/lib/types";
import { LicenseBadge } from "../LicenseBadge";
import { Alert, Badge, Section, Spinner } from "../ui";

export function StepSources({ state, update, onBack, onNext }: { state: WizardState; update: (p: Partial<WizardState>) => void; onBack: () => void; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [views, setViews] = useState<Record<string, { view: View; score: number }>>({});
  const [viewStatus, setViewStatus] = useState<string>();
  const v = state.vehicle!;

  async function load() {
    setBusy(true); setError(undefined);
    try {
      const r = await api<SourcesResult>("/api/sources", { method: "POST", json: { name: v.label, vehicle: state.vehicleInput, commonsCategory: v.commonsCategory, commercial: state.commercial } });
      // preselezione: fino a 4 foto con licenza che consente derivati
      const ok = r.photos.filter((p) => photoLicense(p).policy.derivatives).slice(0, 4).map((p) => p.title);
      update({ sources: r, aiImages: ok });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!state.sources) load(); }, []);

  async function classifyViews() {
    if (!state.sources) return;
    try {
      const { loadClip, classifyView } = await import("@/lib/vision/clip");
      const { RawImage } = await import("@huggingface/transformers");
      await loadClip((p) => setViewStatus(`Download modello CLIP: ${p}%`));
      const out: typeof views = {};
      const photos = state.sources.photos.slice(0, 24);
      for (let i = 0; i < photos.length; i++) {
        setViewStatus(`Classificazione viste ${i + 1}/${photos.length}…`);
        try { out[photos[i].id] = await classifyView(await RawImage.fromURL(thumb(photos[i].thumbUrl))); } catch { /* immagine non leggibile */ }
        setViews({ ...out });
      }
      setViewStatus("Viste stimate con CLIP (verifica a colpo d'occhio).");
    } catch (e) { setViewStatus(`Classificazione non disponibile: ${(e as Error).message}`); }
  }

  const s = state.sources;
  const toggle = (title: string) => {
    const has = state.aiImages.includes(title);
    update({ aiImages: has ? state.aiImages.filter((t) => t !== title) : [...state.aiImages, title].slice(-4) });
  };

  return (
    <Section title="2. Fonti" subtitle={`Foto, documentazione, texture e modelli per ${v.label}. Per ogni risorsa sono indicati autore, fonte e licenza.`}
      actions={<><button className="btn-ghost" onClick={onBack}>Indietro</button><button className="btn-primary flex-1 sm:flex-none" onClick={onNext} disabled={!s}>Scegli come costruire</button></>}>
      {busy && <Spinner label="Interrogazione delle fonti (Commons, Poly Haven, Sketchfab, GitHub)…" />}
      {error && <Alert>{error}</Alert>}
      {s && (
        <>
          <details className="card text-sm" open>
            <summary className="cursor-pointer font-semibold">Esito delle fonti</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {s.summary.map((x, i) => <li key={i} className={x.ok ? "text-text" : "text-warn"}>{x.ok ? "✓" : "!"} {x.source}: {x.ok ? `${x.count} risultati` : x.message}</li>)}
            </ul>
          </details>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Fotografie ({s.photos.length})</h3>
              <button className="btn-ghost px-3 py-2 text-xs" onClick={classifyViews}>Stima viste (CLIP)</button>
            </div>
            {viewStatus && <p className="text-xs text-muted">{viewStatus}</p>}
            <p className="text-xs text-muted">Tocca fino a 4 foto da usare come riferimento per la generazione AI (servono licenze che consentano opere derivate).</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.photos.map((p) => {
                const lic = photoLicense(p);
                const sel = state.aiImages.includes(p.title);
                return (
                  <li key={p.id} className={`overflow-hidden rounded-xl border ${sel ? "border-accent" : "border-line"} bg-panel`}>
                    <button className="relative block w-full" onClick={() => lic.policy.derivatives && toggle(p.title)} aria-pressed={sel} disabled={!lic.policy.derivatives}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(p.thumbUrl)} alt={p.title} loading="lazy" className="aspect-[4/3] w-full bg-panel-2 object-cover" onError={(e) => { e.currentTarget.style.opacity = "0"; }} />
                      {sel && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 text-xs font-bold text-accent-ink">AI</span>}
                      {views[p.id] && <span className="absolute right-2 top-2"><Badge>{VIEW_LABELS[views[p.id].view]}</Badge></span>}
                    </button>
                    <div className="space-y-1 p-2 text-[10px] text-muted">
                      <LicenseBadge license={lic} usable={lic.policy.derivatives} />
                      <p className="truncate">{p.author} · <a className="underline" href={p.pageUrl} target="_blank" rel="noreferrer">fonte</a></p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <ModelList title="Modelli 3D esistenti (motore C)" items={s.models} state={state} update={update} source={(m) => (m.fileUrl ? "commons" : m.source)} />
          <ModelList title="Addon Minecraft esistenti (motore D)" items={s.addons} state={state} update={update} source={() => "github"} />

          <section className="space-y-2">
            <h3 className="font-semibold">Texture (Poly Haven, CC0)</h3>
            <ul className="space-y-1 text-xs text-muted">
              {s.textures.map((t) => <li key={t.slot}>{t.slot}: <a className="underline" href={t.pageUrl} target="_blank" rel="noreferrer">{t.name}</a> – {t.credit.author} – {t.credit.license.label}</li>)}
              <li>pneumatici: materiale procedurale (nessuna texture adatta nel catalogo)</li>
            </ul>
          </section>

          <details className="card text-sm">
            <summary className="cursor-pointer font-semibold">Ricerca manuale su altri siti</summary>
            <p className="mt-2 text-xs text-muted">Questi siti non offrono un&apos;API gratuita o ne vietano l&apos;uso automatico: Vehicle3D AI non li interroga. Se scarichi un file, verifica tu la licenza e caricalo al passo successivo.</p>
            <ul className="mt-2 space-y-1">{s.manualLinks.map((l) => <li key={l.url}><a className="text-xs underline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}</ul>
          </details>
        </>
      )}
    </Section>
  );
}

/** Licenza della foto: identificativo normalizzato dal server (l'etichetta è solo per la lettura). */
function photoLicense(p: { licenseId?: string; license?: string }) {
  return p.licenseId ? licenseInfo(p.licenseId as LicenseId) : parseLicense(p.license);
}

function ModelList({ title, items, state, update, source }: { title: string; items: ModelCandidate[]; state: WizardState; update: (p: Partial<WizardState>) => void; source: (m: ModelCandidate) => "sketchfab" | "github" | "commons" }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title} ({items.length})</h3>
      {!items.length && <p className="text-xs text-muted">Nessun risultato.</p>}
      <ul className="space-y-2">
        {items.map((m) => {
          const sel = state.candidateId?.id === m.id;
          return (
            <li key={m.id} className={`card flex gap-3 ${sel ? "border-accent" : ""}`}>
              {m.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb(m.thumbnail)} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1 space-y-1 text-xs">
                <p className="truncate text-sm font-semibold">{m.name}</p>
                <p className="text-muted">{m.author} · <a className="underline" href={m.pageUrl} target="_blank" rel="noreferrer">pagina</a>{m.faces ? ` · ${m.faces.toLocaleString("it-IT")} facce` : ""} · pertinenza {Math.round(m.relevance * 100)}%</p>
                <LicenseBadge license={m.license} usable={m.usable} />
                {m.blockedReason && <p className="text-danger">{m.blockedReason}</p>}
                {m.usable && (
                  <button className="btn-ghost mt-1 px-3 py-1.5 text-xs" onClick={() => update({ candidateId: sel ? undefined : { id: m.id, source: source(m) }, mode: sel ? "auto" : m.kind === "addon" ? "D" : "C" })}>
                    {sel ? "Selezionato ✓" : "Usa questo"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
