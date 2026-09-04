import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { french } from "../src/i18n";

const sourceDirectory = join(process.cwd(), "src");
const userInterfaceFiles = readdirSync(sourceDirectory)
  .filter((filename) => filename.endsWith(".tsx") && filename !== "i18n.tsx")
  .sort();

describe("English and French interface coverage", () => {
  it("has a French value for every literal translation key", () => {
    const missing = new Set<string>();
    for (const filename of userInterfaceFiles) {
      const source = readFileSync(join(sourceDirectory, filename), "utf8");
      for (const match of source.matchAll(/\bt\("((?:[^"\\]|\\.)+)"/g)) {
        const key = JSON.parse(`"${match[1]}"`) as string;
        if (!Object.hasOwn(french, key)) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("does not ship blank French translations", () => {
    expect(Object.entries(french).filter(([, value]) => !value.trim())).toEqual([]);
  });
});
