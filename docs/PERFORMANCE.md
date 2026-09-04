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
| Total application JavaScript | 560 KiB raw | sum of `dist/assets/*.js` |
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
