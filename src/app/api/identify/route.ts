import { z } from "zod";
import { clientIp, handler, rateLimit, readJson } from "@/lib/http";
import { identifyByName, toVehicleInput } from "@/lib/sources/wikidata";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ query: z.string().trim().min(2).max(100) });

/** Identificazione per nome: Wikidata + Wikipedia (gratuiti). */
export const POST = handler(async (req) => {
  rateLimit(`identify:${clientIp(req)}`, 15, 60_000);
  const { query } = await readJson(req, (b) => Body.parse(b));
  const candidates = await identifyByName(query);
  return { candidates: candidates.map((c) => ({ ...c, input: toVehicleInput(c) })) };
});
