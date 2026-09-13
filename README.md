# Embedded Outline

An Obsidian plugin that builds a document-order outline containing native embeds and Sync Embed blocks.

## Plugin files

- `manifest.json` — Obsidian plugin manifest
- `main.js` — plugin bundle
- `styles.css` — plugin styles
- `versions.json` — supported plugin and Obsidian versions

## Verification

The bundle was verified in Obsidian reading mode against a design document containing ordinary embeds, Sync Embeds, nested headings, and nested embeds. All 46 outline entries were clicked individually. Host headings, native embed blocks, Sync Embed blocks, outline scrolling, and collapse/expand behavior were verified.

## Privacy and license

Embedded Outline makes no network requests, uses no telemetry, and reads only Markdown files through Obsidian's vault API. It is released under the [MIT License](LICENSE).
