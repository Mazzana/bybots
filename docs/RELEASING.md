# Releasing ByBots

`package.json` is the single source of truth for the application version. The
desktop About screen, installers, portable executable, and release workflow all
read that value. `npm run test:version` verifies that the lockfile and public
README remain aligned with it.

Development versions use a SemVer pre-release suffix, for example
`0.3.1-alpha.1`. A matching tag publishes an explicitly marked GitHub
pre-release with unsigned development artifacts. It must not be presented as a
signed official release.

## Development artifacts

Run `npm run package:win` on Windows to create an NSIS installer and a portable
executable under `release/`. Local builds are intentionally allowed to remain
unsigned and must not be presented as official ByBots releases.

Run `npm run test:windows-package-smoke` and `npm run test:windows-artifacts`
after packaging. They launch the isolated production shell, validate its
embedded Bridge, validate both executables, and write their deterministic
SHA-256 list. The stricter
`npm run test:windows-artifacts:signed` command rejects unsigned artifacts and
is mandatory for tagged releases.

Run `npm run package:mac` on macOS to create one universal DMG and ZIP for Intel
and Apple Silicon. Then run `npm run test:macos-package-smoke` and
`npm run test:macos-artifacts`. The signed variant additionally verifies the
Developer ID signature and the stapled notarization ticket:

```bash
npm run test:macos-artifacts:signed
```

The packaged application embeds the local Byfinity Bridge, listens only on its
dedicated loopback port, and stores its Hermes connection in Electron's stable
per-user application-data directory. It does not bundle or start Hermes.

## Official release requirements

Version tags use `v<package-version>`, for example `v0.3.1-alpha.1`. The release
workflow refuses a mismatched tag. Stable tags also refuse missing signing
credentials; pre-release tags deliberately use the unsigned artifact checks
and GitHub's **Pre-release** label.

Configure these encrypted GitHub Actions secrets before creating a stable tag:

- `WINDOWS_CERTIFICATE`: a base64-encoded or otherwise electron-builder
  compatible `.pfx`/`.p12` Authenticode certificate;
- `WINDOWS_CERTIFICATE_PASSWORD`: the certificate password;
- `MACOS_CERTIFICATE`: a base64-encoded Developer ID Application `.p12`;
- `MACOS_CERTIFICATE_PASSWORD`: the certificate password;
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`: credentials
  used by electron-builder for Apple notarization.

The workflow passes them to electron-builder through `CSC_LINK` and
`CSC_KEY_PASSWORD`. Never commit either value or include it in an issue, log,
or support bundle.

## Release procedure

1. Confirm the MIT license and repository URL are committed.
2. Complete the public repository checks in
   [`PUBLICATION-CHECKLIST.md`](PUBLICATION-CHECKLIST.md).
3. Update `CHANGELOG.md` and the `version` field in `package.json`.
4. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run package:win`, and
   `npm run package:mac` from clean platform-specific checkouts.
5. Run the platform-specific packaged-app smoke and signed-artifact checks.
6. Install the Windows and macOS artifacts on clean supported machines and
   complete both checklists in `docs/TESTING.md`.
7. Verify Authenticode on Windows and Developer ID, Gatekeeper, and the stapled
   notarization ticket on macOS.
8. Create and push the exact version tag. For a pre-release version, the
   workflow rebuilds, validates, hashes, attests, and publishes unsigned Windows
   and macOS artifacts under GitHub's **Pre-release** label. For a stable
   version, it additionally signs and notarizes the artifacts before publishing.

The resulting `SHA256SUMS.txt` and `SHA256SUMS-macos.txt` let users verify
downloads with `Get-FileHash -Algorithm SHA256 <artifact>` on Windows or
`shasum -a 256 <artifact>` on macOS. GitHub provenance attestations bind the
published artifacts to the tagged workflow run.
