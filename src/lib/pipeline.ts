import "server-only";
import { randomBytes } from "node:crypto";
import type { Document } from "@gltf-transform/core";
import { AppError } from "./errors";
import { checkUse, creditsText, type Credit } from "./licenses";
import { applyLiveryToDoc, applyTextureToNode, voxelColorOverride } from "./materials/apply";
import { DEFAULT_LIVERY, type Livery } from "./materials/presets";
import { blenderPreprocess } from "./mesh/blender";
import { readGlb, writeGlb } from "./mesh/io";
import { exportObjZip } from "./mesh/obj";
import { addInteriorToDoc, applySegmentation, estimateInterior, interiorSeatPositions } from "./mesh/parts";
import { buildSoup, normalize, optimize, rotate180 } from "./mesh/scene";
import { segment } from "./mesh/segment";
import type { BedrockGeometry } from "./minecraft/bedrock-import";
import { addonFromBedrock, buildAddon } from "./minecraft/addon";
import { greedyBoxes, voxelize } from "./minecraft/voxel";
import { saveFile } from "./storage";
import { QUALITY_PRESETS, TRACKED, type Quality, type VehicleInput } from "./types";
import { verifyGlb, verifyMcaddon, verifyObjZip, type VerifyResult } from "./verify";

export type EngineId = "A" | "B" | "C" | "D" | "upload";

export interface EnginePath {
  engine: EngineId;
  label: string;
  /** tentativi fatti dall'orchestratore (anche falliti) */
  attempts: { engine: EngineId; label: string; ok: boolean; message: string }[];
}

export interface PipelineOptions {
  vehicle: VehicleInput;
  quality: Quality;
  /** auto = fanali/cannone indicano il fronte; normal/flipped = scelta manuale */
  orientation?: "auto" | "normal" | "flipped";
  livery?: Livery;
  /** fonti usate (modelli, addon, immagini per l'AI, texture) per licenze e crediti */
  credits?: Credit[];
  /** l'utente dichiara uso commerciale */
  commercial?: boolean;
  path?: EnginePath;
  /** motore D: geometria Bedrock originale da riusare */
  bedrock?: { geometry: BedrockGeometry; texture: Uint8Array };
  seatColor?: [number, number, number];
  dashColor?: [number, number, number];
  /** texture reale per i sedili dell'abitacolo stimato (es. tessuto Poly Haven CC0) */
  seatTexture?: { image: Uint8Array; mime: string; credit: Credit };
  icon?: Buffer;
  source: string;
  log?: (msg: string) => void;
}

export interface OutputFile { kind: "glb" | "obj" | "mcaddon" | "geometry" | "texture" | "report" | "credits"; name: string; url: string; bytes: number; verify?: VerifyResult }
export interface PipelineResult { jobId: string; files: OutputFile[]; report: Record<string, unknown> }

/** Stato di ogni parte: cosa è davvero ricostruito e cosa è stimato. */
export type PartStatus = "dal modello sorgente" | "separata con euristica" | "stimata proceduralmente" | "non presente";
export interface PartReport { part: string; status: PartStatus; note?: string }

const MAX_CUBES = 7000;

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "veicolo";
}

/** Parti già presenti nel modello sorgente, riconosciute dai nomi di nodi, mesh e materiali. */
const SOURCE_PART_RULES: { part: string; re: RegExp }[] = [
  { part: "sedili", re: /seat|sedil|sitz|siège|chair/i },
  { part: "volante", re: /steer|volant|lenkrad/i },
  { part: "plancia", re: /dash|plancia|armatur|instrument|cockpit/i },
  { part: "abitacolo", re: /interior|interni|innenraum/i },
  { part: "motore", re: /engine|motore|motor\b|moteur/i },
  { part: "ruote", re: /wheel|ruot|tire|tyre|rim\b|cerchi/i },
  { part: "porte", re: /door|porta|portiera|tür/i },
  { part: "vetri", re: /glass|vetr|window|windshield|parabrezza|glas/i },
  { part: "fari", re: /headlight|light|faro|fanal|lamp/i },
  { part: "cingoli", re: /track|cingol|kette/i },
  { part: "torretta", re: /turret|torrett|turm/i },
  { part: "cannone", re: /barrel|gun|cannon|kanone/i },
];

