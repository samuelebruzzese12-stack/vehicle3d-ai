"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { formatBytes } from "@/lib/client/api";
import type { PipelineResult } from "@/lib/client/state";
import { Badge, Section } from "../ui";

const Viewer3D = dynamic(() => import("../Viewer3D"), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-2xl bg-panel" /> });
const MinecraftPreview = dynamic(() => import("../MinecraftPreview"), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-2xl bg-panel" /> });

const LABELS: Record<string, { title: string; desc: string }> = {
  mcaddon: { title: "Minecraft Bedrock (.mcaddon)", desc: "Resource + Behavior Pack. Su Android: apri il file e scegli Minecraft." },
  glb: { title: "GLB", desc: "Modello 3D con texture PBR e componenti separati." },
  obj: { title: "OBJ (+MTL, texture)", desc: "Archivio ZIP compatibile con Blender e altri software." },
};

interface PartRow { part: string; status: string; note?: string }
interface PathInfo { engine: string; label: string; attempts: { label: string; ok: boolean; message: string }[] }
interface Lic { notes: string[]; credits: { title: string; author?: string; sourceName: string; sourceUrl?: string; license: { label: string }; usage: string }[]; inheritedLicense?: { label: string }; nonCommercialOnly: boolean }

export function StepResult({ result, onRestart, onBack }: { result: PipelineResult; onRestart: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<"glb" | "mc">("glb");
  const f = (k: string) => result.files.find((x) => x.kind === k);
  const r = result.report as {
    durationMs: number;
    normalization: { dimensions: { length: number; width: number; height: number } };
    optimization: { trianglesAfter: number };
    segmentation: { frontDetection: string; autoFlipped: boolean; wheels: unknown[]; glbParts: string[] };
    interior: { seats: number };
    minecraft: { identifier: string; cubes: number; voxelPx: number | null; bones: string[]; palette: number | null; reusedGeometry: boolean };
    parts: PartRow[];
    path?: PathInfo;
    licenses: Lic;
    materials: { notes: string[] };
  };
  const d = r.normalization.dimensions;
  return (
    <Section title="4. Risultato" subtitle={`Elaborato in ${(r.durationMs / 1000).toFixed(1)} s. Tutti i file sono stati verificati prima di essere resi disponibili.`}
      actions={<><button className="btn-ghost" onClick={onBack}>Indietro</button><button className="btn-ghost flex-1 sm:flex-none" onClick={onRestart}>Nuovo veicolo</button></>}>
      <div className="flex rounded-xl border border-line bg-panel-2 p-1 text-sm">
        <button className={`flex-1 rounded-lg py-2 ${tab === "glb" ? "bg-panel font-semibold" : "text-muted"}`} onClick={() => setTab("glb")}>Modello 3D</button>
        <button className={`flex-1 rounded-lg py-2 ${tab === "mc" ? "bg-panel font-semibold" : "text-muted"}`} onClick={() => setTab("mc")}>Anteprima Minecraft</button>
      </div>
      {tab === "glb" && f("glb") && <Viewer3D url={f("glb")!.url} />}
      {tab === "mc" && f("geometry") && f("texture") && <MinecraftPreview geoUrl={f("geometry")!.url} paletteUrl={f("texture")!.url} />}

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat k="Dimensioni" v={`${d.length.toFixed(2)} × ${d.width.toFixed(2)} × ${d.height.toFixed(2)} m`} />
        <Stat k="Percorso" v={r.path?.label ?? "—"} />
        <Stat k="Cubi Minecraft" v={`${r.minecraft.cubes.toLocaleString("it-IT")}${r.minecraft.reusedGeometry ? " (addon originale)" : ` (voxel ${r.minecraft.voxelPx}px)`}`} />
        <Stat k="Posti guidabili" v={String(r.interior.seats)} />
      </div>
      {r.path && r.path.attempts.length > 0 && (
        <details className="card text-xs">
          <summary className="cursor-pointer text-sm font-semibold">Percorso seguito ({r.path.attempts.length} {r.path.attempts.length === 1 ? "passaggio" : "passaggi"})</summary>
          <ul className="mt-2 space-y-1">{r.path.attempts.map((a, i) => <li key={i} className={a.ok ? "text-accent" : "text-muted"}>{a.ok ? "✓" : "✗"} {a.label}: {a.message}</li>)}</ul>
        </details>
      )}
      <div className="card text-sm">
        <p className="mb-2 font-semibold">Parti del veicolo: cosa è ricostruito e cosa è stimato</p>
        <table className="w-full text-xs">
          <tbody>{r.parts.map((p) => (
            <tr key={p.part} className="border-t border-line"><td className="py-1 pr-2">{p.part}</td><td className={`py-1 ${p.status === "dal modello sorgente" ? "text-accent" : p.status === "non presente" ? "text-muted" : "text-warn"}`}>{p.status}{p.note ? ` – ${p.note}` : ""}</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Gli interni non sono mai dichiarati completi: ciò che è &quot;stimato&quot; è ricostruito dalle proporzioni, non da dati reali. Fronte {r.segmentation.frontDetection === "lights" ? "rilevato automaticamente" : "assunto dal modello"}{r.segmentation.autoFlipped ? " (ruotato di 180°)" : ""}.</p>
        {r.materials.notes.length > 0 && <p className="mt-1 text-xs text-muted">{r.materials.notes.join(" ")}</p>}
      </div>
      <details className="card text-sm" open={r.licenses.credits.length > 0}>
        <summary className="cursor-pointer font-semibold">Licenze e crediti ({r.licenses.credits.length})</summary>
        <ul className="mt-2 space-y-1 text-xs">{r.licenses.credits.map((c, i) => <li key={i}>{c.title}{c.author ? ` – ${c.author}` : ""} · {c.sourceUrl ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceName}</a> : c.sourceName} · {c.license.label} · {c.usage}</li>)}</ul>
        {r.licenses.inheritedLicense && <p className="mt-2 text-xs text-warn">Il risultato va distribuito con licenza {r.licenses.inheritedLicense.label} (share-alike).</p>}
        {r.licenses.nonCommercialOnly && <p className="mt-1 text-xs text-warn">Solo uso non commerciale.</p>}
        <p className="mt-1 text-xs text-muted">I crediti sono inclusi in CREDITS.txt dentro il .mcaddon e lo ZIP OBJ, e nei metadati del GLB.</p>
      </details>

      <ul className="space-y-3">
        {(["mcaddon", "glb", "obj"] as const).map((k) => {
          const file = f(k);
          if (!file) return null;
          return (
            <li key={k} className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{LABELS[k].title}</p>
                  <p className="text-xs text-muted">{LABELS[k].desc}</p>
                </div>
                <Badge tone={file.verify?.ok ? "ok" : "danger"}>{file.verify?.ok ? "verificato" : "non verificato"}</Badge>
              </div>
              <a className="btn-primary w-full" href={file.url} download={file.name}>Scarica {file.name} · {formatBytes(file.bytes)}</a>
              {file.verify && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">Controlli eseguiti ({file.verify.checks.filter((c) => c.ok).length}/{file.verify.checks.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {file.verify.checks.map((c) => <li key={c.name} className={c.ok ? "text-text" : "text-danger"}>{c.ok ? "✓" : "✗"} {c.name}{c.detail ? ` – ${c.detail}` : ""}</li>)}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">Come usarlo in Minecraft Bedrock (Android)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>Tocca “Scarica” sul file .mcaddon e, a download finito, aprilo: Android proporrà Minecraft.</li>
          <li>Minecraft importa automaticamente Resource Pack e Behavior Pack.</li>
          <li>Crea o modifica un mondo e attiva entrambi i pacchetti in “Pacchetti risorse” e “Pacchetti comportamenti”.</li>
          <li>Nel mondo usa l&apos;uovo generatore o il comando <code>/summon {r.minecraft.identifier}</code>.</li>
          <li>Tocca il veicolo per salire; il primo posto guida (input come un cavallo).</li>
        </ol>
      </details>
      {f("report") && <a className="text-xs text-muted underline" href={f("report")!.url} target="_blank" rel="noreferrer">Report tecnico completo (JSON)</a>}
    </Section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{k}</p>
      <p className="font-semibold">{v}</p>
    </div>
  );
}
