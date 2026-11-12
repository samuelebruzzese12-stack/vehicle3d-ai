// Elenca le foto di una categoria Commons con licenza e dimensioni.
import { commonsCategoryImages } from "../src/lib/sources/commons";
for (const p of await commonsCategoryImages(process.argv[2], 60)) console.log(`${p.licenseId?.padEnd(14)} ${String(p.width).padStart(5)}x${String(p.height).padEnd(5)} ${p.title}`);
