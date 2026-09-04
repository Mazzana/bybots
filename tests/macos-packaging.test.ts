import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("macOS distribution", () => {
  it("builds one hardened universal DMG and ZIP with the ByBots identity", () => {
    expect(packageJson.build.appId).toBe("com.byfinity.bots");
    expect(packageJson.build.productName).toBe("ByBots");
    expect(packageJson.build.mac).toMatchObject({
      icon: "build/icon-1024.png",
      category: "public.app-category.productivity",
      hardenedRuntime: true,
      notarize: true,
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.plist"
    });
    expect(packageJson.build.mac.target).toEqual([
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] }
    ]);
  });

  it("keeps signature, notarization, smoke, and artifact gates in the release workflow", () => {
    const workflow = readFileSync(resolve(root, ".github", "workflows", "release.yml"), "utf8");
    const ciWorkflow = readFileSync(resolve(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain("MACOS_CERTIFICATE");
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD");
    expect(workflow).toContain("npm run test:macos-package-smoke");
    expect(workflow).toContain("npm run test:macos-artifacts:signed");
    expect(workflow).toContain("needs: [windows, macos]");
    expect(ciWorkflow).toContain("macos-14");
    expect(ciWorkflow).toContain("npm run build:electron");
  });

  it("publishes alpha tags as unsigned previews while preserving stable signing gates", () => {
    const workflow = readFileSync(resolve(root, ".github", "workflows", "release.yml"), "utf8");
    expect(workflow).toContain("contains(github.ref_name, '-')");
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(workflow).toContain("Windows signing secrets are required for a stable release");
    expect(workflow).toContain("Apple notarization secrets are required for a stable release");
    expect(workflow).toContain("release_flags+=(--prerelease)");
  });

  it("declares the Electron hardened-runtime entitlements", () => {
    const entitlements = readFileSync(resolve(root, "build", "entitlements.mac.plist"), "utf8");
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(entitlements).toContain("com.apple.security.cs.allow-unsigned-executable-memory");
    expect(entitlements).toContain("com.apple.security.cs.disable-library-validation");
  });
});
