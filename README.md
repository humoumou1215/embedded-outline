# Embedded Outline

An Obsidian plugin that builds a document-order outline containing native embeds and Sync Embed blocks.

## Plugin files

- `manifest.json` — Obsidian plugin manifest
- `main.js` — plugin bundle
- `styles.css` — plugin styles
- `versions.json` — supported plugin and Obsidian versions

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/humoumou1215/embedded-outline/releases).
2. Create `<vault>/.obsidian/plugins/embedded-outline/` and place those three files directly inside it.
3. Reload Obsidian, then enable **Embedded Outline** under **Settings → Community plugins**.

## Usage

Open a Markdown note and run **Embedded Outline: Open Embedded Outline** from the command palette, or use the ribbon icon. The view follows headings, native embeds, and Sync Embed blocks in document order. Select an entry to reveal its source location; use the refresh command after changing embed structure if needed.

## Verification

The bundle was verified in Obsidian reading mode against a design document containing ordinary embeds, Sync Embeds, nested headings, and nested embeds. All 46 outline entries were clicked individually. Host headings, native embed blocks, Sync Embed blocks, outline scrolling, and collapse/expand behavior were verified.

## Behavior recording

To capture a hard-to-describe navigation problem, run `开始录制 Embedded Outline 行为` from the Obsidian command palette, reproduce the issue normally, then run `停止录制并复制行为日志`. Paste the resulting JSON into the issue or chat. The recorder captures outline clicks, relevant scroll positions, keyboard navigation keys, MarkdownView scroll calls, embed-trail resolution, Sync Embed loading mutations, and the final navigation diagnostic; it does not capture note body text or typed character content. The outline header also has a record button: clicking it starts a recording, and clicking it again stops and copies the log.

For a file artifact instead, use `停止录制并保存行为日志`; the JSON is saved in the vault root as `embedded-outline-behavior-*.json`.

## Privacy and license

Embedded Outline makes no network requests and uses no telemetry. It reads Markdown files through Obsidian's vault API. The diagnostic commands write logs to the system clipboard only when you explicitly invoke a copy command; the plugin does not read existing clipboard contents. It is released under the [MIT License](LICENSE).
