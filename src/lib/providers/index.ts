import "server-only";
import { AppError } from "../errors";
import { fal } from "./fal";
import { meshy } from "./meshy";
import type { ModelProvider } from "./types";

export const PROVIDERS: Record<string, ModelProvider> = { meshy, fal };

export function getProvider(id: string): ModelProvider {
  const p = PROVIDERS[id];
  if (!p) throw new AppError("BAD_REQUEST", `Provider sconosciuto: ${id}`);
  if (!p.configured()) throw new AppError("NOT_CONFIGURED", `Il provider ${p.label} non è configurato sul server.`);
  return p;
}
