import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import { QUALITY_PRESETS, type TaskStatus } from "../types";
import type { CreateTaskInput, ModelProvider } from "./types";

const BASE = "https://api.meshy.ai/openapi/v1";

/** Ordine di preferenza delle viste per il multi-image (max 4). */
const VIEW_PRIORITY = ["front_three_quarter", "left", "rear_three_quarter", "front", "rear", "right", "top", "other"];

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env.meshyKey();
  if (!key) throw new AppError("NOT_CONFIGURED", "Provider Meshy non configurato (manca MESHY_API_KEY).");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "Meshy non raggiungibile.");
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* risposta non JSON */
  }
  const msg = typeof body.message === "string" ? body.message : text.slice(0, 200);
  if (res.status === 401 || res.status === 403) throw new AppError("NOT_CONFIGURED", `Chiave Meshy non valida o senza permessi: ${msg}`);
  if (res.status === 402) throw new AppError("INSUFFICIENT_CREDITS", "Crediti Meshy insufficienti per questa generazione.");
  if (res.status === 429) throw new AppError("PROVIDER_RATE_LIMIT", "Limite di richieste Meshy raggiunto. Riprova tra qualche minuto.");
  if (res.status === 404) throw new AppError("NOT_FOUND", "Task Meshy non trovato.");
  if (!res.ok) throw new AppError("PROVIDER_ERROR", `Errore Meshy (${res.status}): ${msg}`);
  return body as T;
}

interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED" | "EXPIRED";
  progress?: number;
  model_urls?: { glb?: string; obj?: string; fbx?: string; usdz?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
}

export const meshy: ModelProvider = {
  id: "meshy",
  label: "Meshy (Multi-Image to 3D)",
  maxImages: 4,
  allowedDownloadHosts: ["assets.meshy.ai"],
  configured: () => Boolean(env.meshyKey()),

  async createTask({ images, quality }: CreateTaskInput) {
    if (images.length === 0) throw new AppError("BAD_REQUEST", "Serve almeno un'immagine.");
    const sorted = [...images].sort((a, b) => VIEW_PRIORITY.indexOf(a.view) - VIEW_PRIORITY.indexOf(b.view)).slice(0, 4);
    const preset = QUALITY_PRESETS[quality];
    const body = {
      image_urls: sorted.map((i) => i.dataUri),
      ai_model: "latest",
      topology: "triangle",
      target_polycount: preset.targetPolycount,
      should_remesh: true,
      should_texture: true,
      enable_pbr: true,
      symmetry_mode: "on",
    };
    const r = await call<{ result?: string }>("/multi-image-to-3d", { method: "POST", body: JSON.stringify(body) });
    if (!r.result) throw new AppError("PROVIDER_ERROR", "Meshy non ha restituito un ID task.");
    return r.result;
  },

  async getStatus(taskId) {
    const t = await call<MeshyTask>(`/multi-image-to-3d/${encodeURIComponent(taskId)}`);
    const map: Record<MeshyTask["status"], TaskStatus["status"]> = {
      PENDING: "queued", IN_PROGRESS: "running", SUCCEEDED: "succeeded", FAILED: "failed", CANCELED: "canceled", EXPIRED: "failed",
    };
    const status = map[t.status] ?? "running";
    if (status === "succeeded" && !t.model_urls?.glb) {
      return { status: "failed", progress: 100, message: "Meshy ha completato il task ma non ha fornito un file GLB." };
    }
    return {
      status,
      progress: typeof t.progress === "number" ? t.progress : null,
      message: t.task_error?.message || undefined,
      thumbnailUrl: t.thumbnail_url,
    };
  },

  async getResultModelUrl(taskId) {
    const t = await call<MeshyTask>(`/multi-image-to-3d/${encodeURIComponent(taskId)}`);
    if (t.status !== "SUCCEEDED") throw new AppError("BAD_REQUEST", `Il task non è completato (stato: ${t.status}).`);
    if (!t.model_urls?.glb) throw new AppError("INVALID_MODEL", "Meshy non ha fornito un file GLB.");
    return t.model_urls.glb;
  },

  async balance() {
    const r = await call<{ balance?: number }>("/balance");
    return typeof r.balance === "number" ? r.balance : null;
  },
};
