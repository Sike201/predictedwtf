import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      "@": root,
    };
  },
  external: [
    "@solana/web3.js",
    "@solana/spl-token",
  ],
  platform: "node",
  target: "es2020",
});
