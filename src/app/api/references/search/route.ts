import { z } from "zod";
import { clientIp, handler, rateLimit, readJson } from "@/lib/http";
import { searchReferences } from "@/lib/search";
import { VehicleInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ vehicle: VehicleInputSchema, perView: z.number().int().min(1).max(10).default(6) });

export const POST = handler(async (req) => {
  rateLimit(`search:${clientIp(req)}`, 10, 60_000);
  const { vehicle, perView } = await readJson(req, (b) => Body.parse(b));
  return searchReferences(vehicle, perView);
});
