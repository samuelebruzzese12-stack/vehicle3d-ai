/**
 * Riconoscimento visivo gratuito con CLIP (OpenAI, licenza MIT) tramite transformers.js.
 * Gira nel browser (WASM/WebGPU): la foto non lascia il dispositivo. Pesi ~90 MB scaricati una volta da Hugging Face.
 * È una STIMA: per il modello esatto i risultati vanno confermati dall'utente.
 */
import type { View } from "@/lib/types";

type Scored = { label: string; score: number };
type Classifier = (image: unknown, labels: string[], opts?: { hypothesis_template?: string }) => Promise<Scored[]>;

let loading: Promise<Classifier> | null = null;

export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";

export function loadClip(onProgress?: (pct: number) => void): Promise<Classifier> {
  if (!loading) {
    loading = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const p = await pipeline("zero-shot-image-classification", CLIP_MODEL, {
        dtype: "q8",
        progress_callback: (e: { status: string; progress?: number }) => { if (e.status === "progress" && e.progress != null) onProgress?.(Math.round(e.progress)); },
      });
      return p as unknown as Classifier;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const CATEGORY_LABELS: Record<string, string> = {
  auto: "car", suv: "SUV", furgone: "van", camion: "truck", autobus: "bus", moto: "motorcycle", pickup: "pickup truck", trattore: "tractor", carro_armato: "military tank", blindato: "armored military vehicle",
};

export const COMMON_MAKES = [
  "Fiat", "Alfa Romeo", "Lancia", "Ferrari", "Maserati", "Lamborghini", "Abarth", "Iveco", "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "Opel", "Porsche", "Smart",
  "Renault", "Peugeot", "Citroën", "Dacia", "Toyota", "Nissan", "Honda", "Mazda", "Suzuki", "Mitsubishi", "Subaru", "Lexus", "Hyundai", "Kia", "Ford", "Chevrolet",
  "Jeep", "Dodge", "Tesla", "Volvo", "Saab", "Skoda", "Seat", "Land Rover", "Jaguar", "Mini", "Bentley", "Rolls-Royce", "Scania", "MAN", "DAF", "Lada", "BYD", "Ducati", "Yamaha",
];

/** Stadio 1-2: categoria e marca più probabili. */
export async function suggestCategoryAndMake(image: unknown) {
  const clf = await loadClip();
  const catLabels = Object.values(CATEGORY_LABELS);
  const cats = await clf(image, catLabels, { hypothesis_template: "a photo of a {}" });
  const category = Object.entries(CATEGORY_LABELS).find(([, v]) => v === cats[0].label)![0];
  let makes: Scored[] = [];
  if (category !== "carro_armato" && category !== "blindato") {
    makes = (await clf(image, COMMON_MAKES, { hypothesis_template: "a photo of a {} vehicle" })).slice(0, 5);
  }
  return { category, categoryScore: cats[0].score, categories: cats.slice(0, 3), makes };
}

/** Stadio 3: classifica i modelli candidati (elenco da Wikidata). */
export async function rankModels(image: unknown, models: string[]) {
  const clf = await loadClip();
  return (await clf(image, models.slice(0, 120), { hypothesis_template: "a photo of a {}" })).slice(0, 5);
}

const VIEW_PROMPTS: [View, string][] = [
  ["front", "the front of a vehicle seen head-on"],
  ["rear", "the back of a vehicle seen from behind"],
  ["left", "the side profile of a vehicle"],
  ["front_three_quarter", "a vehicle seen from the front at an angle"],
  ["rear_three_quarter", "a vehicle seen from the back at an angle"],
  ["top", "a vehicle seen from above"],
  ["interior", "the interior of a vehicle with seats"],
  ["dashboard", "a vehicle dashboard and steering wheel"],
  ["other", "a detail or part of a vehicle"],
];

/** Classificazione dell'angolazione di una foto di riferimento. */
export async function classifyView(image: unknown): Promise<{ view: View; score: number }> {
  const clf = await loadClip();
  const r = await clf(image, VIEW_PROMPTS.map((v) => v[1]), { hypothesis_template: "a photo of {}" });
  const v = VIEW_PROMPTS.find((x) => x[1] === r[0].label)!;
  return { view: v[0], score: r[0].score };
}
