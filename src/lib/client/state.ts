"use client";
import type { ReferenceCandidate, TaskStatus, VehicleId, VehicleInput, VerifiedReference, View, Quality } from "@/lib/types";

export interface OutputFile { kind: "glb" | "obj" | "mcaddon" | "geometry" | "texture" | "report"; name: string; url: string; bytes: number; verify?: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } }
export interface PipelineResult { jobId: string; files: OutputFile[]; report: Record<string, unknown> }

export interface Features {
  identification: boolean;
  referenceVerificationAI: boolean;
  search: { wikimedia: boolean; brave: boolean; google: boolean };
  providers: { meshy: boolean; fal: boolean };
  defaultProvider: "meshy" | "fal";
  storage: "vercel-blob" | "local" | "missing";
  blenderWorker: boolean;
  accessCodeRequired: boolean;
}

export interface WizardState {
  step: number;
  photo?: string;
  identification?: VehicleId;
  vehicle?: VehicleInput;
  candidates: ReferenceCandidate[];
  verified: VerifiedReference[];
  selection: Record<string, View>;
  usePhoto: boolean;
  photoView: View;
  quality: Quality;
  provider?: "meshy" | "fal";
  task?: { provider: "meshy" | "fal"; taskId: string; createdAt: number };
  taskStatus?: TaskStatus;
  orientation: "auto" | "normal" | "flipped";
  result?: PipelineResult;
}

export const initialState: WizardState = {
  step: 1,
  candidates: [],
  verified: [],
  selection: {},
  usePhoto: true,
  photoView: "front_three_quarter",
  quality: "ULTRA",
  orientation: "auto",
};

const KEY = "v3d.state.v1";

export function loadState(): WizardState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...initialState, ...JSON.parse(raw) };
  } catch {
    /* storage non disponibile */
  }
  return initialState;
}

export function saveState(s: WizardState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    try {
      // la foto può superare la quota: salva senza
      localStorage.setItem(KEY, JSON.stringify({ ...s, photo: undefined }));
    } catch {
      /* ignora */
    }
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}
