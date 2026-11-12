import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "../env";
import { AppError } from "../errors";
import { VehicleIdSchema, type VehicleId } from "../types";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  const key = env.anthropicKey();
  if (!key) throw new AppError("NOT_CONFIGURED", "Identificazione AI non configurata (manca ANTHROPIC_API_KEY). Inserisci marca e modello manualmente.");
  if (!client) client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
  return client;
}

export function mapAnthropicError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof Anthropic.RateLimitError) throw new AppError("PROVIDER_RATE_LIMIT", "Limite di richieste AI raggiunto. Riprova tra poco.");
  if (e instanceof Anthropic.AuthenticationError) throw new AppError("NOT_CONFIGURED", "Chiave Anthropic non valida.");
  if (e instanceof Anthropic.APIConnectionError) throw new AppError("UPSTREAM_TIMEOUT", "Servizio AI non raggiungibile.");
  if (e instanceof Anthropic.APIError) throw new AppError("PROVIDER_ERROR", `Errore servizio AI (${e.status ?? "?"}).`);
  throw e;
}

const SYSTEM = `Sei un esperto di identificazione veicoli (auto, camion, autobus, moto, mezzi agricoli).
Analizzi una fotografia e restituisci marca, modello, generazione e intervallo di anni più probabili.
Regole:
- Se non sei sicuro, abbassa "confidence" (0-1) e spiega i dubbi in "notes" (in italiano).
- Se la foto non contiene un veicolo, is_vehicle=false e campi testuali vuoti.
- "view" è l'angolazione della foto.
- dimensions_m sono le dimensioni esterne reali tipiche del modello (lunghezza, larghezza senza specchietti, altezza).
- seats è il numero di posti omologati tipico.
- Non inventare versioni rare: preferisci il modello più diffuso compatibile con ciò che vedi.`;

export async function identifyVehicle(jpegBase64: string): Promise<VehicleId> {
  const c = anthropic();
  try {
    const res = await c.beta.messages.parse({
      model: env.anthropicModel(),
      // Fallback lato server: se il modello rifiuta, l'API riprova con un modello adatto.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "medium", format: betaZodOutputFormat(VehicleIdSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: "Identifica questo veicolo." },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new AppError("PROVIDER_ERROR", "Il servizio AI ha rifiutato l'analisi di questa immagine.");
    if (!res.parsed_output) throw new AppError("PROVIDER_ERROR", "Risposta AI non interpretabile. Riprova o inserisci i dati manualmente.");
    return res.parsed_output;
  } catch (e) {
    mapAnthropicError(e);
  }
}
