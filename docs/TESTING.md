# Windows release qualification

This checklist is required for an official ByBots release. Run it on a clean,
supported Windows 11 x64 machine or virtual machine. A local unsigned build can
be used to rehearse the flow, but it does not satisfy the release gate.

Record the Windows version, Hermes version, artifact SHA-256, tester, date, and
result in the release notes. Never copy tokens, OAuth codes, or private gateway
addresses into the report.

## Automated artifact checks

After packaging, run:

```powershell
npm run test:windows-package-smoke
npm run test:windows-artifacts
```

The first command launches the unpacked production application with isolated
data and verifies its embedded Bridge. The second verifies the installer and
portable executable names, PE headers, product metadata, versions,
Authenticode state, and generates `release/SHA256SUMS.txt`.
Unsigned local development artifacts are accepted. Official candidates must
instead pass:

```powershell
npm run test:windows-artifacts:signed
```

## Clean installation

- Confirm the downloaded hash matches `SHA256SUMS.txt`.
- Confirm Windows reports a valid Byfinity Authenticode signature.
- Install ByBots in the default location, then launch it from the Start menu.
- Complete the first-run connection flow without entering a secret in chat.
- Connect to supported local Hermes and create a Bot.
- Send a message and wait for a complete response without refreshing.
- Close and reopen ByBots; confirm the last-used thread is restored.
- Type different drafts in two Bot threads, restart ByBots, and confirm that
  each draft returns only in its original conversation.
- Attach a small text file, confirm its content reaches Hermes, and confirm no
  local path appears in the submitted message. Verify that binary and oversized
  files are rejected with an actionable message.
- Enable completion notifications, move ByBots to the background, and confirm
  one notification appears when a Bot finishes.
- Trigger one recoverable error and confirm retry completes the action.
- Modify a Bot configuration, attempt to close it, and confirm that discarding
  unsaved changes requires confirmation.
- Start a routine manually and confirm that ByBots displays both the access
  confirmation and the local scheduling time zone.
- Export and re-import a Bot profile with an administrator account.
- Confirm a non-administrator cannot change the gateway or transfer profiles.

## Portable application

- Run the portable executable without installing it.
- Confirm the same connection, message, restoration, and role checks pass.
- Confirm closing ByBots stops its embedded Bridge process.

## Upgrade and rollback

1. Install the previous signed stable version and create a Bot and conversation.
2. Install the signed candidate over it without deleting application data.
3. Confirm settings, gateway choice, Bot metadata, and the last-used thread remain.
4. Uninstall the candidate, reinstall the previous signed version, and follow
   the rollback guidance in `docs/MIGRATIONS.md`.
5. Confirm preserved data remains readable or that the documented backup restore
   succeeds. Record any irreversible migration as a release blocker.

The clean-install and rollback release gates remain incomplete until this
checklist has been executed against the signed candidate on a clean machine.

## macOS release qualification

Run the following on macOS after creating the universal package:

```bash
npm run test:macos-package-smoke
npm run test:macos-artifacts:signed
```

Complete the same connection, messaging, restoration, retry, role, import, and
export journeys on one Apple Silicon Mac and one Intel Mac running macOS 13 or
later. Confirm that the native traffic lights move and close the window, remote
Hermes OAuth opens the default browser and returns to ByBots, the DMG offers an
Applications shortcut, Gatekeeper accepts the app, and `xcrun stapler validate`
accepts the application bundle from the downloaded DMG. Record both OS
versions, architectures, Hermes version, SHA-256 hashes, tester, date, and
results without tokens or private gateway addresses.
