# Install ByBots

ByBots can run as a desktop application, from source, or as a self-hosted Web
interface. Every mode relies on a Hermes `0.21.x` instance for Bots,
conversations, routines, and tools.

## Before you start

- Production ByBots packages do not bundle or start Hermes.
- A local gateway usually listens on `http://127.0.0.1:9119`.
- A remote gateway must use HTTPS or a trusted private network.
- A Hermes session token is a secret. Never place it in an issue, screenshot,
  tracked file, or support conversation.

Review the current platform matrix in [SUPPORT.md](SUPPORT.md).

## Easiest installation: download the prebuilt preview

Beginners do not need Git, Node.js, or npm to install the desktop application.
Download the current public preview from
[ByBots 0.3.1 Alpha 1](https://github.com/Mazzana/bybots/releases/tag/v0.3.1-alpha.1):

| System | Recommended download | Alternative | Checksums |
| --- | --- | --- | --- |
| Windows 11 x64 | [ByBots installer](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/ByBots.Setup.0.3.1-alpha.1.exe) | [Portable application](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/ByBots.0.3.1-alpha.1.exe) | [SHA256SUMS.txt](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/SHA256SUMS.txt) |
| macOS 13+, Intel or Apple Silicon | [Universal DMG](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/ByBots-0.3.1-alpha.1-universal.dmg) | [Universal ZIP](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/ByBots-0.3.1-alpha.1-universal.zip) | [SHA256SUMS-macos.txt](https://github.com/Mazzana/bybots/releases/download/v0.3.1-alpha.1/SHA256SUMS-macos.txt) |

This alpha is intended for evaluation and its desktop files are not yet signed.
Windows SmartScreen or macOS Gatekeeper may therefore display a warning. Verify
the checksum, confirm that the file came from the `Mazzana/bybots` release page,
and do not use the preview with sensitive environments. A Hermes `0.21.x`
gateway is still required and is not included in these downloads.

## Windows application

The current preview provides two Windows files:

- `ByBots.Setup.0.3.1-alpha.1.exe`, the recommended x64 installer;
- `ByBots.0.3.1-alpha.1.exe`, an x64 portable build that runs without
  installation.

To verify a download in PowerShell, keep the application and `SHA256SUMS.txt` in
the same folder, then run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath ".\ByBots.Setup.0.3.1-alpha.1.exe"
Get-Content ".\SHA256SUMS.txt"
```

The two hashes for the installer must match. SmartScreen may warn that the
publisher is unknown because this alpha is unsigned. Continue only when the
hash matches and the file came from the release page above. Future stable
releases must be publisher-signed.

On first launch, select **Local Hermes** when Hermes runs on the same computer,
then let ByBots test the connection. The Electron application automatically
adopts a compatible loopback gateway session and does not ask the user to copy
its token.

## macOS application

The current preview provides universal DMG and ZIP artifacts for Intel and Apple
Silicon. Download the DMG, open it, move ByBots to **Applications**, and launch
it from that directory.

To verify the download, keep the DMG and `SHA256SUMS-macos.txt` in the same
folder, open Terminal in that folder, and run:

```bash
shasum -a 256 ByBots-0.3.1-alpha.1-universal.dmg
cat SHA256SUMS-macos.txt
```

The two hashes for the DMG must match. Because this alpha is unsigned, macOS may
block the first launch. Open **System Settings → Privacy & Security**, confirm
that the blocked application is ByBots, and choose **Open Anyway** only after
verifying its checksum and release source.

A future stable release must be Developer ID signed and Apple notarized. The
current preview has not yet been qualified on clean Macs; review
[SUPPORT.md](SUPPORT.md) before using it with sensitive environments.

## Install from source

Requirements:

- Git;
- Node.js 22.12 or newer, up to the 24.x line, and npm;
- Hermes CLI `0.21.x` available in `PATH` for the development stack.

```bash
git clone https://github.com/Mazzana/bybots.git
cd byfinity-bots
npm ci
npm run dev
```

Open `http://127.0.0.1:5188`. `npm run dev` creates an ephemeral session token
and starts three local processes: Hermes on `:9120`, the Bridge on `:4179`, and
Vite on `:5188`.

To start the Electron shell with the same development stack:

```bash
npm run dev:desktop
```

To create evaluation packages:

```bash
npm run package:win
npm run package:mac
```

The macOS package must be built on macOS. Signed distribution is documented in
[RELEASING.md](RELEASING.md).

## Connect to an existing Hermes instance

Build ByBots, then provide the Hermes URL and, when required, its session token
through the service environment or a secret manager:

```bash
npm ci
npm run build
npm start
```

Supported variables are documented in [`.env.example`](../.env.example).
`npm start` serves ByBots on `http://127.0.0.1:4179` and never starts Hermes.

For a durable Docker service, follow [SELF-HOSTING.md](SELF-HOSTING.md).

## Verify the installation

1. Open ByBots and wait for the connection screen.
2. Select local Hermes or enter the remote gateway's trusted HTTPS URL.
3. Run the connection test.
4. Confirm that the Bot fleet appears.
5. Open a thread and send a non-sensitive test message.
6. Type a draft, switch conversations, and confirm that the draft is restored.
7. Attach a small non-sensitive text file and confirm that Hermes receives its
   content without a local filesystem path.

If a step fails, continue with [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
