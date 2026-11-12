import "server-only";
import { AppError } from "../errors";

export const USER_AGENT = "Vehicle3D-AI/2.0 (https://github.com/samuelebruzzese12-stack/vehicle3d-ai)";

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GetJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  cache?: boolean;
  /** nome leggibile della fonte, per i messaggi di errore */
  source: string;
}

/**
 * GET JSON con retry sui limiti di frequenza (429/503, rispettando Retry-After),
 * timeout e cache breve. Non aggira autenticazioni né limiti: se il servizio rifiuta, l'errore viene riportato.
 */
export async function getJson<T = Record<string, unknown>>(url: string, opts: GetJsonOptions): Promise<T> {
  const key = url + JSON.stringify(opts.headers ?? {});
  if (opts.cache !== false) {
    const c = cache.get(key);
    if (c && Date.now() - c.at < CACHE_MS) return c.data as T;
  }
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      });
    } catch {
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new AppError("UPSTREAM_TIMEOUT", `${opts.source} non raggiungibile.`);
    }
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Math.max(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0, 1500 * 2 ** attempt), 15000));
      continue;
    }
    if (res.status === 429) throw new AppError("PROVIDER_RATE_LIMIT", `${opts.source}: limite di richieste del servizio gratuito raggiunto. Riprova tra qualche minuto.`);
    if (res.status === 401 || res.status === 403) throw new AppError("NOT_CONFIGURED", `${opts.source}: accesso negato (${res.status}).`);
    if (res.status === 404) throw new AppError("NOT_FOUND", `${opts.source}: risorsa non trovata.`);
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `${opts.source}: errore ${res.status}.`);
    const data = (await res.json()) as T;
    if (opts.cache !== false) cache.set(key, { at: Date.now(), data });
    return data;
  }
}

/** Esegue le richieste in sequenza con una piccola pausa (per servizi che chiedono di non parallelizzare). */
export async function sequential<T, R>(items: T[], fn: (t: T) => Promise<R>, gapMs = 150): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (const it of items) {
    try {
      out.push({ status: "fulfilled", value: await fn(it) });
    } catch (reason) {
      out.push({ status: "rejected", reason });
    }
    if (gapMs) await sleep(gapMs);
  }
  return out;
}
