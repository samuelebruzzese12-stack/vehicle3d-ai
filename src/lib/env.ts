import "server-only";

/**
 * Configurazione lato server. Le chiavi API vengono lette SOLO qui e non
 * vengono mai inviate al browser: nessuna variabile usa il prefisso NEXT_PUBLIC_.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  anthropicKey: () => read("ANTHROPIC_API_KEY"),
  anthropicModel: () => read("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  meshyKey: () => read("MESHY_API_KEY"),
  falKey: () => read("FAL_KEY"),
  braveKey: () => read("BRAVE_SEARCH_API_KEY"),
  googleKey: () => read("GOOGLE_CSE_API_KEY"),
  googleCx: () => read("GOOGLE_CSE_CX"),
  blobToken: () => read("BLOB_READ_WRITE_TOKEN"),
  blenderWorkerUrl: () => read("BLENDER_WORKER_URL"),
  blenderWorkerToken: () => read("BLENDER_WORKER_TOKEN"),
  accessCode: () => read("APP_ACCESS_CODE"),
  defaultProvider: () => (read("DEFAULT_3D_PROVIDER") ?? "meshy") as "meshy" | "fal",
  isVercel: () => process.env.VERCEL === "1",
};

export function configuredFeatures() {
  return {
    identification: Boolean(env.anthropicKey()),
    referenceVerificationAI: Boolean(env.anthropicKey()),
    search: {
      wikimedia: true,
      brave: Boolean(env.braveKey()),
      google: Boolean(env.googleKey() && env.googleCx()),
    },
    providers: {
      meshy: Boolean(env.meshyKey()),
      fal: Boolean(env.falKey()),
    },
    defaultProvider: env.defaultProvider(),
    storage: env.blobToken() ? "vercel-blob" : env.isVercel() ? "missing" : "local",
    blenderWorker: Boolean(env.blenderWorkerUrl()),
    accessCodeRequired: Boolean(env.accessCode()),
  };
}
