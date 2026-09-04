# Security Policy

## Supported versions

Security fixes are currently developed on the latest `main` branch. Published
release support will be documented when the first public release is tagged.

## Security model

ByBots is a local-first client and Bridge for Hermes. Hermes should remain
bound to loopback. Remote access must be protected by a private network or an
identity-aware proxy, plus the Bridge role tokens where applicable.

Sensitive assets include Hermes session tokens, provider credentials, Bot
conversations, locally saved drafts, profile assets, MCP configuration,
operational logs, and backups. These values must never be committed to the
repository or included in public issues. Browser or Electron user-data profiles
containing drafts should be treated as local private data.

Authorization is enforced by the Bridge. Hiding an action in the user interface
is not considered an authorization control.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. If private
reporting is unavailable, do not create a public issue containing exploit
details, secrets, personal data, or production logs. Contact the maintainers
through a private channel listed on the repository owner profile.

Include:

- the affected version or commit;
- the affected ByBots and Hermes surfaces;
- reproduction steps using sanitized data;
- the expected security boundary and observed behavior;
- an impact assessment and suggested remediation, when available.

## In scope

- Bridge authentication or role bypasses;
- cross-profile or cross-conversation data exposure;
- token, credential, or private-content disclosure;
- arbitrary filesystem, command, or network access through the Bridge;
- injection, path traversal, unsafe asset handling, or denial of service caused
  by ByBots;
- incorrect handling of untrusted Hermes, MCP, or provider responses.

Third-party vulnerabilities that do not involve a ByBots security
boundary should be reported to the relevant upstream project.

Only test systems and data you own or are explicitly authorized to assess.
Avoid persistence, destructive actions, service disruption, and data
exfiltration beyond the minimum evidence required.
