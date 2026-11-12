import { env } from "@/lib/env";
import { handler } from "@/lib/http";
import { AI_MODELS } from "@/lib/engines/ai-models";

export const dynamic = "force-dynamic";

/** Cosa è disponibile su questo server (nessun segreto esposto). */
export const GET = handler(async () => ({
  freeFirst: true,
  paidServices: [],
  sources: {
    wikidata: true, wikipedia: true, commons: true, polyhaven: true, githubSearch: true, sketchfabSearch: true,
    sketchfabDownload: Boolean(env.sketchfabToken()),
    googleCse: Boolean(env.googleKey() && env.googleCx()),
    brave: Boolean(env.braveKey()),
    bing: false, // API Bing Search ritirata da Microsoft (agosto 2025)
    cgtrader: false, // nessuna API pubblica gratuita; scraping vietato dai termini
    mcpedl: false, // nessuna API; scraping vietato dai termini
  },
  engines: {
    A: { available: true, backends: [...(env.aiWorkerUrl() ? ["worker self-hosted"] : []), "Spaces Hugging Face (ZeroGPU gratuito, con quota)"], hfToken: Boolean(env.hfToken()) },
    B: { available: Boolean(env.blenderWorkerUrl()) },
    C: { available: true },
    D: { available: true },
  },
  aiModels: AI_MODELS.map((m) => ({ ...m, enabled: m.outputUsable || env.allowRegionRestrictedModels() })),
  storage: env.blobToken() ? "vercel-blob" : env.isVercel() ? "missing" : "local",
  accessCodeRequired: Boolean(env.accessCode()),
}));