function detectSourceParts(doc: Document): Record<string, string[]> {
  const names = [
    ...doc.getRoot().listNodes().map((n) => n.getName()),
    ...doc.getRoot().listMeshes().map((m) => m.getName()),
    ...doc.getRoot().listMaterials().map((m) => m.getName()),
  ].filter(Boolean);
  const found: Record<string, string[]> = {};
  for (const r of SOURCE_PART_RULES) {
    const hits = names.filter((n) => r.re.test(n));
    if (hits.length) found[r.part] = [...new Set(hits)].slice(0, 6);
  }
  return found;
}

export async function runPipeline(glb: Uint8Array, opts: PipelineOptions): Promise<PipelineResult> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const preset = QUALITY_PRESETS[opts.quality];
  const jobId = randomBytes(12).toString("hex");
  const v = opts.vehicle;
  const base = slugify(`${v.make}_${v.model}${v.year ? `_${v.year}` : ""}`);
  const livery = opts.livery ?? DEFAULT_LIVERY;
  const credits = [...(opts.credits ?? [])];
  const tracked = TRACKED.has(v.category);

  // 1. licenze: nessun export se i diritti non lo consentono
  const lic = checkUse(credits, { commercial: Boolean(opts.commercial) });
  if (!lic.allowed) throw new AppError("LICENSE_BLOCKED", `Esportazione non consentita dalle licenze: ${lic.blocked.join(" ")}`, lic);

  let blender: Record<string, unknown> = { used: false };
  if (!opts.bedrock) {
    try {
      const b = await blenderPreprocess(glb, preset.targetPolycount);
      if (b) {
        log("Pulizia mesh con Blender (worker)");
        glb = b.glb;
        blender = { used: true, ...b.report };
      }
    } catch (e) {
      blender = { used: false, error: (e as Error).message }; // worker opzionale: si prosegue
    }
  }

  log("Lettura e validazione del modello sorgente");
  let doc: Document;
  try {
    doc = await readGlb(glb);
  } catch (e) {
    throw new AppError("INVALID_MODEL", `Il file del modello non è un GLB valido: ${(e as Error).message}`);
  }
  const sourceParts = detectSourceParts(doc);

  log("Normalizzazione (orientamento, scala reale, appoggio a terra)");
  const norm = await normalize(doc, { targetLength: v.dimensions_m?.length, flipFront: opts.orientation === "flipped" });

  log("Ottimizzazione mesh e texture");
  const opt = opts.bedrock ? { trianglesBefore: 0, trianglesAfter: 0, textures: 1, skipped: "geometria Bedrock originale" } : await optimize(doc, preset.targetPolycount, preset.textureSize);

  log("Segmentazione componenti");
  let soup = await buildSoup(doc);
  let seg = segment(soup, { category: v.category });
  let autoFlipped = false;
  if ((opts.orientation ?? "auto") === "auto" && seg.flipSuggested && !opts.bedrock) {
    log(tracked ? "Cannone rivolto all'indietro: rotazione di 180°" : "Fanali posteriori sul lato anteriore: rotazione di 180°");
    rotate180(doc);
    soup = await buildSoup(doc);
    seg = segment(soup, { category: v.category });
    autoFlipped = true;
  }

  // 2. abitacolo: stimato solo se il sorgente non lo contiene e il veicolo ha un abitacolo visibile
  // "cabin"/"abitacolo" da soli non bastano (spesso indicano la cabina esterna): servono sedili o plancia
  const hasSourceInterior = Boolean(sourceParts.sedili || sourceParts.plancia);
  const estimateCabin = !hasSourceInterior && !tracked && !opts.bedrock;
  const interior = estimateCabin
    ? estimateInterior(seg, {
        seats: v.seats ?? (v.category === "autobus" ? 40 : v.category === "camion" ? 2 : 5),
        category: v.category,
        seatColor: opts.seatColor ?? [55, 55, 60],
        dashColor: opts.dashColor ?? [35, 35, 38],
      })
    : [];
  let seats = interiorSeatPositions(interior);
  if (!seats.length) {
    // posti guidabili anche senza abitacolo stimato: conducente avanti a sinistra, altri dietro (carri: equipaggio sullo scafo)
    const n = Math.max(1, Math.min(v.seats ?? (tracked ? 3 : 2), 8));
    const top = tracked ? (seg.tracked?.deckY ?? seg.dims.height * 0.6) : seg.dims.height * 0.35;
    seats = Array.from({ length: n }, (_, i) => ({ x: (i % 2 === 0 ? 1 : -1) * seg.dims.width * 0.18, y: top, z: seg.dims.length * (0.2 - 0.25 * Math.floor(i / 2)) }));
  }

  log("Voxelizzazione per Minecraft");
  let voxelPx: number = preset.voxelPx;
  const override = voxelColorOverride(livery);
  let grid = voxelize(soup, seg, voxelPx / 16, preset.maxPalette, interior, "interior", override);
  let boxes = greedyBoxes(grid);
  const attempts = [{ voxelPx, cubes: boxes.length }];
  while (!opts.bedrock && boxes.length > MAX_CUBES && voxelPx < 4) {
    voxelPx = Math.round(voxelPx * 1.5 * 100) / 100;
    grid = voxelize(soup, seg, voxelPx / 16, preset.maxPalette, interior, "interior", override);
    boxes = greedyBoxes(grid);
    attempts.push({ voxelPx, cubes: boxes.length });
  }

  log("Separazione componenti nel GLB e materiali");
  let glbParts: string[] = [];
  if (!opts.bedrock) {
    const parts = await applySegmentation(doc, soup, seg);
    glbParts = parts.parts.map((p) => p.name);
  } else {
    glbParts = doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => n.getName());
  }
  addInteriorToDoc(doc, interior);
  const materialNotes = await applyLiveryToDoc(doc, livery);
  if (opts.seatTexture && interior.length) {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === "Abitacolo");
    if (node) {
      applyTextureToNode(doc, node, opts.seatTexture.image, opts.seatTexture.mime, "tessuto");
      credits.push(opts.seatTexture.credit);
      materialNotes.push(`Texture sedili: ${opts.seatTexture.credit.title} (${opts.seatTexture.credit.license.label}).`);
    }
  }

  // 3. crediti dentro i file
  const header = `${v.make} ${v.model}${v.year ? ` (${v.year})` : ""} – generato con Vehicle3D AI`;
  const creditsTxt = credits.length ? creditsText(credits, header) + (lic.inheritedLicense ? `\nQuesto risultato è distribuito con licenza ${lic.inheritedLicense.label} (share-alike).\n` : "") : "";
  const asset = doc.getRoot().getAsset();
  asset.generator = "Vehicle3D AI";
  if (credits.length) {
    asset.copyright = credits.filter((c) => c.usage !== "documentazione").map((c) => `${c.title}${c.author ? ` – ${c.author}` : ""} (${c.license.label})`).join("; ").slice(0, 2000);
    asset.extras = { ...(asset.extras as object), vehicle3d_credits: credits.map((c) => ({ title: c.title, author: c.author, source: c.sourceName, url: c.sourceUrl, license: c.license.label, usage: c.usage })) };
  }

  log("Esportazione GLB");
  const glbOut = await writeGlb(doc);
  log("Esportazione OBJ");
  const obj = await exportObjZip(doc, base, creditsTxt ? { "CREDITS.txt": creditsTxt } : {});
  log("Costruzione pacchetto Minecraft Bedrock");
  const slug = `${base}_${jobId.slice(0, 6)}`;
  const displayName = `${v.make} ${v.model}${v.year ? ` ${v.year}` : ""}`;
  const description = `Generato con Vehicle3D AI (${opts.source}). Scala 1 blocco = 1 m.`;
  const addon = opts.bedrock
    ? await addonFromBedrock({ slug, displayName, description, geometry: opts.bedrock.geometry, texture: opts.bedrock.texture, seg, seats, icon: opts.icon, credits })
    : await buildAddon({ slug, displayName, grid, boxes, seg, seats, icon: opts.icon, description, credits });

  log("Verifica degli output");
  const [vGlb, vObj, vMc] = await Promise.all([verifyGlb(glbOut), verifyObjZip(obj.zip), verifyMcaddon(addon.mcaddon)]);
  const failed = ([["GLB", vGlb], ["OBJ", vObj], ["MCADDON", vMc]] as const).filter(([, r]) => !r.ok);

  // 4. stato delle parti: ricostruite vs stimate
  const mcBones = opts.bedrock ? opts.bedrock.geometry.bones.map((b) => b.name) : [...new Set(boxes.map((b) => grid.labels[b.part]))];
  const has = (re: RegExp) => mcBones.some((b) => re.test(b)) || glbParts.some((b) => re.test(b));
  const fromSource = (k: string) => Boolean(sourceParts[k]);
  const status = (srcKey: string, heuristic: boolean, estimated = false): PartStatus => (fromSource(srcKey) ? "dal modello sorgente" : heuristic ? "separata con euristica" : estimated ? "stimata proceduralmente" : "non presente");
  const parts: PartReport[] = [
    { part: "Carrozzeria / scafo", status: "dal modello sorgente" },
    ...(tracked
      ? [
          { part: "Cingoli", status: status("cingoli", has(/track_/)) },
          { part: "Torretta", status: status("torretta", has(/turret/)) },
          { part: "Cannone", status: status("cannone", has(/barrel/)) },
        ]
      : [
          { part: "Ruote", status: status("ruote", has(/wheel_/)), note: seg.wheels.length ? `${seg.wheels.length} ruote, pivot sul mozzo` : undefined },
          { part: "Porte", status: status("porte", has(/door_/)) },
          { part: "Vetri", status: status("vetri", has(/glass/)) },
          { part: "Fari e fanali", status: status("fari", has(/light_/)) },
        ]),
    { part: "Sedili", status: fromSource("sedili") ? "dal modello sorgente" : interior.length ? "stimata proceduralmente" : "non presente", note: tracked && !fromSource("sedili") ? "vano equipaggio non documentato: non ricostruito" : undefined },
    { part: "Plancia", status: fromSource("plancia") ? "dal modello sorgente" : interior.some((b) => b.kind === "dash") ? "stimata proceduralmente" : "non presente" },
    { part: "Volante", status: fromSource("volante") ? "dal modello sorgente" : interior.some((b) => b.kind === "steering") ? "stimata proceduralmente" : "non presente" },
    { part: "Motore", status: fromSource("motore") ? "dal modello sorgente" : "non presente", note: fromSource("motore") ? undefined : "non visibile/documentato nel sorgente: non inventato" },
  ];

  const report = {
    jobId,
    vehicle: v,
    quality: opts.quality,
    source: opts.source,
    path: opts.path,
    durationMs: Date.now() - t0,
    licenses: { ...lic, credits },
    blender,
    normalization: norm,
    optimization: opt,
    sourceParts,
    parts,
    interiorComplete: false,
    segmentation: {
      method: tracked ? "euristica geometrica per cingolati (stima)" : "euristica geometrica + colore (stima)",
      frontDetection: seg.frontDetected,
      orientation: opts.orientation ?? "auto",
      autoFlipped,
      wheels: seg.wheels.map((w) => ({ name: w.name, radius_m: +w.radius.toFixed(3), center: w.center.map((c) => +c.toFixed(3)) })),
      tracked: seg.tracked,
      triangles: seg.stats,
      glbParts,
    },
    interior: { method: estimateCabin ? "procedurale stimata da proporzioni e posti" : hasSourceInterior ? "dal modello sorgente" : "non ricostruito", boxes: interior.length, seats: seats.length },
    materials: { livery, notes: materialNotes },
    minecraft: {
      identifier: addon.identifier,
      reusedGeometry: Boolean(opts.bedrock),
      voxelPx: opts.bedrock ? null : voxelPx,
      attempts,
      cubes: vMc.cubes,
      palette: opts.bedrock ? null : grid.palette.length,
      bones: mcBones,
      minEngine: "1.21.0",
    },
    verification: { glb: vGlb, obj: vObj, mcaddon: vMc },
  };

  if (failed.length) {
    throw new AppError("VERIFICATION_FAILED", `Verifica fallita per: ${failed.map(([n]) => n).join(", ")}. Nessun file è stato reso disponibile.`, report.verification);
  }

  log("Salvataggio file");
  const files: OutputFile[] = [];
  const save = async (kind: OutputFile["kind"], name: string, data: Buffer | Uint8Array | string, type: string, verify?: VerifyResult) => {
    const url = await saveFile(jobId, name, data, type);
    files.push({ kind, name, url, bytes: typeof data === "string" ? Buffer.byteLength(data) : data.byteLength, verify });
  };
  await save("glb", `${base}.glb`, glbOut, "model/gltf-binary", vGlb);
  await save("obj", `${base}_obj.zip`, obj.zip, "application/zip", vObj);
  await save("mcaddon", `${base}.mcaddon`, addon.mcaddon, "application/octet-stream", vMc);
  await save("geometry", `${base}.geo.json`, JSON.stringify(addon.geometry), "application/json");
  await save("texture", `${base}_texture.png`, addon.texturePng, "image/png");
  if (creditsTxt) await save("credits", `CREDITS.txt`, creditsTxt, "text/plain; charset=utf-8");
  await save("report", `report.json`, JSON.stringify(report, null, 2), "application/json");
  return { jobId, files, report };
}
