import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/INSTALLATION.md",
  "docs/USER-GUIDE.md",
  "docs/SELF-HOSTING.md",
  "docs/TROUBLESHOOTING.md",
  "docs/PUBLICATION-CHECKLIST.md"
];

const privatePaths = new Set([
  "ROADMAP.md",
  "docs/VPS-HERMES-RUNBOOK.md",
  "docs/HERMES-SOUL-BASELINE.md"
]);

const normalize = (value) => value.replaceAll("\\", "/");

const topLevelMarkdown = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name);
const docsMarkdown = (await readdir(path.join(root, "docs"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => `docs/${entry.name}`)
  .filter((entry) => !privatePaths.has(entry));
const publicMarkdown = [...new Set([...topLevelMarkdown, ...docsMarkdown])]
  .filter((entry) => !privatePaths.has(entry));

const errors = [];

for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    errors.push(`required public file is missing: ${file}`);
  }
}

const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const file of publicMarkdown) {
  const content = await readFile(path.join(root, file), "utf8");
  for (const match of content.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = target.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      errors.push(`${file}: invalid encoded link ${match[1]}`);
      continue;
    }
    const resolved = path.resolve(root, path.dirname(file), target);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      errors.push(`${file}: link leaves repository: ${match[1]}`);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      errors.push(`${file}: broken internal link ${match[1]}`);
    }
  }
}

const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
const tracked = stdout.split("\0").filter(Boolean).map(normalize);

for (const privatePath of privatePaths) {
  if (tracked.includes(privatePath)) {
    errors.push(`private operations document must not be tracked: ${privatePath}`);
  }
}

const sensitivePatterns = [
  { label: "private Windows user path", pattern: /C:\\Users\\ruben/i },
  { label: "known public infrastructure address", pattern: /51\.89\.174\.73/ },
  { label: "known private infrastructure address", pattern: /100\.81\.85\.96/ },
  { label: "known private infrastructure hostname", pattern: /byfinity-vps/i },
  { label: "private SSH key", pattern: /-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----/ }
];

const frenchProsePatterns = [
  /[àâäçéèêëîïôöùûüÿœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒ]/,
  /\b(?:avec|dépannage|héberger|premier démarrage|réglages|sans exposer|utilisateur)\b/i
];

for (const file of publicMarkdown) {
  const content = await readFile(path.join(root, file), "utf8");
  for (const { label, pattern } of sensitivePatterns) {
    if (pattern.test(content)) errors.push(`${file}: contains ${label}`);
  }
  if (frenchProsePatterns.some((pattern) => pattern.test(content))) {
    errors.push(`${file}: public repository documentation must be written in English`);
  }
}

if (errors.length) {
  console.error("Public documentation check failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Public documentation is ready: ${requiredFiles.length} required files, ${publicMarkdown.length} Markdown files checked.`);
