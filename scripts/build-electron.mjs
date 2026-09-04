import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    legalComments: "none"
  }),
  build({
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    legalComments: "none"
  })
]);
