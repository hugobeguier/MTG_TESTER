import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias — needed because AppFlow.tsx (and anything
// that imports it, like AppFlow.landraid.test.ts) uses that alias internally, and plain Vitest has
// no knowledge of tsconfig "paths" on its own.
// jsx: "automatic" lets tests server-render components (tsconfig has jsx: preserve for Next, which Vitest would otherwise treat as classic React.createElement).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
