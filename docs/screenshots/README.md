# Public product screenshots

Run `npm run screenshots` from the repository root to regenerate this set.
No live Hermes gateway, real conversation, credential, or personal desktop is
used. The capture script starts an isolated Vite server and intercepts API
requests with English demonstration data.

- `byfinity-bots-bot-conversation.png`: 1600 × 1120, a specialized Bot turning a
  conversation into a plan and generated-result card.
- `byfinity-bots-desktop.png`: 1600 × 1120, a three-Bot group with mentions and
  a generated-result card.
- `byfinity-bots-mobile.png`: 430 × 932, the actual responsive conversation UI.

The desktop images render the real application inside an iframe with its
Windows layout and actual window-control component. Control callbacks are inert
in this capture-only environment. The surrounding wallpaper, marketing copy,
window shadow, and stylized taskbar are deterministic presentation scenery from
`scripts/screenshot-scene.mjs`; they are not an operating-system capture or
additional product functionality. The UI is not repainted by an image model.

The fixture conversations and file cards illustrate supported UI, not evidence
of an executed production workflow. No demo PDF is included. Dates are fixed
to the September 2026 demonstration workspace. The application source and
styles are unchanged by screenshot generation.

`manifest.json` records dimensions, file sizes, and SHA-256 checksums for the
generated exports. Review the PNGs after regeneration before publishing them.
