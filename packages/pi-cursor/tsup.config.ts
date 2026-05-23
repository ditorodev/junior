import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  outDir: "dist",
  clean: true,
  external: [
    "@cursor/sdk",
    "@mariozechner/pi-agent-core",
    "@mariozechner/pi-ai",
  ],
});
