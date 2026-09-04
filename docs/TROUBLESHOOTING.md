# Troubleshooting

Start with **Settings → Data → Sanitized diagnostics**. Review the preview before
downloading it. The report must not contain credentials, private URLs, Bot
names, conversations, or user files.

## “Unable to connect to the Hermes WebSocket”

ByBots expects its default local Hermes service at `http://127.0.0.1:9120`.
When that service is unavailable, **Settings → Hermes** shows a dedicated local
recovery message and a **Retry local connection** action. Do not enter a token:
the local Bridge adopts the private Hermes session automatically.

1. Confirm that Hermes is running and its status API responds.
2. Check the URL. `127.0.0.1` always refers to the computer running ByBots.
3. When Hermes runs in Docker, verify its container and loopback port.
4. In **Settings → Hermes**, rerun the connection test before saving the gateway.
5. Check the supported versions in [HERMES-COMPATIBILITY.md](HERMES-COMPATIBILITY.md).

On Linux or macOS:

```bash
curl -fsS http://127.0.0.1:9120/api/status
```

On PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:9120/api/status
```

If Hermes is installed through its CLI but is not running, start the local
service with:

```bash
hermes serve --host 127.0.0.1 --port 9120 --skip-build
```

When Hermes runs in Docker, execute Hermes commands inside its container, for
example `docker exec hermes hermes --version`.

## Remote OAuth does not open the browser

- confirm that the operating system has a default browser;
- use a Hermes HTTPS URL reachable from the same computer;
- rerun the test from **Settings → Hermes** before signing in;
- confirm that the firewall allows the temporary loopback callback;
- return to ByBots after authentication. Electron follows completion without
  loading the remote page inside the application window.

Do not disable TLS checks or replace OAuth with a token sent through a chat.

## The Bot fleet stays empty

- confirm that the gateway is healthy and authenticated;
- verify that the Bridge role can read profiles;
- use diagnostics to distinguish an empty profile list from an incompatible
  Hermes version;
- create the first profile in Hermes or with an `admin` role in ByBots.

## A reply stays active or stops early

ByBots first uses live streaming and then a bounded polling fallback. Wait for
the proposed reconnection, then select **Retry**. If the problem continues,
inspect private Hermes logs and verify the model provider's availability.

## A draft is missing

- confirm that the same Bot thread or group is open;
- confirm that ByBots is using the same browser origin or Electron user profile;
- check whether private browsing, site-data cleanup, or an operating-system
  profile reset removed local storage;
- remember that drafts are local and do not synchronize between devices.

Submitted messages remain in Hermes. Unfinished drafts are deliberately local,
bounded storage and are not recoverable from Hermes after site data is removed.

## A text attachment is rejected

ByBots 0.3.1 accepts only supported text, Markdown, CSV, JSON, YAML, XML,
source-code, SQL, and log files. The limits are five files per message, 256 KiB
per file, and 512 KiB for the combined encoded attachment set.

- use the original text file rather than a renamed binary file;
- split a large file and remove secrets or irrelevant sections;
- do not paste a local path for a remote gateway, because that path belongs to
  the current computer;
- wait for a verified Hermes upload contract before using images, archives,
  office documents, or other binary files.

## Completion notifications do not appear

- enable **Settings → Chat → Completion notifications**;
- allow notifications in the browser or operating-system settings;
- keep ByBots open while the Bot or group is running;
- move ByBots to the background, because foreground completions do not create a
  redundant system notification.

If permission was denied, ByBots cannot request it again automatically. Change
the site or application permission in system settings, then reopen ByBots.

## A profile import fails

- profile archives are limited to 25 MB;
- ByBots and Hermes must see the exchange directory at the same absolute path;
- the archive must be a regular file rather than a symbolic link;
- the operation requires the `admin` role.

A profile archive remains private even when Hermes excludes credential files.

## The Web interface rejects the host or reports denied access

The tokenless Bridge accepts only trusted hosts and origins. For remote access,
use an authenticated private proxy and set its exact hostname in
`BYFINITY_TRUSTED_HOSTNAMES`, or provide a Bridge token for the required role.
Never use `*`.

## Windows shows SmartScreen

Unsigned development packages can trigger SmartScreen. Verify the SHA-256
checksum and origin. For normal use, wait for an official signed artifact. Do
not bypass the warning on a sensitive computer.

## macOS refuses to open the application

An official release must be signed and notarized. If Gatekeeper rejects a
development candidate, do not remove quarantine attributes on a sensitive Mac.
Verify its origin and use the official release when available.

## Request support

A useful report contains:

- the ByBots version or commit;
- the operating system;
- the Hermes version;
- expected and observed behavior;
- sanitized reproduction steps;
- the optional sanitized diagnostics report.

Never attach a token, profile archive, raw production log, private URL, or
conversation content. Vulnerabilities follow [SECURITY.md](../SECURITY.md).
