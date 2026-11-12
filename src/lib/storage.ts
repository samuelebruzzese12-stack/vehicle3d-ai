import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { env } from "./env";
import { AppError } from "./errors";

const LOCAL_DIR = path.join(process.cwd(), ".data", "jobs");
const SAFE = /^[a-zA-Z0-9_.-]+$/;

export async function saveFile(jobId: string, name: string, data: Buffer | Uint8Array | string, contentType: string) {
  if (!SAFE.test(jobId) || !SAFE.test(name)) throw new AppError("BAD_REQUEST", "Nome file non valido.");
  const token = env.blobToken();
  if (token) {
    const blob = await put(`vehicle3d/${jobId}/${name}`, Buffer.from(data as Uint8Array), { access: "public", contentType, token, addRandomSuffix: false, allowOverwrite: true });
    return blob.url;
  }
  if (env.isVercel()) throw new AppError("NOT_CONFIGURED", "Storage non configurato: collega Vercel Blob al progetto (BLOB_READ_WRITE_TOKEN).");
  const dir = path.join(LOCAL_DIR, jobId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), data);
  return `/api/files/${jobId}/${name}`;
}

export async function readLocalFile(jobId: string, name: string) {
  if (!SAFE.test(jobId) || !SAFE.test(name)) throw new AppError("BAD_REQUEST", "Nome file non valido.");
  try {
    return await readFile(path.join(LOCAL_DIR, jobId, name));
  } catch {
    throw new AppError("NOT_FOUND", "File non trovato.");
  }
}
