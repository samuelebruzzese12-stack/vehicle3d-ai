"use client";
import type { Credit, LicenseInfo } from "@/lib/licenses";
import type { Livery } from "@/lib/materials/presets";
import type { Quality, ReferenceCandidate, VehicleInput } from "@/lib/types";

export interface OutputFile { kind: "glb" | "obj" | "mcaddon" | "geometry" | "texture" | "report" | "credits"; name: string; url: string; bytes: number; verify?: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } }
export interface PipelineResult { jobId: string; files: OutputFile[]; report: Record<string, unknown>; notes?: string[] }

export interface WikiCandidate {
  qid: string; label: string; description: string; category: VehicleInput["category"]; manufacturer?: string; make: string; model: string;
  yearFrom?: number; yearTo?: number; yearsSource?: string; dimensions_m?: { length: number; width: number; height: number }; massKg?: number; crew?: number;
  commonsCategory?: string; image?: string; wikipedia: { lang: string; title: string; url: string; extract?: string }[]; variants: { qid: string; label: string }[];
  sources: Credit[]; input: VehicleInput;
}

export interface ModelCandidate {
  source: "sketchfab" | "github"; id: string; name: string; author: string; pageUrl: string; thumbnail?: string; license: LicenseInfo;
  faces?: number; formats: { type: string; size?: number }[]; downloadable: boolean; relevance: number; usable: boolean; blockedReason?: string;
  credit: Credit; fileUrl?: string; kind?: "modello" | "addon";
}

export interface SourcesResult {
  photos: ReferenceCandidate[];
  textures: { slot: string; id: string; name: string; pageUrl: string; credit: Credit; maps: Record<string, string | undefined> }[];
  models: ModelCandidate[];
  addons: ModelCandidate[];
  summary: { source: string; ok: boolean; count: number; message?: string }[];
  manualLinks: { label: string; url: string }[];
}

export interface Status {
  sources: Record<string, boolean>;
  engines: { A: { available: boolean; backends: string[]; hfToken: boolean }; B: { available: boolean }; C: { available: boolean }; D: { available: boolean } };
  aiModels: { id: string; name: string; license: string; licenseUrl: string; outputUsable: boolean; restrictions?: string; gpu: string; enabled: boolean; space?: string }[];
  storage: "vercel-blob" | "local" | "missing";
  accessCodeRequired: boolean;
}

export interface WizardState {
  step: number;
  inputMode: "nome" | "foto";
  query: string;
  photo?: string;
  candidates: WikiCandidate[];
  vehicle?: WikiCandidate;
  vehicleInput?: VehicleInput;
  sources?: SourcesResult;
  /** titoli Commons scelti come riferimento per l'AI */
  aiImages: string[];
  mode: "auto" | "A" | "B" | "C" | "D" | "upload";
  candidateId?: { id: string; source: "sketchfab" | "github" | "commons" };
  quality: Quality;
  orientation: "auto" | "normal" | "flipped";
  livery: Livery;
  commercial: boolean;
  result?: PipelineResult;
}

export const initialState: WizardState = {
  step: 1, inputMode: "nome", query: "", candidates: [], aiImages: [], mode: "auto", quality: "ULTRA", orientation: "auto", livery: { mode: "originale" }, commercial: false,
};

const KEY = "v3d.state.v2";
export function loadState(): WizardState {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...initialState, ...JSON.parse(raw) }; } catch { /* storage non disponibile */ }
  return initialState;
}
export function saveState(s: WizardState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { try { localStorage.setItem(KEY, JSON.stringify({ ...s, photo: undefined })); } catch { /* ignora */ } }
}
export function clearState() { try { localStorage.removeItem(KEY); } catch { /* ignora */ } }
