import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json: "@/..." apunta a src/.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" falla fuera de los componentes de servidor de Next. En los tests
      // se reemplaza por un módulo vacío para poder probar el código de servidor.
      "server-only": fileURLToPath(new URL("./tests/vacio.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
