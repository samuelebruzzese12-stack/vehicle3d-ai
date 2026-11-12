"use client";
import { useRef, useState } from "react";
import { fileToJpegDataUri } from "@/lib/client/api";
import { Alert, Section } from "../ui";

export function StepPhoto({ photo, onPhoto, onNext }: { photo?: string; onPhoto: (p: string) => void; onNext: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);

  async function handle(file?: File) {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      onPhoto(await fileToJpegDataUri(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="1. Fotografia del veicolo"
      subtitle="Scatta o carica una foto nitida di auto, camion, autobus o altro veicolo. Meglio se di tre quarti, intero e ben illuminato."
      actions={<button className="btn-primary w-full sm:w-auto" disabled={!photo || busy} onClick={onNext}>Continua</button>}
    >
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-ghost h-24 flex-col" onClick={() => cam.current?.click()} disabled={busy}>
          <span className="text-2xl" aria-hidden>📷</span> Scatta foto
        </button>
        <button className="btn-ghost h-24 flex-col" onClick={() => gal.current?.click()} disabled={busy}>
          <span className="text-2xl" aria-hidden>🖼️</span> Dalla galleria
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      <input ref={gal} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {busy && <Alert kind="info">Preparazione dell&apos;immagine…</Alert>}
      {error && <Alert>{error}</Alert>}
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="Foto caricata" className="w-full rounded-2xl border border-line object-contain" />
      )}
    </Section>
  );
}
