import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "next/server";
import { AppError, toErrorBody } from "./errors";
import { env } from "./env";

/** Blocca indirizzi privati/locali per evitare SSRF quando scarichiamo URL forniti da terzi. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("BAD_REQUEST", "URL non valido.");
  }
  if (url.protocol !== "https:") throw new AppError("BAD_REQUEST", "Sono accettati solo URL https.");
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new AppError("BAD_REQUEST", "Indirizzo non consentito.");
    return url;
  }
  try {
    const addrs = await lookup(url.hostname, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) throw new AppError("BAD_REQUEST", "Indirizzo non consentito.");
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Se il DNS locale non risolve (es. ambienti con proxy) lasciamo decidere a fetch.
  }
  return url;
}

export interface FetchLimitedOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
  checkPublic?: boolean;
}

/** Scarica una risorsa con limite di dimensione e timeout. */
export async function fetchLimited(raw: string, opts: FetchLimitedOptions, attempt = 0): Promise<{ buffer: Buffer; contentType: string }> {
  if (opts.checkPublic !== false && attempt === 0) await assertPublicUrl(raw);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(raw, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Vehicle3D-AI/2.0 (https://github.com/samuelebruzzese12-stack/vehicle3d-ai)", ...opts.headers },
    });
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      // limite del servizio gratuito: attende come richiesto (Retry-After) e riprova
      const ra = Number(res.headers.get("retry-after"));
      clearTimeout(t);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(Number.isFinite(ra) ? ra * 1000 : 0, 1500 * 2 ** attempt), 15000)));
      return fetchLimited(raw, opts, attempt + 1);
    }
    if (res.status === 429) throw new AppError("PROVIDER_RATE_LIMIT", "Limite di download del servizio raggiunto. Riprova tra qualche minuto.");
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `Download fallito (${res.status}).`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > opts.maxBytes) throw new AppError("BAD_REQUEST", `File troppo grande (${Math.round(len / 1e6)} MB).`);
    const reader = res.body?.getReader();
    if (!reader) throw new AppError("PROVIDER_ERROR", "Risposta vuota.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        ctrl.abort();
        throw new AppError("BAD_REQUEST", `File troppo grande (oltre ${Math.round(opts.maxBytes / 1e6)} MB).`);
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    if (e instanceof AppError) throw e;
    if ((e as Error).name === "AbortError") throw new AppError("UPSTREAM_TIMEOUT", "Timeout durante il download.");
    throw new AppError("PROVIDER_ERROR", `Download fallito: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Rate limit (best effort, per istanza) ---------- */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) {
    const s = Math.ceil((b.reset - now) / 1000);
    throw new AppError("RATE_LIMITED", `Troppe richieste. Riprova tra ${s} secondi.`);
  }
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Se APP_ACCESS_CODE è impostato, le operazioni a pagamento lo richiedono. */
export function requireAccess(req: Request) {
  const code = env.accessCode();
  if (!code) return;
  if (req.headers.get("x-access-code") !== code) {
    throw new AppError("UNAUTHORIZED", "Codice di accesso mancante o errato.");
  }
}

export function handler<T>(fn: (req: Request, ctx: T) => Promise<unknown>) {
  return async (req: Request, ctx: T) => {
    try {
      const data = await fn(req, ctx);
      if (data instanceof Response) return data;
      return NextResponse.json(data);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      return NextResponse.json(body, { status });
    }
  };
}

export async function readJson<T>(req: Request, parse: (v: unknown) => T): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Corpo della richiesta non valido (JSON atteso).");
  }
  try {
    return parse(body);
  } catch (e) {
    throw new AppError("BAD_REQUEST", "Parametri non validi.", (e as Error).message);
  }
}
