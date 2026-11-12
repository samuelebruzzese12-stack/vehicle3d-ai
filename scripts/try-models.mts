import { vehicleModels } from "../src/lib/sources/wikidata";
console.log((await vehicleModels({ make: "Fiat", category: "auto" }, 40)).map((m) => m.label).join(" | "));
console.log((await vehicleModels({ category: "carro_armato" }, 40)).map((m) => m.label).join(" | "));
