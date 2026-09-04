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

## Windows application

Official releases will provide two files on the public repository's
**Releases** page:

- an x64 installer, recommended for normal use;
- an x64 portable build for evaluation without installation.

Download only artifacts accompanied by their SHA-256 checksum file. An official
release must be publisher-signed. Unsigned development packages may trigger
SmartScreen and must not be presented as official releases.

On first launch, select **Local Hermes** when Hermes runs on the same computer,
then let ByBots test the connection. The Electron application automatically
adopts a compatible loopback gateway session and does not ask the user to copy
its token.

## macOS application

Official releases will provide universal DMG and ZIP artifacts for Intel and
Apple Silicon. Open the DMG, move ByBots to **Applications**, and launch it from
that directory.

An official release must be Developer ID signed and Apple notarized. The current
candidate has not yet been qualified on clean Macs; review [SUPPORT.md](SUPPORT.md)
before using it with sensitive environments.

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
