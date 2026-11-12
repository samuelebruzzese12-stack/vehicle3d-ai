import path from "node:path";
import { defineConfig } from "vitest/config";

/** Test con servizi esterni reali (rete). Avvio: npm run test:live */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js") },
    conditions: ["react-server"],
  },
  test: { environment: "node", include: ["tests/live/**/*.test.ts"], testTimeout: 900_000, hookTimeout: 900_000, fileParallelism: false },
});
