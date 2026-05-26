import { defineConfig } from "tsup"

export default defineConfig({
  entry: { "cloudflare/index": "src/cloudflare/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
})
