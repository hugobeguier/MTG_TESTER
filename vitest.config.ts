import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias — needed because AppFlow.tsx (and anything
// that imports it, like AppFlow.landraid.test.ts) uses that alias internally, and plain Vitest has
// no knowledge of tsconfig "paths" on its own.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
