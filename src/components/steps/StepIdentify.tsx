"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Features } from "@/lib/client/state";
import { CATEGORIES, type VehicleId, type VehicleInput } from "@/lib/types";
import { Alert, Badge, Section, Spinner } from "../ui";

const CAT_LABEL: Record<string, string> = { auto: "Automobile", suv: "SUV", furgone: "Furgone", camion: "Camion", autobus: "Autobus", moto: "Moto", pickup: "Pick-up", trattore: "Trattore", altro: "Altro" };

export function StepIdentify(props: {
  photo?: string;
  features?: Features;
  identification?: VehicleId;
  vehicle?: VehicleInput;
  onIdentified: (id: VehicleId) => void;
  onVehicle: (v: VehicleInput) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { photo, features, identification, vehicle } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<VehicleInput>(vehicle ?? { make: "", model: "", category: "auto" });

  useEffect(() => {
    if (vehicle) setForm(vehicle);
  }, [vehicle]);

  async function identify() {
    if (!photo) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ vehicle: VehicleId }>("/api/identify", { method: "POST", json: { image: photo } });
      props.onIdentified(r.vehicle);
      if (!r.vehicle.is_vehicle) {
        setError("Nella foto non è stato riconosciuto un veicolo. Puoi inserire i dati manualmente o cambiare foto.");
        return;
      }
      const v: VehicleInput = {
        make: r.vehicle.make,
        model: r.vehicle.model,
        year: r.vehicle.year_from > 1885 ? Math.round((r.vehicle.year_from + r.vehicle.year_to) / 2) : undefined,
        category: r.vehicle.category,
        dimensions_m: r.vehicle.dimensions_m.length > 0.5 ? r.vehicle.dimensions_m : undefined,
        seats: r.vehicle.seats > 0 ? r.vehicle.seats : undefined,
      };
      setForm(v);
      props.onVehicle(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (features?.identification && photo && !identification && !busy) identify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features?.identification, photo]);

  const set = <K extends keyof VehicleInput>(k: K, val: VehicleInput[K]) => {
    const next = { ...form, [k]: val };
    setForm(next);
  };
  const valid = form.make.trim().length > 0 && form.model.trim().length > 0;

  return (
    <Section
      title="2. Identificazione"
      subtitle="Marca, modello e anno guidano la ricerca delle immagini e la scala reale del modello. Puoi correggerli."
      actions={
        <>
          <button className="btn-ghost" onClick={props.onBack}>Indietro</button>
          <button className="btn-primary flex-1 sm:flex-none" disabled={!valid || busy} onClick={() => { props.onVehicle(form); props.onNext(); }}>Cerca riferimenti</button>
        </>
      }
    >
      {!features?.identification && <Alert kind="warn">Identificazione AI non configurata sul server: inserisci i dati manualmente.</Alert>}
      {busy && <Spinner label="Analisi della foto con AI…" />}
      {error && <Alert>{error}</Alert>}
      {identification?.is_vehicle && (
        <div className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base">{identification.make} {identification.model}</strong>
            <Badge tone={identification.confidence > 0.75 ? "ok" : identification.confidence > 0.45 ? "warn" : "danger"}>
              affidabilità {Math.round(identification.confidence * 100)}%
            </Badge>
          </div>
          <p className="text-muted">
            {identification.generation && `${identification.generation} · `}{identification.year_from}–{identification.year_to} · {identification.body_style} · {identification.color}
          </p>
          {identification.notes && <p className="text-muted">{identification.notes}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1"><span className="label">Marca</span><input className="input" value={form.make} onChange={(e) => set("make", e.target.value)} placeholder="es. Fiat" /></label>
        <label className="col-span-1"><span className="label">Modello</span><input className="input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="es. Panda" /></label>
        <label><span className="label">Anno</span><input className="input" inputMode="numeric" value={form.year ?? ""} onChange={(e) => set("year", e.target.value ? Number(e.target.value.replace(/\D/g, "")) || undefined : undefined)} placeholder="es. 2012" /></label>
        <label><span className="label">Categoria</span>
          <select className="input" value={form.category} onChange={(e) => set("category", e.target.value as VehicleInput["category"])}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </label>
        <label><span className="label">Lunghezza (m)</span><input className="input" inputMode="decimal" value={form.dimensions_m?.length ?? ""} onChange={(e) => {
          const L = Number(e.target.value.replace(",", "."));
          set("dimensions_m", L > 0 ? { length: L, width: form.dimensions_m?.width ?? L * 0.4, height: form.dimensions_m?.height ?? L * 0.33 } : undefined);
        }} placeholder="auto" /></label>
        <label><span className="label">Posti</span><input className="input" inputMode="numeric" value={form.seats ?? ""} onChange={(e) => set("seats", Number(e.target.value) || undefined)} placeholder="auto" /></label>
      </div>
      {features?.identification && photo && (
        <button className="btn-ghost w-full" onClick={identify} disabled={busy}>Ripeti identificazione AI</button>
      )}
    </Section>
  );
}
