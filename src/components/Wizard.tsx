"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { clearState, initialState, loadState, saveState, type Features, type WizardState } from "@/lib/client/state";
import { StepGenerate } from "./steps/StepGenerate";
import { StepIdentify } from "./steps/StepIdentify";
import { StepPhoto } from "./steps/StepPhoto";
import { StepReferences } from "./steps/StepReferences";
import { StepResult } from "./steps/StepResult";
import { Alert } from "./ui";

const STEPS = ["Foto", "Modello", "Riferimenti", "Generazione", "Risultato"];

export default function Wizard() {
  const [state, setState] = useState<WizardState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [features, setFeatures] = useState<Features>();
  const [balance, setBalance] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    setState(loadState());
    try {
      setCode(localStorage.getItem("v3d.accessCode") ?? "");
    } catch {
      /* ignora */
    }
    setLoaded(true);
    api<{ features: Features; balance: number | null }>("/api/status")
      .then((r) => {
        setFeatures(r.features);
        setBalance(r.balance);
      })
      .catch((e) => setStatusError((e as Error).message));
  }, []);

  useEffect(() => {
    if (loaded) saveState(state);
  }, [state, loaded]);

  const update = useCallback((p: Partial<WizardState>) => setState((s) => ({ ...s, ...p })), []);
  const go = (step: number) => {
    update({ step });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const restart = () => {
    clearState();
    setState(initialState);
  };

  if (!loaded) return null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-6">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Vehicle3D <span className="text-accent">AI</span></h1>
          <p className="text-xs text-muted">Foto → modello 3D → Minecraft Bedrock</p>
        </div>
        <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>Impostazioni</button>
      </header>

      {showSettings && (
        <div className="card mb-4 space-y-3 text-sm">
          <label className="block"><span className="label">Codice di accesso {features?.accessCodeRequired ? "(richiesto)" : "(non richiesto)"}</span>
            <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => { try { localStorage.setItem("v3d.accessCode", code); } catch { /* ignora */ } }} autoComplete="off" />
          </label>
          {features && (
            <ul className="space-y-1 text-xs text-muted">
              <li>Identificazione AI: {features.identification ? "attiva" : "non configurata"}</li>
              <li>Ricerca immagini: Wikimedia Commons{features.search.brave ? ", Brave" : ""}{features.search.google ? ", Google" : ""}</li>
              <li>Provider 3D: {[features.providers.meshy && "Meshy", features.providers.fal && "fal.ai"].filter(Boolean).join(", ") || "nessuno"}</li>
              <li>Archiviazione file: {features.storage === "vercel-blob" ? "Vercel Blob" : features.storage === "local" ? "locale (sviluppo)" : "NON configurata"}</li>
            </ul>
          )}
          <button className="btn-ghost w-full" onClick={restart}>Ricomincia da capo</button>
        </div>
      )}

      <nav aria-label="Passaggi" className="mb-5">
        <ol className="grid grid-cols-5 gap-1">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const reachable = n <= state.step || (n === 5 && state.result);
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
      {features?.storage === "missing" && <div className="mb-4"><Alert kind="warn">Archiviazione file non configurata sul server: collega Vercel Blob per poter scaricare i risultati.</Alert></div>}

      <main className="flex-1">
        {state.step === 1 && <StepPhoto photo={state.photo} onPhoto={(photo) => update({ photo, identification: undefined })} onNext={() => go(2)} />}
        {state.step === 2 && (
          <StepIdentify photo={state.photo} features={features} identification={state.identification} vehicle={state.vehicle}
            onIdentified={(identification) => update({ identification })}
            onVehicle={(vehicle) => {
              const changed = JSON.stringify(vehicle) !== JSON.stringify(state.vehicle);
              update(changed ? { vehicle, candidates: [], verified: [], selection: {} } : { vehicle });
            }}
            onBack={() => go(1)} onNext={() => go(3)} />
        )}
        {state.step === 3 && state.vehicle && (
          <StepReferences vehicle={state.vehicle} features={features} photo={state.photo} usePhoto={state.usePhoto} photoView={state.photoView}
            candidates={state.candidates} verified={state.verified} selection={state.selection}
            onCandidates={(candidates) => update({ candidates })} onVerified={(verified) => update({ verified })}
            onSelection={(selection) => update({ selection })} onPhoto={(usePhoto, photoView) => update({ usePhoto, photoView })}
            onBack={() => go(2)} onNext={() => go(4)} />
        )}
        {state.step === 4 && state.vehicle && (
          <StepGenerate state={state} features={features} balance={balance} update={update} onBack={() => go(3)}
            onDone={(result) => { update({ result, step: 5 }); window.scrollTo({ top: 0 }); }} />
        )}
        {state.step === 5 && state.result && <StepResult result={state.result} onRestart={restart} onBack={() => go(4)} />}
      </main>

      <footer className="mt-8 text-center text-[11px] text-muted">
        Le immagini di riferimento appartengono ai rispettivi autori (licenze indicate). Minecraft è un marchio di Mojang/Microsoft; questo progetto non è affiliato.
      </footer>
    </div>
  );
}
