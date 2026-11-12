import { AppError } from "@/lib/errors";
import { clientIp, handler, rateLimit } from "@/lib/http";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";

export const GET = handler(async (req: Request, ctx: { params: Promise<{ taskId: string }> }) => {
  rateLimit(`status:${clientIp(req)}`, 60, 60_000);
  const { taskId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(taskId)) throw new AppError("BAD_REQUEST", "ID task non valido.");
  const provider = getProvider(new URL(req.url).searchParams.get("provider") ?? "meshy");
  return provider.getStatus(taskId);
});
