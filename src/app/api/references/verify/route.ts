import { z } from "zod";
import { clientIp, handler, rateLimit, readJson, requireAccess } from "@/lib/http";
import { verifyReferences } from "@/lib/search/verify";
import { VehicleInputSchema, VIEWS } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const Candidate = z.object({
  id: z.string().max(64),
  source: z.enum(["wikimedia", "brave", "google", "upload"]),
  imageUrl: z.string().url().max(2000),
  thumbUrl: z.string().max(2000),
  pageUrl: z.string().max(2000).optional(),
  title: z.string().max(400),
  width: z.number().optional(),
  height: z.number().optional(),
  license: z.string().max(200).optional(),
  author: z.string().max(200).optional(),
  queryView: z.enum(VIEWS),
});
const Body = z.object({ vehicle: VehicleInputSchema, candidates: z.array(Candidate).min(1).max(30), useAI: z.boolean().default(true) });

export const POST = handler(async (req) => {
  const { vehicle, candidates, useAI } = await readJson(req, (b) => Body.parse(b));
  if (useAI) requireAccess(req);
  rateLimit(`verify:${clientIp(req)}`, 6, 60_000);
  return verifyReferences(vehicle, candidates, useAI);
});
