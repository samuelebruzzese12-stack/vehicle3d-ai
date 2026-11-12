// Scarica immagini Commons (con licenza verificata) in una cartella locale. Uso: tsx scripts/save-commons-images.mts dir "Titolo 1.jpg" "Titolo 2.jpg"
import { writeFileSync } from "node:fs";
import { commonsImageCredits } from "../src/lib/engines/acquire";
import { fetchLimited } from "../src/lib/http";
import { normalizeImage } from "../src/lib/images";
const [dir, ...titles] = process.argv.slice(2);
const credits = await commonsImageCredits(titles);
let i = 0;
for (const c of credits.values()) {
  const { buffer } = await fetchLimited(c.url, { maxBytes: 15e6, timeoutMs: 30000 });
  const file = `${dir}/ref${i++}.jpg`;
  writeFileSync(file, (await normalizeImage(buffer, 1280)).jpeg);
  console.log(file, "←", c.title, "|", c.author, "|", c.license.label, "|", c.sourceUrl);
}
