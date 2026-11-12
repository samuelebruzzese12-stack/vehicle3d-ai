// Genera il veicolo sintetico usato nei test (utile per provare lo script Blender).
import { writeFileSync } from "node:fs";
import { syntheticCar } from "../tests/fixtures";
writeFileSync(process.argv[2] ?? "car.glb", await syntheticCar({ rearAt: "-z" }));
