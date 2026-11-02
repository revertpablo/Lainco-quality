import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // Los tests usan el plugin de este repositorio desde el código, sin compilarlo antes.
    alias: {
      "@lainco/eslint-plugin": fileURLToPath(new URL("../eslint-plugin/src/index.ts", import.meta.url)),
    },
  },
});
