# Self-host ByBots

This guide deploys ByBots beside an existing managed Hermes instance. It does
not create another Hermes runtime and does not publish a Hermes port.

## Recommended architecture

```text
Authorized device
  → Tailscale or identity-aware proxy
  → ByBots / Bridge on 127.0.0.1:4179
  → Hermes on 127.0.0.1:9119
```

The supplied Compose file uses Docker host networking and targets Linux. For a
different platform or a shared Docker network, adapt the network and
`HERMES_URL` explicitly without making Hermes public.

## Requirements

- Linux x64 with Docker Engine and Docker Compose;
- a healthy Hermes `0.21.x` instance bound to loopback or a private network;
- Git for repository installation and updates;
- authenticated private access such as Tailscale Serve;
- the Hermes session token stored in the server's secret manager.

## Install

From the repository directory:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
mkdir -p data exchange
sudo chown -R 1000:1000 data exchange
```

Add the Hermes token to `.env.production` directly on the server. Do not place
it in a recorded command, issue, or tracked Git file.

Validate and start the service:

```bash
docker compose -f compose.production.yaml config
docker compose -f compose.production.yaml up -d --build
curl -fsS http://127.0.0.1:4179/api/health
```

The container runs without privileges, with a read-only filesystem and no Linux
capabilities. Docker publishes no application port.

## Profile import and export

Hermes `0.21.x` exchanges profile archives through filesystem paths. When
ByBots and Hermes run in separate containers, mount the same `exchange`
directory in Hermes at the exact path `/var/lib/byfinity-bots/exchange`:

```yaml
services:
  hermes:
    volumes:
      - /absolute/path/to/byfinity-bots/exchange:/var/lib/byfinity-bots/exchange
```

Never mount the Hermes data volume into the ByBots container. The exchange
directory is temporary and bounded; it is not a backup.

## Private access with Tailscale

After confirming local Bridge health:

```bash
sudo tailscale serve --bg http://127.0.0.1:4179
sudo tailscale serve status
```

Use the advertised HTTPS URL from an authorized tailnet device. Do not enable
Tailscale Funnel because it would make the service public.

For multiple users, prefer an identity-aware proxy with individual accounts.
Configure separate Bridge role tokens in the deployment secret manager:

```dotenv
BYFINITY_ADMIN_TOKEN=<secret>
BYFINITY_OPERATOR_TOKEN=<secret>
BYFINITY_VIEWER_TOKEN=<secret>
```

An already authenticated proxy can use an exact hostname allowlist through
`BYFINITY_TRUSTED_HOSTNAMES`. Never use a wildcard or trust forwarded host
headers from an untrusted proxy.

## Upgrade

Before an upgrade, back up Hermes data and the ByBots `data` directory
separately, then record the active version.

```bash
git pull --ff-only
docker compose -f compose.production.yaml build --pull
docker compose -f compose.production.yaml up -d
curl -fsS http://127.0.0.1:4179/api/health
```

Reopen a thread, receive a complete reply, and verify each Bridge role. Keep the
previous image until those checks pass.

## Backups

- Back up profiles, conversations, memory, and routines with the Hermes volume
  according to its private operations procedure.
- The ByBots `data` directory stores the selected connection and may contain
  OAuth or session credentials. Encrypt its backup.
- Unfinished conversation drafts stay in each client browser or Electron
  profile. They are not included in Hermes or server-side ByBots backups and do
  not synchronize between devices.
- The `exchange` directory is temporary and must not be used as a backup.
- Never publish infrastructure addresses, accounts, backup destinations, or
  incident procedures in this repository.

## Post-deployment checks

1. Hermes and ByBots listen only on the intended interfaces.
2. Unauthenticated requests are rejected outside loopback.
3. `viewer`, `operator`, and `admin` roles enforce their mutation boundaries.
4. Logs contain no tokens, WebSocket URLs with secrets, or conversations.
5. Backup restoration has been tested.
6. The deployed ByBots commit and Hermes version are recorded privately.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the detailed invariants.
