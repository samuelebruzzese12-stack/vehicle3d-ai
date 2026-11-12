import { handler } from "@/lib/http";
import { readLocalFile } from "@/lib/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  zip: "application/zip",
  mcaddon: "application/octet-stream",
  json: "application/json",
  png: "image/png",
};

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ jobId: string; name: string }> }) => {
  const { jobId, name } = await ctx.params;
  const data = await readLocalFile(jobId, name);
  const ext = name.split(".").pop() ?? "";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": ["mcaddon", "zip", "glb"].includes(ext) ? `attachment; filename="${name}"` : "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
