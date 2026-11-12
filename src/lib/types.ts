import { z } from "zod";

export const VIEWS = ["front", "rear", "left", "right", "top", "front_three_quarter", "rear_three_quarter", "interior", "dashboard", "other"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<View, string> = {
  front: "Anteriore",
  rear: "Posteriore",
  left: "Lato sinistro",
  right: "Lato destro",
  top: "Superiore",
  front_three_quarter: "Tre quarti anteriore",
  rear_three_quarter: "Tre quarti posteriore",
  interior: "Interni",
  dashboard: "Plancia",
  other: "Altro",
};

export const CATEGORIES = ["auto", "suv", "furgone", "camion", "autobus", "moto", "pickup", "trattore", "carro_armato", "blindato", "altro"] as const;

/** veicoli cingolati / militari: niente porte e sedili passeggeri, torretta e cannone */
export const TRACKED = new Set(["carro_armato"]);

export const VehicleIdSchema = z.object({
  is_vehicle: z.boolean(),
  category: z.enum(CATEGORIES),
  make: z.string(),
  model: z.string(),
  generation: z.string(),
  year_from: z.number().int(),
  year_to: z.number().int(),
  body_style: z.string(),
  color: z.string(),
  view: z.enum(VIEWS),
  confidence: z.number().min(0).max(1),
  dimensions_m: z.object({ length: z.number(), width: z.number(), height: z.number() }),
  seats: z.number().int(),
  notes: z.string(),
});
export type VehicleId = z.infer<typeof VehicleIdSchema>;

export const VehicleInputSchema = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(80),
  year: z.number().int().min(1885).max(2100).optional(),
  category: z.enum(CATEGORIES).default("auto"),
  dimensions_m: z.object({ length: z.number().min(0.5).max(30), width: z.number().min(0.3).max(5), height: z.number().min(0.3).max(6) }).optional(),
  seats: z.number().int().min(1).max(80).optional(),
});
export type VehicleInput = z.infer<typeof VehicleInputSchema>;

export interface ReferenceCandidate {
  id: string;
  source: "wikimedia" | "brave" | "google" | "upload";
  imageUrl: string;
  thumbUrl: string;
  pageUrl?: string;
  title: string;
  width?: number;
  height?: number;
  license?: string;
  /** identificativo normalizzato (vedi lib/licenses) */
  licenseId?: string;
  author?: string;
  queryView: View;
}

export interface VerifiedReference extends ReferenceCandidate {
  ok: boolean;
  problem?: string;
  view: View;
  matches: boolean | null; // null = non verificato da AI
  quality: number | null;
  reason?: string;
  verifiedBy: "ai" | "manual" | "none";
}

export const QUALITY_PRESETS = {
  ULTRA: { targetPolycount: 300000, textureSize: 2048, voxelPx: 1, maxPalette: 64 },
  ALTA: { targetPolycount: 100000, textureSize: 2048, voxelPx: 1.5, maxPalette: 48 },
  STANDARD: { targetPolycount: 30000, textureSize: 1024, voxelPx: 2, maxPalette: 32 },
} as const;
export type Quality = keyof typeof QUALITY_PRESETS;

export interface GenerationTask {
  provider: "meshy" | "fal";
  taskId: string;
  createdAt: number;
}

export interface TaskStatus {
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number | null;
  message?: string;
  thumbnailUrl?: string;
}
