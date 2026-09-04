import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  throw new Error("macOS artifact qualification must run on macOS.");
}

const rootDir = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const releaseDir = resolve(rootDir, "release");
const requireSigned = process.argv.includes("--require-signed");
const productName = packageJson.build.productName;
const version = packageJson.version;
const stableVersion = version.split("-")[0];
const appPath = resolve(releaseDir, "mac-universal", `${productName}.app`);
const plistPath = resolve(appPath, "Contents", "Info.plist");
const executablePath = resolve(appPath, "Contents", "MacOS", productName);
const artifacts = [
  { name: `${productName}-${version}-universal.dmg`, kind: "dmg" },
  { name: `${productName}-${version}-universal.zip`, kind: "zip" },
];

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function requireCommand(command, args, label) {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout.trim();
}

function readPlist(key) {
  return requireCommand("plutil", ["-extract", key, "raw", "-o", "-", plistPath], `Reading ${key}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (readPlist("CFBundleIdentifier") !== packageJson.build.appId) {
  throw new Error("The macOS bundle identifier does not match package.json.");
}
if (readPlist("CFBundleDisplayName") !== productName) {
  throw new Error("The macOS display name does not match package.json.");
}
if (!readPlist("CFBundleShortVersionString").startsWith(stableVersion)) {
  throw new Error("The macOS bundle version does not match package.json.");
}

const architectures = requireCommand("lipo", ["-archs", executablePath], "Universal binary inspection").split(/\s+/);
for (const architecture of ["x86_64", "arm64"]) {
  if (!architectures.includes(architecture)) throw new Error(`The application is missing the ${architecture} architecture.`);
}

const signature = run("codesign", ["-dv", "--verbose=4", appPath]);
const signatureDetails = `${signature.stdout}\n${signature.stderr}`;
const developerIdSigned = /Authority=Developer ID Application:/.test(signatureDetails);
const hasSignature = signature.status === 0 && !/not signed at all/i.test(signatureDetails);
if (hasSignature) {
  requireCommand("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Code signature verification");
}
if (requireSigned && !developerIdSigned) {
  throw new Error("The macOS application must be signed with a Developer ID Application certificate.");
}
if (requireSigned) {
  requireCommand("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath], "Gatekeeper assessment");
  requireCommand("xcrun", ["stapler", "validate", appPath], "Notarization ticket validation");
}

const checksums = [];
for (const artifact of artifacts) {
  const artifactPath = resolve(releaseDir, artifact.name);
  const size = statSync(artifactPath).size;
  if (size < 1024 * 1024) throw new Error(`${artifact.name} is unexpectedly small (${size} bytes).`);
  const bytes = readFileSync(artifactPath);
  if (artifact.kind === "zip" && bytes.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(`${artifact.name} is not a ZIP archive.`);
  }
  if (artifact.kind === "dmg" && bytes.subarray(-512, -508).toString("ascii") !== "koly") {
    throw new Error(`${artifact.name} is not a UDIF disk image.`);
  }
  checksums.push(`${sha256(artifactPath)}  ${artifact.name}`);
  console.log(`${artifact.name}: ${(size / 1024 / 1024).toFixed(1)} MiB`);
}

writeFileSync(resolve(releaseDir, "SHA256SUMS-macos.txt"), `${checksums.join("\n")}\n`, "utf8");
console.log(`Qualified universal macOS artifacts for ${productName} ${version}; signature ${developerIdSigned ? "Developer ID" : hasSignature ? "development" : "unsigned"}.`);
