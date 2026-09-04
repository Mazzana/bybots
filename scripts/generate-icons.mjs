import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const source = resolve("public/favicon.svg");
const outputs = [
  { path: resolve("public/icons/icon-192.png"), size: 192 },
  { path: resolve("public/icons/icon-512.png"), size: 512 },
  { path: resolve("build/icon-256.png"), size: 256 },
  { path: resolve("build/icon-1024.png"), size: 1024 }
];

for (const output of outputs) {
  await mkdir(dirname(output.path), { recursive: true });
  await sharp(source).resize(output.size, output.size).png().toFile(output.path);
}

await writeFile(resolve("build/icon.ico"), await pngToIco([
  await readFile(resolve("public/icons/icon-192.png")),
  await readFile(resolve("build/icon-256.png"))
]));
