import "server-only";
import { randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { readGlb, writeGlb } from "./mesh/io";
import { addInteriorToDoc, applySegmentation, estimateInterior, interiorSeatPositions } from "./mesh/parts";
import { buildSoup, normalize, optimize, rotate180 } from "./mesh/scene";
import { segment } from "./mesh/segment";
import { exportObjZip } from "./mesh/obj";
import { buildAddon } from "./minecraft/addon";
import { greedyBoxes, voxelize } from "./minecraft/voxel";
import { saveFile } from "./storage";
import { QUALITY_PRESETS, type Quality, type VehicleInput } from "./types";
import { verifyGlb, verifyMcaddon, verifyObjZip, type VerifyResult } from "./verify";

export interface PipelineOptions {
  vehicle: VehicleInput;
  quality: Quality;
  /** auto = usa i fanali per capire il lato anteriore; normal/flipped = scelta manuale */
  orientation?: "auto" | "normal" | "flipped";
  seatColor?: [number, number, number];
  dashColor?: [number, number, number];
  icon?: Buffer;
  source: string;
  log?: (msg: string) => void;
}

export interface OutputFile { kind: "glb" | "obj" | "mcaddon" | "geometry" | "texture" | "report"; name: string; url: string; bytes: number; verify?: VerifyResult }

export interface PipelineResult {
  jobId: string;
  files: OutputFile[];
  report: Record<string, unknown>;
}

const MAX_CUBES = 7000;

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "veicolo";
}

export async function runPipeline(glb: Uint8Array, opts: PipelineOptions): Promise<PipelineResult> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const preset = QUALITY_PRESETS[opts.quality];
  const jobId = randomBytes(12).toString("hex");
  const v = opts.vehicle;
  const base = slugify(`${v.make}_${v.model}${v.year ? `_${v.year}` : ""}`);

  log("Lettura e validazione del modello sorgente");
  let doc;
  try {
    doc = await readGlb(glb);
  } catch (e) {
    throw new AppError("INVALID_MODEL", `Il file del modello non è un GLB valido: ${(e as Error).message}`);
  }

  log("Normalizzazione (orientamento, scala reale, appoggio a terra)");
  const norm = await normalize(doc, { targetLength: v.dimensions_m?.length, flipFront: opts.orientation === "flipped" });

  log("Ottimizzazione mesh e texture");
  const opt = await optimize(doc, preset.targetPolycount, preset.textureSize);

  log("Segmentazione componenti");
  let soup = await buildSoup(doc);
  let seg = segment(soup, { category: v.category });
  let autoFlipped = false;
  if ((opts.orientation ?? "auto") === "auto" && seg.flipSuggested) {
    log("Fanali posteriori rilevati sul lato anteriore: rotazione di 180°");
    rotate180(doc);
    soup = await buildSoup(doc);
    seg = segment(soup, { category: v.category });
    autoFlipped = true;
  }

  log("Ricostruzione abitacolo (stima procedurale)");
  const interior = estimateInterior(seg, {
    seats: v.seats ?? (v.category === "autobus" ? 40 : v.category === "camion" ? 2 : 5),
    category: v.category,
    seatColor: opts.seatColor ?? [55, 55, 60],
    dashColor: opts.dashColor ?? [35, 35, 38],
  });
  const seats = interiorSeatPositions(interior);

  log("Voxelizzazione per Minecraft");
  let voxelPx: number = preset.voxelPx;
  let grid = voxelize(soup, seg, voxelPx / 16, preset.maxPalette, interior);
  let boxes = greedyBoxes(grid);
  const attempts = [{ voxelPx, cubes: boxes.length }];
  while (boxes.length > MAX_CUBES && voxelPx < 4) {
    voxelPx = Math.round(voxelPx * 1.5 * 100) / 100;
    grid = voxelize(soup, seg, voxelPx / 16, preset.maxPalette, interior);
    boxes = greedyBoxes(grid);
    attempts.push({ voxelPx, cubes: boxes.length });
  }

  log("Separazione nodi GLB");
  const parts = await applySegmentation(doc, soup, seg);
  addInteriorToDoc(doc, interior);
  doc.getRoot().getAsset().generator = "Vehicle3D AI";

  log("Esportazione GLB");
  const glbOut = await writeGlb(doc);
  log("Esportazione OBJ");
  const obj = await exportObjZip(doc, base);
  log("Costruzione pacchetto Minecraft Bedrock");
  const addon = await buildAddon({
    slug: `${base}_${jobId.slice(0, 6)}`,
    displayName: `${v.make} ${v.model}${v.year ? ` ${v.year}` : ""}`,
    grid, boxes, seg, seats, icon: opts.icon,
    description: `Generato con Vehicle3D AI (${opts.source}). Scala 1 blocco = 1 m.`,
  });

  log("Verifica degli output");
  const [vGlb, vObj, vMc] = await Promise.all([verifyGlb(glbOut), verifyObjZip(obj.zip), verifyMcaddon(addon.mcaddon)]);
  const failed = [["GLB", vGlb], ["OBJ", vObj], ["MCADDON", vMc]].filter(([, r]) => !(r as VerifyResult).ok);

  const report = {
    jobId,
    vehicle: v,
    quality: opts.quality,
    source: opts.source,
    durationMs: Date.now() - t0,
    normalization: norm,
    optimization: opt,
    segmentation: {
      method: "euristica geometrica + colore (stima)",
      frontDetection: seg.frontDetected,
      orientation: opts.orientation ?? "auto",
      autoFlipped,
      wheels: seg.wheels.map((w) => ({ name: w.name, radius_m: +w.radius.toFixed(3), center: w.center.map((c) => +c.toFixed(3)) })),
      triangles: seg.stats,
      glbParts: parts.parts.map((p) => p.name),
    },
    interior: { method: "procedurale stimata da proporzioni e posti", boxes: interior.length, seats: seats.length },
    minecraft: {
      identifier: addon.identifier,
      voxelPx,
      attempts,
      cubes: boxes.length,
      palette: grid.palette.length,
      bones: [...new Set(boxes.map((b) => grid.labels[b.part]))],
      minEngine: "1.21.0",
    },
    verification: { glb: vGlb, obj: vObj, mcaddon: vMc },
  };

  if (failed.length) {
    // non rendiamo scaricabili output che non superano la verifica
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
  await save("texture", `${base}_palette.png`, addon.texturePng, "image/png");
  await save("report", `report.json`, JSON.stringify(report, null, 2), "application/json");
  return { jobId, files, report };
}
