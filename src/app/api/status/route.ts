import { configuredFeatures } from "@/lib/env";
import { handler } from "@/lib/http";
import { PROVIDERS } from "@/lib/providers";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const features = configuredFeatures();
  let balance: number | null = null;
  const p = PROVIDERS[features.defaultProvider];
  if (p?.configured() && p.balance) {
    try {
      balance = await p.balance();
    } catch {
      balance = null;
    }
  }
  return { features, balance };
});
