"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { clearState, initialState, loadState, saveState, type Status, type WizardState } from "@/lib/client/state";
import { StepBuild } from "./steps/StepBuild";
import { StepResult } from "./steps/StepResult";
import { StepSources } from "./steps/StepSources";
import { StepVehicle } from "./steps/StepVehicle";
import { Alert } from "./ui";

const STEPS = ["Veicolo", "Fonti", "Costruzione", "Risultato"];

export default function Wizard() {
  const [state, setState] = useState<WizardState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [statusError, setStatusError] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    setState(loadState());
    try { setCode(localStorage.getItem("v3d.accessCode") ?? ""); } catch { /* ignora */ }
    setLoaded(true);
    api<Status>("/api/status").then(setStatus).catch((e) => setStatusError((e as Error).message));
  }, []);
  useEffect(() => { if (loaded) saveState(state); }, [state, loaded]);

  const update = useCallback((p: Partial<WizardState>) => setState((s) => ({ ...s, ...p })), []);
  const go = (step: number) => { update({ step }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const restart = () => { clearState(); setState(initialState); };
  if (!loaded) return null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-6">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Vehicle3D <span className="text-accent">AI</span></h1>
          <p className="text-xs text-muted">Nome o foto → modello 3D → Minecraft Bedrock · gratuito e open source</p>
        </div>
        <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>Impostazioni</button>
      </header>

      {showSettings && (
        <div className="card mb-4 space-y-3 text-sm">
          <label className="block"><span className="label">Codice di accesso {status?.accessCodeRequired ? "(richiesto)" : "(non richiesto)"}</span>
            <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => { try { localStorage.setItem("v3d.accessCode", code); } catch { /* ignora */ } }} autoComplete="off" />
          </label>
          {status && (
            <ul className="space-y-1 text-xs text-muted">
              <li>Nessun servizio a pagamento è usato o richiesto.</li>
              <li>Download Sketchfab: {status.sources.sketchfabDownload ? "attivo (token gratuito)" : "non configurato (solo ricerca)"}</li>
              <li>Worker Blender (motore B): {status.engines.B.available ? "attivo" : "non configurato"}</li>
              <li>Generazione AI: {status.engines.A.backends.join(", ")}{status.engines.A.hfToken ? " · token HF gratuito configurato" : " · quota anonima"}</li>
              <li>Archiviazione: {status.storage === "vercel-blob" ? "Vercel Blob" : status.storage === "local" ? "locale (sviluppo)" : "NON configurata"}</li>
            </ul>
          )}
          <button className="btn-ghost w-full" onClick={restart}>Ricomincia da capo</button>
        </div>
      )}

      <nav aria-label="Passaggi" className="mb-5">
        <ol className="grid grid-cols-4 gap-1">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const reachable = n <= state.step || (n === 4 && state.result);
            return (
              <li key={s}>
                <button disabled={!reachable} onClick={() => go(n)} className="w-full text-left disabled:cursor-default">
                  <span className={`block h-1.5 rounded-full ${n <= state.step ? "bg-accent" : "bg-panel-2"}`} />
                  <span className={`mt-1 block truncate text-[11px] ${n === state.step ? "font-semibold text-text" : "text-muted"}`}>{s}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {statusError && <div className="mb-4"><Alert>Server non raggiungibile: {statusError}</Alert></div>}
      {status?.storage === "missing" && <div className="mb-4"><Alert kind="warn">Archiviazione file non configurata sul server: collega Vercel Blob per poter scaricare i risultati.</Alert></div>}

      <main className="flex-1">
        {state.step === 1 && <StepVehicle state={state} update={update} onNext={() => go(2)} />}
        {state.step === 2 && state.vehicle && <StepSources state={state} update={update} onBack={() => go(1)} onNext={() => go(3)} />}
        {state.step === 3 && state.vehicle && <StepBuild state={state} status={status} update={update} onBack={() => go(2)} onDone={(result) => { update({ result, step: 4 }); window.scrollTo({ top: 0 }); }} />}
        {state.step === 4 && state.result && <StepResult result={state.result} onRestart={restart} onBack={() => go(3)} />}
      </main>

      <footer className="mt-8 text-center text-[11px] text-muted">
        Dati: Wikidata (CC0), Wikipedia e Wikimedia Commons (licenze indicate per file), Poly Haven (CC0). Modelli AI open source con licenza MIT. Minecraft è un marchio di Mojang/Microsoft; progetto non affiliato.
      </footer>
    </div>
  );
}
