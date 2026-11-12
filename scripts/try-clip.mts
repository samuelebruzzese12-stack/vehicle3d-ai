// Prova reale del riconoscimento CLIP (stessi moduli usati nel browser): categoria, marca, modello, viste.
import { RawImage } from "@huggingface/transformers";
import { classifyView, rankModels, suggestCategoryAndMake } from "../src/lib/vision/clip";
import { vehicleModels } from "../src/lib/sources/wikidata";
for (const file of process.argv.slice(2)) {
  const img = await RawImage.read(file);
  const s = await suggestCategoryAndMake(img);
  const list = await vehicleModels({ make: s.makes[0]?.label, category: s.category as never }, 120);
  const models = await rankModels(img, list.map((m) => m.label));
  const view = await classifyView(img);
  console.log(file.split("/").pop(), "→ categoria", s.category, s.categoryScore.toFixed(2), "| marche", s.makes.slice(0, 3).map((m) => `${m.label} ${m.score.toFixed(2)}`).join(", "), "| modelli", models.map((m) => `${m.label} ${m.score.toFixed(2)}`).join(", "), "| vista", view.view, view.score.toFixed(2));
}
