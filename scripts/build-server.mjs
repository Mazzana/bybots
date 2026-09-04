import { build } from "esbuild";

await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist-server/index.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "none"
});
