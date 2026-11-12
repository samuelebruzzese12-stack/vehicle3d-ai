import type { CamoKind } from "./camo";

/** Tipo di materiale fisico associato a ciascuna parte del veicolo. */
export type MaterialKind = "vernice" | "mimetica" | "metallo" | "vetro" | "pneumatico" | "cingolo" | "tessuto" | "plastica" | "faro" | "fanale" | "cromo";

export interface MaterialPreset {
  kind: MaterialKind;
  label: string;
  color: [number, number, number];
  metallic: number;
  roughness: number;
  alpha: number;
  /** slot Poly Haven opzionale per una texture reale */
  textureSlot?: "metallo" | "tessuto" | "pelle" | "cingolo" | "metallo_usurato";
}

export const PRESETS: Record<MaterialKind, MaterialPreset> = {
  vernice: { kind: "vernice", label: "Vernice carrozzeria", color: [150, 20, 24], metallic: 0.4, roughness: 0.35, alpha: 1 },
  mimetica: { kind: "mimetica", label: "Mimetica", color: [79, 88, 54], metallic: 0.1, roughness: 0.8, alpha: 1 },
  metallo: { kind: "metallo", label: "Metallo", color: [110, 112, 116], metallic: 0.9, roughness: 0.4, alpha: 1, textureSlot: "metallo" },
  vetro: { kind: "vetro", label: "Vetro", color: [40, 52, 60], metallic: 0, roughness: 0.05, alpha: 0.45 },
  pneumatico: { kind: "pneumatico", label: "Pneumatico (procedurale)", color: [24, 24, 24], metallic: 0, roughness: 0.9, alpha: 1 },
  cingolo: { kind: "cingolo", label: "Cingolo", color: [48, 46, 42], metallic: 0.7, roughness: 0.8, alpha: 1, textureSlot: "cingolo" },
  tessuto: { kind: "tessuto", label: "Tessuto sedili", color: [55, 55, 60], metallic: 0, roughness: 0.95, alpha: 1, textureSlot: "tessuto" },
  plastica: { kind: "plastica", label: "Plastica interni", color: [35, 35, 38], metallic: 0, roughness: 0.7, alpha: 1 },
  faro: { kind: "faro", label: "Faro", color: [235, 235, 225], metallic: 0, roughness: 0.1, alpha: 1 },
  fanale: { kind: "fanale", label: "Fanale", color: [190, 20, 20], metallic: 0, roughness: 0.2, alpha: 1 },
  cromo: { kind: "cromo", label: "Cromo", color: [200, 200, 205], metallic: 1, roughness: 0.1, alpha: 1 },
};

/** Associazione parte → materiale. */
export function materialForPart(part: string, livery: Livery): MaterialKind {
  if (part === "glass") return "vetro";
  if (part === "light_front") return "faro";
  if (part === "light_rear") return "fanale";
  if (part.startsWith("wheel_")) return "pneumatico";
  if (part.startsWith("track_")) return "cingolo";
  if (part === "barrel") return livery.mode === "mimetica" ? "mimetica" : "metallo";
  if (part === "interior") return "tessuto";
  return livery.mode === "mimetica" ? "mimetica" : "vernice";
}

/** Livrea scelta dall'utente. "originale" mantiene i colori/texture del modello sorgente. */
export interface Livery {
  mode: "originale" | "vernice" | "mimetica";
  color?: [number, number, number];
  camo?: CamoKind;
}

export const DEFAULT_LIVERY: Livery = { mode: "originale" };
