import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const packageJson = await readJson(new URL("../package.json", import.meta.url));
const packageLock = await readJson(new URL("../package-lock.json", import.meta.url));
const publicReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");

const version = packageJson.version;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(version)) {
  throw new Error(`package.json contains an invalid application version: ${version}`);
}

const lockVersions = [packageLock.version, packageLock.packages?.[""]?.version];
if (lockVersions.some((lockVersion) => lockVersion !== version)) {
  throw new Error(
    `Application version mismatch: package.json=${version}, package-lock.json=${lockVersions.join("/")}`
  );
}

if (!publicReadme.includes(`\`${version}\``)) {
  throw new Error(`Public README version does not match package.json: ${version}`);
}

console.log(`ByBots application version is aligned: ${version}`);
