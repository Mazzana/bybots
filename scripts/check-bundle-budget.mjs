import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const budgets = { ".js": 590 * 1024, ".css": 86 * 1024 };
const entryJavaScriptBudget = 525 * 1024;
const files = await readdir("dist/assets");

for (const [extension, budget] of Object.entries(budgets)) {
  const matching = files.filter((file) => file.endsWith(extension));
  const bytes = (await Promise.all(matching.map(async (file) => (await stat(join("dist/assets", file))).size))).reduce((total, size) => total + size, 0);
  if (bytes > budget) throw new Error(`${extension} bundle is ${bytes} bytes; budget is ${budget} bytes`);
  console.log(`${extension} bundle: ${bytes}/${budget} bytes`);
}

const entryFiles = files.filter((file) => file.startsWith("index-") && file.endsWith(".js"));
const entryBytes = (await Promise.all(entryFiles.map(async (file) => (await stat(join("dist/assets", file))).size))).reduce((total, size) => total + size, 0);
if (entryBytes > entryJavaScriptBudget) throw new Error(`Entry JavaScript is ${entryBytes} bytes; budget is ${entryJavaScriptBudget} bytes`);
console.log(`Entry JavaScript: ${entryBytes}/${entryJavaScriptBudget} bytes`);
