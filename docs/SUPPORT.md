# Support policy

This policy applies to the pre-release line leading to the first public stable
release. A platform is supported only after its release checklist has been
completed on that platform; source code being able to compile is not equivalent
to product support.

The current evaluation build is `0.3.1-alpha.1`. It is intended for validation,
not as a qualified stable release.

## Supported matrix

| Surface | Supported target | Status before the first stable release |
| --- | --- | --- |
| Hermes contract | Hermes `0.21.x` | Adapter and mocked-contract tests pass; live deployment check required |
| Windows desktop | Windows 11 x64 | Intended official target; clean-machine install and upgrade still required |
| macOS desktop | macOS 13+, Intel and Apple Silicon | Universal candidate and release gates implemented; clean-machine qualification still required |
| Web/Bridge server | Debian 12 x64, Node.js 24 | Intended container target; image build and VPS smoke check still required |
| Development | Windows or Linux, Node.js 22.12 through 24.x | Continuously exercised by CI |

Windows 10, Windows ARM64, macOS versions before 13, other Linux distributions,
mobile operating systems, and Hermes versions outside `0.21.x` are currently
unverified. Reports are welcome, but fixes for those targets are best effort
until the matrix is expanded in a reviewed release.

## Release support window

- Before the first public release, security and correctness fixes target the
  latest `main` branch.
- After the first stable release, its latest patch and `main` receive fixes.
  Older patches in that line are superseded when a new patch is published.
- A Hermes minor-version change requires contract tests and a live read-only
  compatibility check before it can be added to the supported matrix.
- A platform is removed only in release notes and never silently within a patch
  release.

## Compatibility behavior

ByBots diagnoses the connected Hermes version at startup. An unknown
version is reported without pretending compatibility; a known version outside
the supported range produces a visible warning. Users should not bypass that
warning for production deployments without running the contract check and
recording the result.

Profile archives may contain private conversations and persona documents even
when Hermes excludes credential files. Compatibility does not make an archive
safe to publish.

## Getting support

Bug reports should include the ByBots version or commit, operating
system, Hermes version, expected behavior, sanitized reproduction steps, and
the optional report prepared from **Settings → Data → Sanitized diagnostics**.
The complete report is shown before download and excludes credentials, gateway
addresses, Bot names, conversations, files, and other user content. Never
attach private archives or raw production logs.

Security issues follow [`SECURITY.md`](../SECURITY.md) and must not be reported
through a public issue when the report contains exploit details or sensitive
data.
