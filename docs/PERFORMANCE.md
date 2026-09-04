# Performance budgets

ByBots keeps explicit budgets so additions do not quietly make the core
conversation experience slower. Budgets are measured against a production
build on supported x64 Windows hardware.

| Journey | Budget | Measurement |
| --- | ---: | --- |
| Desktop cold start to visible shell | 3 seconds | packaged application, warm OS disk cache |
| Select Bot to display cached thread | 1 second | 500-message Hermes thread |
| New message to first visible progress | 250 ms | local Bridge before provider latency |
| Application entry JavaScript | 525 KiB raw | `dist/assets/index-*.js` |
| Total application JavaScript | 573 KiB raw | sum of `dist/assets/*.js` |
| Total application CSS | 84 KiB raw | sum of `dist/assets/*.css` |

`npm run build` enforces the bundle limits. The browser smoke suite covers a
full conversation recovery path, and release verification records cold-start
and long-thread timings on the clean Windows test machine. Provider response
time is reported separately because it is outside the desktop client's control.

If a budget must change, update this document and the automated threshold in
the same reviewed commit, with before/after measurements and a user-visible
reason.

## 0.3.1-alpha.1 measurement

The continuity cycle added bounded drafts and attachments, completion
notifications, configuration safeguards, and generated-result actions. Before
the final production split, JavaScript measured 564,917 bytes and CSS measured
83,197 bytes, exceeding the previous 550 KiB JavaScript and 80 KiB CSS checks.

The final build isolates Markdown rendering in a reusable 166,019-byte chunk
and keeps Settings and Bot configuration in on-demand chunks. Conversations
initially mount at most the newest 80 messages and prepend older history in
bounded batches. The application entry is 355,544 bytes, the initial entry plus
Markdown graph is 521,563 bytes, total JavaScript is 565,035 bytes, and CSS is
83,561 bytes. The reviewed limits therefore move to 525 KiB for the entry, 560
KiB for total JavaScript, and 84 KiB for CSS. These limits leave 33.9%, 1.5%,
and 2.9% headroom respectively; future feature work must remain within them or
provide another measured review.

## Model library measurement

The searchable model library adds device-local favorites and eight recent
successful selections. It reuses the native select and shared dialog rather
than adding a UI dependency. The selector and its search dialog now load in
separate on-demand chunks. Compared with the reliability-audit build (573,024
bytes total JavaScript and a 363,273-byte entry), the final measured build is
577,852 bytes total with a 360,394-byte entry: about 4.8 KB more overall, but
2.9 KB less in the initial entry. The total JavaScript budget moves from 560 to
565 KiB for this feature; the entry and CSS budgets remain unchanged.

## Group access preview measurement

Per-member access previews reuse the existing configuration API, identity,
feedback, and dialog components. Their code is split into an on-demand chunk;
configuration requests only start when the user opens the preview. The optional
Bot routines panel now also loads separately. Compared with the model-library
build, total JavaScript moves from 577,852 to 582,595 bytes while the entry falls
from 360,394 to 353,821 bytes. Removing unused language-picker styles reduces
CSS from 85,960 to 85,663 bytes. The total JavaScript limit moves from 565 to
570 KiB for this feature; the initial-entry and CSS limits remain unchanged.

## Manual desktop release-check measurement

The release checker runs in Electron, not in the browser bundle. Its status UI
ships with the existing on-demand Settings chunk and reuses shared feedback
and button styles. From the live-dispatch baseline of 583,572 bytes, total
JavaScript rises to 585,932 bytes; the entry moves from 354,798 to 355,713 bytes,
including English/French status strings. CSS remains 85,701 bytes. The total
budget moves from 570 to 573 KiB for this 2.4 KB addition; the entry and CSS
limits are unchanged. No network request is made until the user clicks Check.

## Multi-gateway preview measurement

The native relay, connection registry and credential management run in the
Bridge, outside the browser bundle. Gateway management reuses the connection
form, fields, switches and feedback components in the existing lazy Settings
chunk. No UI dependency was added. Total JavaScript rises from 585,932 to
596,282 bytes (about 10 KB, including both languages and scoped API helpers).
CSS moves from 85,701 to 86,475 bytes, including mobile input sizes and 44px
buttons. The reviewed total budgets move to 585 KiB JavaScript and 85 KiB CSS;
the 525 KiB entry budget remains unchanged. Gateway polling only runs while its
administrator settings panel is mounted. Native relay ticks perform no network
requests when no gateway has opted in.

## Gateway sections and main-gateway preference

Sidebar grouping is derived from the existing Bot list, with no extra request
or UI dependency. The main-gateway action reuses the lazy Settings panel and
existing button styles. From the additive-settings baseline of 598,171 bytes,
total JavaScript rises to 599,686 bytes (about 1.5 KB). CSS is 86,828 bytes.
The total JavaScript limit moves from 585 to 586 KiB; CSS and initial-entry
limits stay unchanged.
