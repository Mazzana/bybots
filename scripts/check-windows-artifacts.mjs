import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const requireSigned = process.argv.includes("--require-signed");
const releaseDirArgument = process.argv.find((argument) => argument.startsWith("--release-dir="));
const releaseDir = releaseDirArgument
  ? resolve(rootDir, releaseDirArgument.slice("--release-dir=".length))
  : resolve(rootDir, "release");

if (process.platform !== "win32") {
  throw new Error("Windows artifact qualification must run on Windows.");
}

const expectedArtifacts = [
  `${packageJson.build.productName} Setup ${packageJson.version}.exe`,
  `${packageJson.build.productName} ${packageJson.version}.exe`,
];

function powershellJson(script, artifactPath) {
  const output = execFileSync(
    "pwsh.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, BYBOTS_ARTIFACT_PATH: artifactPath },
      windowsHide: true,
    },
  ).trim();

  return JSON.parse(output);
}

function readWindowsMetadata(artifactPath) {
  return powershellJson(
    "$item = Get-Item -LiteralPath $env:BYBOTS_ARTIFACT_PATH; " +
      "$signature = Get-AuthenticodeSignature -LiteralPath $env:BYBOTS_ARTIFACT_PATH; " +
      "[pscustomobject]@{ " +
      "ProductName = $item.VersionInfo.ProductName; " +
      "FileDescription = $item.VersionInfo.FileDescription; " +
      "ProductVersion = $item.VersionInfo.ProductVersion; " +
      "SignatureStatus = [string]$signature.Status; " +
      "Signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null } " +
      "} | ConvertTo-Json -Compress",
    artifactPath,
  );
}

function sha256(artifactPath) {
  return createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
}

const checksums = [];

for (const artifactName of expectedArtifacts) {
  const artifactPath = resolve(releaseDir, artifactName);
  const size = statSync(artifactPath).size;
  const header = readFileSync(artifactPath, { encoding: null }).subarray(0, 2).toString("ascii");

  if (size < 1024 * 1024) {
    throw new Error(`${artifactName} is unexpectedly small (${size} bytes).`);
  }

  if (header !== "MZ") {
    throw new Error(`${artifactName} is not a Windows PE executable.`);
  }

  const metadata = readWindowsMetadata(artifactPath);
  if (metadata.ProductName !== packageJson.build.productName) {
    throw new Error(
      `${artifactName} has product name ${JSON.stringify(metadata.ProductName)} instead of ${JSON.stringify(packageJson.build.productName)}.`,
    );
  }

  if (!String(metadata.ProductVersion ?? "").startsWith(packageJson.version)) {
    throw new Error(
      `${artifactName} has product version ${JSON.stringify(metadata.ProductVersion)} instead of ${JSON.stringify(packageJson.version)}.`,
    );
  }

  if (requireSigned && metadata.SignatureStatus !== "Valid") {
    throw new Error(`${artifactName} must have a valid Authenticode signature (found ${metadata.SignatureStatus}).`);
  }

  if (!requireSigned && !["Valid", "NotSigned"].includes(metadata.SignatureStatus)) {
    throw new Error(`${artifactName} has an invalid Authenticode status: ${metadata.SignatureStatus}.`);
  }

  const checksum = sha256(artifactPath);
  checksums.push(`${checksum}  ${artifactName}`);
  console.log(
    `${artifactName}: ${(size / 1024 / 1024).toFixed(1)} MiB, signature ${metadata.SignatureStatus}` +
      (metadata.Signer ? ` (${metadata.Signer})` : ""),
  );
}

writeFileSync(resolve(releaseDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");
console.log(`Qualified ${expectedArtifacts.length} Windows artifacts for ByBots ${packageJson.version}.`);
