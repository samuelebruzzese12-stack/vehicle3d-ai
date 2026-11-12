/**
 * Modelli AI image-to-3D open source considerati, con licenza verificata.
 * Fonti: file LICENSE dei repository e model card su Hugging Face.
 */
export interface AiModelInfo {
  id: "trellis" | "trellis2" | "triposr" | "hunyuan3d2";
  name: string;
  license: string;
  licenseUrl: string;
  /** l'output può essere usato commercialmente e redistribuito */
  outputUsable: boolean;
  /** limitazioni territoriali o d'uso */
  restrictions?: string;
  gpu: string;
  multiImage: boolean;
  quality: 1 | 2 | 3 | 4 | 5;
  /** Space Hugging Face pubblico (ZeroGPU gratuito, con quota) */
  space?: string;
}

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "trellis2", name: "TRELLIS.2 (Microsoft)", license: "MIT", licenseUrl: "https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE",
    outputUsable: true, gpu: "NVIDIA ≥ 24 GB VRAM (A10G/L4/A100)", multiImage: false, quality: 5, space: "microsoft/TRELLIS.2",
  },
  {
    id: "trellis", name: "TRELLIS (Microsoft)", license: "MIT", licenseUrl: "https://github.com/microsoft/TRELLIS/blob/main/LICENSE",
    outputUsable: true, gpu: "NVIDIA ≥ 16 GB VRAM", multiImage: true, quality: 4, space: "trellis-community/TRELLIS",
  },
  {
    id: "triposr", name: "TripoSR (Stability AI + Tripo)", license: "MIT", licenseUrl: "https://github.com/VAST-AI-Research/TripoSR/blob/main/LICENSE",
    outputUsable: true, gpu: "Nessuna obbligatoria: CPU (minuti) o GPU ≥ 6 GB (secondi)", multiImage: false, quality: 2,
  },
  {
    id: "hunyuan3d2", name: "Hunyuan3D-2 (Tencent)", license: "Tencent Hunyuan Community License", licenseUrl: "https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE.txt",
    outputUsable: false, restrictions: "La licenza esclude esplicitamente Unione Europea, Regno Unito e Corea del Sud: non utilizzabile in Italia. Disattivato salvo ALLOW_REGION_RESTRICTED_MODELS=true.",
    gpu: "NVIDIA ≥ 16 GB VRAM", multiImage: false, quality: 5, space: "tencent/Hunyuan3D-2",
  },
];
