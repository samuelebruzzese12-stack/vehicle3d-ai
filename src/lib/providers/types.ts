import type { Quality, TaskStatus, View } from "../types";

export interface ProviderImage {
  view: View;
  /** data URI JPEG già validato lato server */
  dataUri: string;
}

export interface CreateTaskInput {
  images: ProviderImage[];
  quality: Quality;
}

export interface ModelProvider {
  id: "meshy" | "fal";
  label: string;
  maxImages: number;
  configured(): boolean;
  createTask(input: CreateTaskInput): Promise<string>;
  getStatus(taskId: string): Promise<TaskStatus>;
  /** URL del modello GLB risultante, recuperato dal provider (non dal client). */
  getResultModelUrl(taskId: string): Promise<string>;
  /** host da cui è lecito scaricare il modello */
  allowedDownloadHosts: string[];
  balance?(): Promise<number | null>;
}
