import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import type { TaskStatus } from "../types";
import type { CreateTaskInput, ModelProvider } from "./types";

/**
 * fal.ai – Hunyuan3D v2 multi-view (vista anteriore, posteriore, sinistra).
 * API a coda: submit → status → result.
 */
const APP = "fal-ai/hunyuan3d/v2/multi-view";
const APP_BASE = "fal-ai/hunyuan3d"; // le URL di stato/risultato usano l'ID app senza sotto-percorso
const QUEUE = "https://queue.fal.run";

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const key = env.falKey();
  if (!key) throw new AppError("NOT_CONFIGURED", "Provider fal.ai non configurato (manca FAL_KEY).");
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "fal.ai non raggiungibile.");
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non JSON */
  }
  const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? text).slice(0, 200);
  if (res.status === 401 || res.status === 403) throw new AppError("NOT_CONFIGURED", `Chiave fal.ai non valida: ${detail}`);
  if (res.status === 402) throw new AppError("INSUFFICIENT_CREDITS", "Credito fal.ai insufficiente.");
  if (res.status === 429) throw new AppError("PROVIDER_RATE_LIMIT", "Limite di richieste fal.ai raggiunto.");
  if (!res.ok && res.status !== 202) throw new AppError("PROVIDER_ERROR", `Errore fal.ai (${res.status}): ${detail}`);
  return body as T;
}

function pick(images: CreateTaskInput["images"], views: string[]) {
  for (const v of views) {
    const f = images.find((i) => i.view === v);
    if (f) return f.dataUri;
  }
  return undefined;
}

export const fal: ModelProvider = {
  id: "fal",
  label: "fal.ai (Hunyuan3D v2 multi-view)",
  maxImages: 3,
  allowedDownloadHosts: ["fal.media", "v3.fal.media", "v3b.fal.media", "storage.googleapis.com"],
  configured: () => Boolean(env.falKey()),

  async createTask({ images, quality }) {
    const front = pick(images, ["front", "front_three_quarter"]);
    const back = pick(images, ["rear", "rear_three_quarter"]);
    const left = pick(images, ["left", "right"]);
    if (!front || !back || !left) {
      throw new AppError("BAD_REQUEST", "fal.ai Hunyuan3D multi-view richiede una vista anteriore, una posteriore e una laterale.");
    }
    const r = await call<{ request_id?: string }>(`${QUEUE}/${APP}`, {
      method: "POST",
      body: JSON.stringify({
        front_image_url: front,
        back_image_url: back,
        left_image_url: left,
        textured_mesh: true,
        octree_resolution: quality === "STANDARD" ? 256 : 512,
        num_inference_steps: quality === "ULTRA" ? 50 : 30,
      }),
    });
    if (!r.request_id) throw new AppError("PROVIDER_ERROR", "fal.ai non ha restituito un request_id.");
    return r.request_id;
  },

  async getStatus(taskId) {
    const r = await call<{ status?: string; queue_position?: number }>(`${QUEUE}/${APP_BASE}/requests/${encodeURIComponent(taskId)}/status`);
    const map: Record<string, TaskStatus["status"]> = { IN_QUEUE: "queued", IN_PROGRESS: "running", COMPLETED: "succeeded" };
    const status = map[r.status ?? ""] ?? "running";
    if (status === "succeeded") {
      // COMPLETED include anche i fallimenti: controlliamo il risultato.
      try {
        await this.getResultModelUrl(taskId);
      } catch (e) {
        return { status: "failed", progress: 100, message: (e as Error).message };
      }
    }
    return { status, progress: null, message: r.queue_position != null ? `In coda, posizione ${r.queue_position}` : undefined };
  },

  async getResultModelUrl(taskId) {
    const r = await call<{ model_mesh?: { url?: string }; detail?: unknown }>(`${QUEUE}/${APP_BASE}/requests/${encodeURIComponent(taskId)}`);
    const url = r.model_mesh?.url;
    if (!url) throw new AppError("INVALID_MODEL", "fal.ai non ha restituito un modello.");
    return url;
  },
};
