import "server-only";

/**
 * Configurazione lato server. Architettura FREE-FIRST: nessuna variabile è obbligatoria e
 * nessuna attiva servizi a pagamento. Le chiavi (tutte di piani gratuiti) restano sul server.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  /** token API gratuito di un account Sketchfab: serve solo per SCARICARE (la ricerca è libera) */
  sketchfabToken: () => read("SKETCHFAB_API_TOKEN"),
  /** token GitHub gratuito: alza i limiti di ricerca (60→5000 richieste/ora) */
  githubToken: () => read("GITHUB_TOKEN"),
  /** token Hugging Face gratuito: quota ZeroGPU più alta sugli Spaces */
  hfToken: () => read("HF_TOKEN"),
  /** Spaces Hugging Face ammessi per la generazione AI (separati da virgola) */
  aiSpaces: () => read("AI_SPACES"),
  /** worker AI self-hosted (TRELLIS/TripoSR su GPU propria) */
  aiWorkerUrl: () => read("AI_WORKER_URL"),
  aiWorkerToken: () => read("AI_WORKER_TOKEN"),
  /** Google Programmable Search: piano gratuito 100 query/giorno */
  googleKey: () => read("GOOGLE_CSE_API_KEY"),
  googleCx: () => read("GOOGLE_CSE_CX"),
  /** Brave Search: piano gratuito */
  braveKey: () => read("BRAVE_SEARCH_API_KEY"),
  blobToken: () => read("BLOB_READ_WRITE_TOKEN"),
  blenderWorkerUrl: () => read("BLENDER_WORKER_URL"),
  blenderWorkerToken: () => read("BLENDER_WORKER_TOKEN"),
  accessCode: () => read("APP_ACCESS_CODE"),
  /** abilita modelli con licenze territoriali (es. Hunyuan3D esclude UE/UK/Corea del Sud) */
  allowRegionRestrictedModels: () => read("ALLOW_REGION_RESTRICTED_MODELS") === "true",
  isVercel: () => process.env.VERCEL === "1",
};
