"use client";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

function accessCode() {
  try {
    return localStorage.getItem("v3d.accessCode") ?? "";
  } catch {
    return "";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const code = accessCode();
  if (code) headers["x-access-code"] = code;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, body });
  } catch {
    throw new ApiError("NETWORK", "Connessione assente o instabile. Controlla la rete e riprova.", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non JSON */
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } })?.error;
    if (res.status === 413) throw new ApiError("TOO_LARGE", "File troppo grande per il server.", 413);
    if (res.status === 504) throw new ApiError("TIMEOUT", "Il server ha impiegato troppo tempo. Riprova.", 504);
    throw new ApiError(err?.code ?? "HTTP", err?.message ?? `Errore ${res.status}`, res.status, err?.details);
  }
  return data as T;
}

/** Ridimensiona nel browser (max 1600px) e ricodifica JPEG: le foto da smartphone restano sotto i limiti di Vercel. */
export async function fileToJpegDataUri(file: File, maxSide = 1600, quality = 0.88): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Il file selezionato non è un'immagine.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("Impossibile leggere l'immagine (formato non supportato dal browser).");
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Le miniature remote passano dal nostro server (/api/thumb). */
export function thumb(url: string) {
  return url.startsWith("data:") ? url : `/api/thumb?u=${encodeURIComponent(url)}`;
}
