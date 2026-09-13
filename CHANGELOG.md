# Changelog

## 0.5.5

- Apply rendered-candidate selection in the active embed-trail navigation path.
- Wait for long smooth-scroll animations before deciding that a target was missed.
- Avoid instant host-line scrolling for already-rendered Sync Embed containers.
- Use a deterministic smooth scroll-surface fallback when Obsidian re-renders a local heading.

## 0.5.4

- Prefer rendered native embed candidates over hidden zero-sized placeholders.
- Smooth-scroll mounted local headings instead of jumping through MarkdownView line navigation.
- Cancel stale navigation tasks when a newer outline row is clicked.

## 0.5.3

- Fix Sync Embed heading navigation when the nested MarkdownView is not independently scrollable.
- Record the actual plugin manifest version in behavior and navigation diagnostics.

## 0.5.2

- Clarify installation, usage, privacy, and clipboard behavior.
- Publish release assets from a workflow with GitHub artifact attestations.

## 0.5.1

- Add Obsidian community plugin metadata and document-order embed navigation.
