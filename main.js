/* Embedded Outline v0.5.3 - generated from src/core.js + src/plugin-body.js */
"use strict";

function splitWikiTarget(inner) {
  let target = inner.trim();
  let alias = "";
  const pipe = target.indexOf("|");
  if (pipe >= 0) {
    alias = target.slice(pipe + 1).trim();
    target = target.slice(0, pipe).trim();
  }
  const hash = target.indexOf("#");
  let path = hash >= 0 ? target.slice(0, hash).trim() : target;
  let section = hash >= 0 ? target.slice(hash + 1).trim() : "";
  return { path, section, alias };
}

function stripSyncOptions(raw) {
  // Sync Embeds permits options at the end of the alias, e.g.
  // ![[Note|Alias{height:300px,title:false}]]
  return raw.replace(/\{[^{}]+\}(?=\]\]\s*$)/, "");
}

function parseWikiEmbed(raw) {
  const cleaned = stripSyncOptions(raw.trim());
  const match = cleaned.match(/^!\[\[([^\]]+)\]\]$/);
  if (!match) return null;
  const parts = splitWikiTarget(match[1]);
  return { raw, ...parts };
}

function maskInlineCode(line) {
  let out = "";
  let i = 0;
  let tickRun = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      out += tickRun ? " " : line[i];
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] === "`") j++;
    const n = j - i;
    const end = line.indexOf("`".repeat(n), j);
    if (end < 0) {
      out += " ".repeat(line.length - i);
      break;
    }
    out += " ".repeat(end + n - i);
    i = end + n;
  }
  return out;
}

function findEmbedsInLine(line) {
  const masked = maskInlineCode(line);
  const matches = [];
  const re = /!\[\[[^\]]+\]\]/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const raw = line.slice(m.index, m.index + m[0].length);
    const parsed = parseWikiEmbed(raw);
    if (parsed) matches.push({ ...parsed, column: m.index });
  }
  return matches;
}

function stripBlockquotePrefix(line) {
  let text = String(line || "");
  // Fenced blocks may live inside callouts / blockquotes. Obsidian keeps the
  // leading `>` markers in the Markdown source, so normalize them before
  // detecting ```sync and the embed lines inside it.
  while (/^\s*>\s?/.test(text)) text = text.replace(/^\s*>\s?/, "");
  return text;
}

function scanEmbedEvents(content, { includeNative = true, includeSync = true } = {}) {
  const lines = content.split(/\r?\n/);
  const events = [];
  let fence = null;
  let syncOrdinal = 0;
  let nativeOrdinal = 0;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    const structuralLine = stripBlockquotePrefix(line);
    const fenceMatch = structuralLine.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/);

    if (fence) {
      const closeRe = new RegExp(`^\\s*${fence.char}{${fence.length},}\\s*$`);
      if (closeRe.test(structuralLine)) {
        fence = null;
        continue;
      }
      if (fence.lang === "sync" && includeSync) {
        const trimmed = structuralLine.trim();
        if (trimmed.startsWith("![[") && trimmed.endsWith("]]")) {
          const parsed = parseWikiEmbed(trimmed);
          if (parsed) {
            events.push({
              ...parsed,
              kind: "sync",
              line: lineNo,
              column: line.indexOf("![["),
              ordinal: syncOrdinal++,
            });
          }
        }
      }
      continue;
    }

    if (fenceMatch) {
      const token = fenceMatch[1];
      fence = {
        char: token[0],
        length: token.length,
        lang: (fenceMatch[2] || "").trim().toLowerCase(),
      };
      continue;
    }

    if (!includeNative) continue;
    const embeds = findEmbedsInLine(line);
    for (const parsed of embeds) {
      events.push({
        ...parsed,
        kind: "native",
        line: lineNo,
        column: parsed.column,
        ordinal: nativeOrdinal++,
      });
    }
  }

  return events.sort((a, b) => a.line - b.line || a.column - b.column);
}

function normalizeHeadingText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function findSectionBounds(headings, section, lineCount) {
  if (!section) return { startLine: 0, endLine: lineCount, targetHeading: null };
  const wanted = normalizeHeadingText(section);
  const idx = headings.findIndex(h => normalizeHeadingText(h.heading) === wanted);
  if (idx < 0) return null;
  const target = headings[idx];
  let endLine = lineCount;
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= target.level) {
      endLine = headings[i].position.start.line;
      break;
    }
  }
  return {
    startLine: target.position.start.line,
    endLine,
    targetHeading: target,
  };
}

function headingsWithinRange(headings, range) {
  return headings.filter(h => {
    const line = h.position.start.line;
    return line >= range.startLine && line < range.endLine;
  });
}

function buildHeadingTree(items) {
  const roots = [];
  const stack = [];
  for (const item of items) {
    const node = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}


"use strict";

const {
  Plugin,
  ItemView,
  MarkdownView,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  moment,
  setIcon,
} = require("obsidian");

const VIEW_TYPE = "embedded-outline-view";

const DEFAULT_SETTINGS = {
  includeNativeEmbeds: true,
  includeSyncEmbeds: true,
  includeNestedEmbeds: true,
  maxDepth: 4,
  relativeHierarchy: true,
  showSource: true,
  showEmbedContainers: true,
  replaceNativeOutline: true,
  smoothScrolling: true,
  scrollDurationMs: 480,
  navigationHighlight: true,
  highlightDurationMs: 1500,
};

const BEHAVIOR_RECORDING_SCHEMA = 1;
const MAX_BEHAVIOR_EVENTS = 2500;

function clampLevel(level) {
  return Math.max(1, Math.min(12, level));
}

function resolveDynamicPath(text, hostFile) {
  let resolved = String(text || "");
  resolved = resolved.replace(/\{\{date([+-]\d+)([dwmy]):([^}]+)\}\}/g, (_m, offset, unit, format) => {
    const units = { d: "days", w: "weeks", m: "months", y: "years" };
    return moment().add(parseInt(offset, 10), units[unit]).format(format);
  });
  resolved = resolved.replace(/\{\{date:([^}]+)\}\}/g, (_m, format) => moment().format(format));
  resolved = resolved.replace(/\{\{time:([^}]+)\}\}/g, (_m, format) => moment().format(format));
  resolved = resolved.replace(/\{\{title\}\}/g, hostFile?.basename || "");
  return resolved;
}

class OutlineBuilder {
  constructor(plugin) {
    this.plugin = plugin;
    this.dependencyPaths = new Set();
  }

  async build(hostFile) {
    this.dependencyPaths = new Set([hostFile.path]);
    const visited = new Set([hostFile.path]);
    const items = await this.expandFile({
      file: hostFile,
      section: "",
      depth: 0,
      visited,
      embedded: false,
      desiredRootLevel: null,
      hostRoot: hostFile,
      hostEmbedLine: null,
      embedType: null,
      embedOrdinal: null,
      rootEmbedType: null,
      rootEmbedOrdinal: null,
      rootEmbedSourceFile: null,
      rootEmbedSection: null,
      embedTrail: [],
    });
    return { items, dependencyPaths: new Set(this.dependencyPaths) };
  }

  getHeadings(file) {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    return (cache?.headings || []).slice().sort((a, b) => a.position.start.offset - b.position.start.offset);
  }

  resolveEmbedTarget(event, containingFile) {
    const rawPath = resolveDynamicPath(event.path, containingFile);
    const notePath = rawPath || containingFile.path;
    const target = this.plugin.app.metadataCache.getFirstLinkpathDest(notePath, containingFile.path);
    if (!(target instanceof TFile) || target.extension !== "md") return null;
    return { file: target, section: resolveDynamicPath(event.section, containingFile) };
  }

  async expandFile(ctx) {
    const { file, section, depth, visited, embedded, desiredRootLevel, hostRoot, hostEmbedLine, embedType, embedOrdinal, rootEmbedType, rootEmbedOrdinal, rootEmbedSourceFile, rootEmbedSection, embedTrail = [] } = ctx;
    this.dependencyPaths.add(file.path);

    let content;
    try {
      content = await this.plugin.app.vault.cachedRead(file);
    } catch (e) {
      console.error("Embedded Outline: failed to read", file.path, e);
      return [];
    }

    const allHeadings = this.getHeadings(file);
    const range = findSectionBounds(allHeadings, section, content.split(/\r?\n/).length);
    if (!range) return [];
    const headings = headingsWithinRange(allHeadings, range);

    const includeNative = this.plugin.settings.includeNativeEmbeds;
    const includeSync = this.plugin.settings.includeSyncEmbeds;
    const embeds = scanEmbedEvents(content, { includeNative, includeSync }).filter(e => e.line >= range.startLine && e.line < range.endLine);

    const events = [];
    for (const h of headings) events.push({ kind: "heading", line: h.position.start.line, column: h.position.start.col, heading: h });
    for (const e of embeds) events.push({ kind: "embed", line: e.line, column: e.column, embed: e });
    events.sort((a, b) => a.line - b.line || a.column - b.column || (a.kind === "heading" ? -1 : 1));

    let levelOffset = 0;
    if (embedded && this.plugin.settings.relativeHierarchy && headings.length && desiredRootLevel != null) {
      levelOffset = desiredRootLevel - headings[0].level;
    }

    const items = [];
    let currentContextLevel = embedded && desiredRootLevel != null ? desiredRootLevel - 1 : 0;

    for (const event of events) {
      if (event.kind === "heading") {
        const h = event.heading;
        const projectedLevel = embedded && this.plugin.settings.relativeHierarchy
          ? clampLevel(h.level + levelOffset)
          : h.level;
        currentContextLevel = projectedLevel;
        items.push({
          id: `${hostRoot.path}:${file.path}:${h.position.start.line}:${items.length}`,
          title: h.heading,
          level: projectedLevel,
          originalLevel: h.level,
          kind: embedded ? "embed" : "local",
          sourceFile: file.path,
          sourceLine: h.position.start.line,
          sourceHeading: h.heading,
          hostFile: hostRoot.path,
          hostEmbedLine,
          embedType,
          embedOrdinal,
          rootEmbedType,
          rootEmbedOrdinal,
          rootEmbedSourceFile,
          rootEmbedSection,
          section,
          depth,
          embedTrail,
        });
        continue;
      }

      if (!this.plugin.settings.includeNestedEmbeds && embedded) continue;
      if (depth >= this.plugin.settings.maxDepth) continue;
      const target = this.resolveEmbedTarget(event.embed, file);
      if (!target) continue;
      if (visited.has(target.file.path)) continue;

      const topHostEmbedLine = embedded ? hostEmbedLine : event.embed.line;
      const containerLevel = this.plugin.settings.relativeHierarchy
        ? Math.max(1, currentContextLevel + 1)
        : Math.max(1, target.section ? 1 : 1);
      const step = {
        type: event.embed.kind,
        ordinal: event.embed.ordinal,
        sourceFile: target.file.path,
        section: target.section || "",
        containingFile: file.path,
        sourceLine: event.embed.line,
      };
      const nextEmbedTrail = [...embedTrail, step];

      if (this.plugin.settings.showEmbedContainers) {
        const label = event.embed.alias || target.section || target.file.basename;
        items.push({
          id: `${hostRoot.path}:${file.path}:embed:${event.embed.line}:${event.embed.ordinal}`,
          title: label,
          level: containerLevel,
          originalLevel: containerLevel,
          kind: "embed-container",
          sourceFile: target.file.path,
          sourceLine: 0,
          sourceHeading: target.section || "",
          hostFile: hostRoot.path,
          hostEmbedLine: topHostEmbedLine,
          embedType: event.embed.kind,
          embedOrdinal: event.embed.ordinal,
          rootEmbedType: embedded ? rootEmbedType : event.embed.kind,
          rootEmbedOrdinal: embedded ? rootEmbedOrdinal : event.embed.ordinal,
          rootEmbedSourceFile: embedded ? rootEmbedSourceFile : target.file.path,
          rootEmbedSection: embedded ? rootEmbedSection : target.section,
          section: target.section,
          depth: depth + 1,
          embedTrail: nextEmbedTrail,
        });
      }

      const nextVisited = new Set(visited);
      nextVisited.add(target.file.path);
      const desired = this.plugin.settings.relativeHierarchy
        ? containerLevel + (this.plugin.settings.showEmbedContainers ? 1 : 0)
        : null;
      const nested = await this.expandFile({
        file: target.file,
        section: target.section,
        depth: depth + 1,
        visited: nextVisited,
        embedded: true,
        desiredRootLevel: desired,
        hostRoot,
        hostEmbedLine: topHostEmbedLine,
        embedType: event.embed.kind,
        embedOrdinal: event.embed.ordinal,
        rootEmbedType: embedded ? rootEmbedType : event.embed.kind,
        rootEmbedOrdinal: embedded ? rootEmbedOrdinal : event.embed.ordinal,
        rootEmbedSourceFile: embedded ? rootEmbedSourceFile : target.file.path,
        rootEmbedSection: embedded ? rootEmbedSection : target.section,
        embedTrail: nextEmbedTrail,
      });
      items.push(...nested);
    }

    return items;
  }
}

class EmbeddedOutlineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.items = [];
    this.dependencyPaths = new Set();
    this.refreshSeq = 0;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Embedded Outline"; }
  getIcon() { return "list-tree"; }

  async onOpen() {
    this.contentEl.addClass("embedded-outline-view");
    await this.refresh();
  }

  async refresh() {
    const seq = ++this.refreshSeq;
    const activeFile = this.plugin.getHostFile();
    const el = this.contentEl;
    el.empty();

    const header = el.createDiv({ cls: "embedded-outline-header" });
    header.createDiv({ cls: "embedded-outline-title", text: "Embedded Outline" });
    const recordingStatus = header.createSpan({ cls: "embedded-outline-recording-status" });
    const recordBtn = header.createEl("button", {
      cls: "clickable-icon embedded-outline-record",
      attr: { "aria-label": "Start behavior recording", title: "Start behavior recording" },
    });
    recordBtn.addEventListener("click", async ev => {
      ev.stopPropagation();
      if (this.plugin.isBehaviorRecording()) await this.plugin.stopBehaviorRecording({ copy: true });
      else this.plugin.startBehaviorRecording();
    });
    const refreshBtn = header.createEl("button", { cls: "clickable-icon embedded-outline-refresh", attr: { "aria-label": "Refresh embedded outline" } });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => this.refresh());
    this.plugin.updateBehaviorRecordingIndicators();

    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      el.createDiv({ cls: "embedded-outline-empty", text: "Open a Markdown note to see its outline." });
      this.items = [];
      this.dependencyPaths = new Set();
      return;
    }

    const builder = new OutlineBuilder(this.plugin);
    const result = await builder.build(activeFile);
    if (seq !== this.refreshSeq) return;
    this.items = result.items;
    this.dependencyPaths = result.dependencyPaths;
    this.plugin.recordBehavior("outline-refresh", {
      activeFile: activeFile.path,
      itemCount: this.items.length,
      dependencyPaths: Array.from(this.dependencyPaths),
    });

    if (!this.items.length) {
      el.createDiv({ cls: "embedded-outline-empty", text: "No headings found." });
      return;
    }

    const tree = buildHeadingTree(this.items);
    const treeEl = el.createDiv({ cls: "embedded-outline-tree" });
    this.renderNodes(treeEl, tree);
  }

  renderNodes(parent, nodes) {
    for (const node of nodes) {
      const item = parent.createDiv({ cls: "embedded-outline-node" });
      const row = item.createDiv({ cls: "embedded-outline-row" });
      row.dataset.kind = node.kind;
      row.dataset.level = String(node.level);
      if (node.kind === "embed" || node.kind === "embed-container") row.addClass("is-embedded");
      if (node.kind === "embed-container") row.addClass("is-embed-container");

      if (node.children.length) {
        const twisty = row.createEl("button", { cls: "clickable-icon embedded-outline-twisty", attr: { "aria-label": "Collapse section" } });
        setIcon(twisty, "chevron-down");
        twisty.addEventListener("click", ev => {
          ev.stopPropagation();
          const children = item.querySelector(":scope > .embedded-outline-children");
          if (!children) return;
          const collapsed = !children.hasClass("is-collapsed");
          children.toggleClass("is-collapsed", collapsed);
          setIcon(twisty, collapsed ? "chevron-right" : "chevron-down");
        });
      } else {
        row.createSpan({ cls: "embedded-outline-twisty-spacer" });
      }

      if (node.kind === "embed-container") {
        const embedIcon = row.createSpan({ cls: "embedded-outline-embed-icon" });
        setIcon(embedIcon, "panels-top-left");
      }

      const label = row.createDiv({ cls: "embedded-outline-label", text: node.title });
      if (node.kind === "embed") label.setAttr("title", `${node.sourceFile} · H${node.originalLevel}`);
      if (node.kind === "embed-container") label.setAttr("title", `Embedded: ${node.sourceFile}`);
      row.addEventListener("click", () => {
        this.plugin.recordBehavior("outline-row-click", {
          item: this.plugin.serializeBehaviorItem(node),
          row: { kind: node.kind, level: node.level, title: node.title },
        });
        void this.plugin.navigateToItem(node);
      });

      if (this.plugin.settings.showSource && node.kind === "embed") {
        const source = row.createSpan({ cls: "embedded-outline-source", text: this.plugin.shortSource(node.sourceFile) });
        source.setAttr("title", node.sourceFile);
      }

      if (node.children.length) {
        const children = item.createDiv({ cls: "embedded-outline-children" });
        this.renderNodes(children, node.children);
      }
    }
  }
}

class EmbeddedOutlineSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Embedded Outline" });

    new Setting(containerEl)
      .setName("Include native embeds")
      .setDesc("Include headings from normal ![[Note]] and ![[Note#Heading]] transclusions.")
      .addToggle(t => t.setValue(this.plugin.settings.includeNativeEmbeds).onChange(async v => { this.plugin.settings.includeNativeEmbeds = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Include Sync Embeds")
      .setDesc("Include headings referenced inside ```sync code blocks.")
      .addToggle(t => t.setValue(this.plugin.settings.includeSyncEmbeds).onChange(async v => { this.plugin.settings.includeSyncEmbeds = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Include nested embeds")
      .setDesc("Recursively include embeds found inside embedded notes.")
      .addToggle(t => t.setValue(this.plugin.settings.includeNestedEmbeds).onChange(async v => { this.plugin.settings.includeNestedEmbeds = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Maximum embed depth")
      .setDesc("Stops recursive embed chains and protects against very deep documents.")
      .addSlider(s => s.setLimits(1, 10, 1).setValue(this.plugin.settings.maxDepth).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxDepth = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Relative embedded hierarchy")
      .setDesc("Project embedded heading levels underneath the surrounding host heading while preserving their internal hierarchy.")
      .addToggle(t => t.setValue(this.plugin.settings.relativeHierarchy).onChange(async v => { this.plugin.settings.relativeHierarchy = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Show source note")
      .setDesc("Show the source note name beside embedded headings.")
      .addToggle(t => t.setValue(this.plugin.settings.showSource).onChange(async v => { this.plugin.settings.showSource = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Show embed blocks as outline nodes")
      .setDesc("Show each native/Sync Embed at its exact document position, using its alias, section name, or source note name as a virtual outline node.")
      .addToggle(t => t.setValue(this.plugin.settings.showEmbedContainers).onChange(async v => { this.plugin.settings.showEmbedContainers = v; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Navigation" });

    new Setting(containerEl)
      .setName("Smooth embedded scrolling")
      .setDesc("Use browser-native smooth scrolling for rendered Embed/heading elements. Host-note headings use Obsidian\'s own MarkdownView navigation for stability.")
      .addToggle(t => t.setValue(this.plugin.settings.smoothScrolling).onChange(async v => {
        this.plugin.settings.smoothScrolling = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Highlight navigated heading")
      .setDesc("After scrolling, pulse the target heading background so it is easy to spot.")
      .addToggle(t => t.setValue(this.plugin.settings.navigationHighlight).onChange(async v => {
        this.plugin.settings.navigationHighlight = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Highlight duration")
      .setDesc("Length of the breathing background highlight in milliseconds.")
      .addSlider(s => s.setLimits(600, 3000, 100).setValue(this.plugin.settings.highlightDurationMs).setDynamicTooltip().onChange(async v => {
        this.plugin.settings.highlightDurationMs = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Replace native Outline pane")
      .setDesc("Use one Embedded Outline in the right-side Outline location. Duplicate Embedded Outline tabs are automatically removed.")
      .addToggle(t => t.setValue(this.plugin.settings.replaceNativeOutline).onChange(async v => {
        this.plugin.settings.replaceNativeOutline = v;
        await this.plugin.saveSettings();
        if (v) await this.plugin.replaceNativeOutlinePane();
        else await this.plugin.restoreReplacedOutlinePane();
      }));
  }
}

module.exports = class EmbeddedOutlinePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.refreshTimer = null;
    this.lastNavigationDebug = null;
    this.behaviorRecorder = null;
    this.lastBehaviorRecording = null;
    this.behaviorDomCleanup = [];
    this.behaviorScrollLast = new WeakMap();
    this.behaviorWheelLast = 0;
    this.behaviorEditorChangeLast = 0;
    this.registerView(VIEW_TYPE, leaf => new EmbeddedOutlineView(leaf, this));
    this.addSettingTab(new EmbeddedOutlineSettingTab(this.app, this));

    this.addRibbonIcon("list-tree", "Open Embedded Outline", () => this.activateView());
    this.addCommand({ id: "open-embedded-outline", name: "Open Embedded Outline", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-embedded-outline", name: "Refresh Embedded Outline", callback: () => this.scheduleRefresh(0) });
    this.addCommand({ id: "copy-navigation-diagnostics", name: "Copy last navigation diagnostics", callback: () => this.copyNavigationDiagnostics() });
    this.addCommand({ id: "start-behavior-recording", name: "开始录制 Embedded Outline 行为", callback: () => this.startBehaviorRecording() });
    this.addCommand({ id: "stop-behavior-recording-copy", name: "停止录制并复制行为日志", callback: () => this.stopBehaviorRecording({ copy: true }) });
    this.addCommand({ id: "stop-behavior-recording-save", name: "停止录制并保存行为日志", callback: () => this.stopBehaviorRecording({ save: true }) });
    this.addCommand({ id: "copy-last-behavior-recording", name: "复制上一次行为日志", callback: () => this.copyBehaviorRecording() });
    this.addCommand({ id: "clear-behavior-recording", name: "清除行为录制", callback: () => this.clearBehaviorRecording() });
    this.addCommand({ id: "repair-outline-panes", name: "Repair duplicate Embedded Outline panes", callback: async () => {
      const leaf = await this.reconcileOutlinePanes({ reveal: true });
      new Notice(leaf ? "Embedded Outline: duplicate panes repaired." : "Embedded Outline: no pane needed repair.");
    } });

    const initialFile = this.app.workspace.getActiveFile();
    this.lastMarkdownFilePath = initialFile instanceof TFile && initialFile.extension === "md" ? initialFile.path : null;

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(async () => {
        if (this.settings.replaceNativeOutline) await this.reconcileOutlinePanes({ reveal: false });
      }, 220);
    });

    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      const view = leaf?.view;
      if (view instanceof MarkdownView && view.file?.extension === "md") this.lastMarkdownFilePath = view.file.path;
      this.recordBehavior("active-leaf-change", {
        viewType: view?.getViewType?.() || view?.constructor?.name || null,
        filePath: view?.file?.path || null,
        mode: view instanceof MarkdownView ? this.getMarkdownViewMode(view) : null,
      });
      this.scheduleRefresh(50);
    }));
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file instanceof TFile && file.extension === "md") this.lastMarkdownFilePath = file.path;
      this.recordBehavior("file-open", { filePath: file?.path || null, extension: file?.extension || null });
      this.scheduleRefresh(50);
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => {
      const now = Date.now();
      if (now - this.behaviorEditorChangeLast >= 150) {
        this.behaviorEditorChangeLast = now;
        this.recordBehavior("editor-change", {
          filePath: info?.file?.path || null,
          viewType: info?.getViewType?.() || info?.constructor?.name || null,
          mode: info instanceof MarkdownView ? this.getMarkdownViewMode(info) : null,
        });
      }
      if (info instanceof MarkdownView) this.scheduleRefresh(180);
      else this.scheduleRefresh(180);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      this.recordBehavior("metadata-changed", { filePath: file?.path || null });
      this.refreshIfRelevant(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", file => {
      this.recordBehavior("vault-rename", { filePath: file?.path || null });
      this.refreshIfRelevant(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      this.recordBehavior("vault-delete", { filePath: file?.path || null });
      this.refreshIfRelevant(file.path);
    }));
  }

  onunload() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.behaviorRecorder) void this.stopBehaviorRecording({ silent: true });
    else this.removeBehaviorDomListeners();
    void this.restoreOutlineForUnload();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleRefresh(0);
  }

  isBehaviorRecording() {
    return !!this.behaviorRecorder;
  }

  serializeBehaviorItem(item) {
    if (!item) return null;
    return {
      id: item.id || null,
      kind: item.kind || null,
      title: item.title || null,
      hostFile: item.hostFile || null,
      hostEmbedLine: Number.isInteger(item.hostEmbedLine) ? item.hostEmbedLine : null,
      sourceFile: item.sourceFile || null,
      sourceLine: Number.isInteger(item.sourceLine) ? item.sourceLine : null,
      sourceHeading: item.sourceHeading || null,
      section: item.section || "",
      depth: Number.isInteger(item.depth) ? item.depth : null,
      embedType: item.embedType || null,
      embedOrdinal: Number.isInteger(item.embedOrdinal) ? item.embedOrdinal : null,
      rootEmbedType: item.rootEmbedType || null,
      rootEmbedOrdinal: Number.isInteger(item.rootEmbedOrdinal) ? item.rootEmbedOrdinal : null,
      rootEmbedSourceFile: item.rootEmbedSourceFile || null,
      rootEmbedSection: item.rootEmbedSection || "",
      embedTrail: Array.isArray(item.embedTrail) ? item.embedTrail.map(step => ({
        type: step?.type || null,
        ordinal: Number.isInteger(step?.ordinal) ? step.ordinal : null,
        sourceFile: step?.sourceFile || null,
        section: step?.section || "",
        containingFile: step?.containingFile || null,
        sourceLine: Number.isInteger(step?.sourceLine) ? step.sourceLine : null,
      })) : [],
    };
  }

  sanitizeBehaviorValue(value, depth = 0) {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 509)}...` : value;
    if (depth >= 5) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 40).map(item => this.sanitizeBehaviorValue(item, depth + 1));
    if (value instanceof TFile) return value.path;
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value).slice(0, 48)) {
        result[key] = this.sanitizeBehaviorValue(item, depth + 1);
      }
      return result;
    }
    return String(value);
  }

  describeBehaviorElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const row = el.closest?.(".embedded-outline-row");
    const heading = el.matches?.("h1,h2,h3,h4,h5,h6") ? normalizeHeadingText(el.textContent) : null;
    const label = row?.querySelector?.(".embedded-outline-label")?.textContent || null;
    const className = typeof el.className === "string" ? el.className : "";
    const parentEmbed = el.closest?.(".sync-embed, .internal-embed[src]");
    return {
      tag: el.tagName?.toLowerCase?.() || null,
      id: el.getAttribute?.("id") || null,
      className: className.slice(0, 260),
      role: el.getAttribute?.("role") || null,
      ariaLabel: el.getAttribute?.("aria-label") || null,
      outlineLabel: label ? normalizeHeadingText(label) : null,
      heading: heading || null,
      embedClass: parentEmbed && typeof parentEmbed.className === "string" ? parentEmbed.className.slice(0, 260) : null,
    };
  }

  behaviorElementFromEvent(event) {
    const target = event?.target;
    if (target?.nodeType === 1) return target;
    return target?.parentElement || null;
  }

  isBehaviorInterestingTarget(target) {
    const el = target?.nodeType === 1 ? target : target?.parentElement;
    return !!el?.closest?.(".embedded-outline-view, .markdown-preview-view, .markdown-source-view, .sync-embed, .internal-embed[src]");
  }

  snapshotBehaviorScrollTarget(target) {
    if (!target) return null;
    const el = target.nodeType === 1 ? target : target.scrollingElement || null;
    if (!el) return null;
    let rect = null;
    try {
      const r = el.getBoundingClientRect?.();
      if (r) rect = { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    } catch (_) {}
    return {
      target: this.describeBehaviorElement(el),
      scrollTop: Number.isFinite(el.scrollTop) ? Math.round(el.scrollTop) : null,
      scrollLeft: Number.isFinite(el.scrollLeft) ? Math.round(el.scrollLeft) : null,
      scrollHeight: Number.isFinite(el.scrollHeight) ? Math.round(el.scrollHeight) : null,
      clientHeight: Number.isFinite(el.clientHeight) ? Math.round(el.clientHeight) : null,
      rect,
    };
  }

  getBehaviorScrollSurfaces() {
    const root = this.app.workspace?.containerEl;
    if (!root?.querySelectorAll) return [];
    const elements = [];
    const seen = new Set();
    const selector = ".markdown-preview-view, .markdown-source-view, .embedded-outline-view, .sync-embed, .internal-embed[src]";
    for (const el of root.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const snapshot = this.snapshotBehaviorScrollTarget(el);
      if (snapshot) elements.push(snapshot);
      if (elements.length >= 40) break;
    }
    return elements;
  }

  captureBehaviorContext() {
    const activeFile = this.getHostFile();
    const view = activeFile ? this.findMarkdownViewForPath(activeFile.path) : null;
    return {
      activeFile: activeFile?.path || null,
      activeViewType: view?.getViewType?.() || view?.constructor?.name || null,
      activeViewMode: view ? this.getMarkdownViewMode(view) : null,
      outlineViewCount: this.getViews().length,
      scrollSurfaces: this.getBehaviorScrollSurfaces(),
    };
  }

  recordBehavior(type, data = {}) {
    const recorder = this.behaviorRecorder;
    if (!recorder) return;
    if (recorder.events.length >= MAX_BEHAVIOR_EVENTS) {
      recorder.droppedEvents += 1;
      return;
    }
    recorder.events.push({
      seq: recorder.events.length + 1,
      elapsedMs: Math.max(0, Date.now() - recorder.startedAtMs),
      timestamp: new Date().toISOString(),
      type,
      data: this.sanitizeBehaviorValue(data),
    });
  }

  installBehaviorDomListeners() {
    if (this.behaviorDomCleanup.length) return;
    this.behaviorScrollLast = new WeakMap();
    this.behaviorWheelLast = 0;
    const cleanup = [];

    const onScroll = event => {
      const target = event?.target?.nodeType === 1 ? event.target : event?.target?.scrollingElement;
      if (!target || !this.isBehaviorInterestingTarget(target)) return;
      const now = Date.now();
      const previous = this.behaviorScrollLast.get(target) || 0;
      if (now - previous < 90) return;
      this.behaviorScrollLast.set(target, now);
      this.recordBehavior("scroll", this.snapshotBehaviorScrollTarget(target));
    };
    document.addEventListener("scroll", onScroll, true);
    cleanup.push(() => document.removeEventListener("scroll", onScroll, true));

    const onWheel = event => {
      const target = this.behaviorElementFromEvent(event);
      if (!target || !this.isBehaviorInterestingTarget(target)) return;
      const now = Date.now();
      if (now - this.behaviorWheelLast < 120) return;
      this.behaviorWheelLast = now;
      this.recordBehavior("wheel", {
        deltaX: Math.round(Number(event.deltaX) || 0),
        deltaY: Math.round(Number(event.deltaY) || 0),
        target: this.describeBehaviorElement(target),
      });
    };
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    cleanup.push(() => document.removeEventListener("wheel", onWheel, true));

    const onClick = event => {
      const target = this.behaviorElementFromEvent(event);
      if (!target || !this.isBehaviorInterestingTarget(target)) return;
      if (target.closest?.(".embedded-outline-row")) return;
      const control = target.closest?.("button, a, input, textarea, select, [role=button]");
      if (!control && !target.matches?.("h1,h2,h3,h4,h5,h6")) return;
      this.recordBehavior("content-click", {
        target: this.describeBehaviorElement(control || target),
        button: event.button,
      });
    };
    document.addEventListener("click", onClick, true);
    cleanup.push(() => document.removeEventListener("click", onClick, true));

    const onKeydown = event => {
      const navigationKeys = new Set(["Enter", "Escape", "PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !navigationKeys.has(event.key)) return;
      const target = this.behaviorElementFromEvent(event);
      if (!target || !this.isBehaviorInterestingTarget(target)) return;
      this.recordBehavior("keydown", {
        key: event.key,
        metaKey: !!event.metaKey,
        ctrlKey: !!event.ctrlKey,
        altKey: !!event.altKey,
        shiftKey: !!event.shiftKey,
        target: this.describeBehaviorElement(target),
      });
    };
    document.addEventListener("keydown", onKeydown, true);
    cleanup.push(() => document.removeEventListener("keydown", onKeydown, true));

    const workspace = this.app.workspace?.containerEl;
    if (workspace && typeof MutationObserver !== "undefined") {
      let lastMutationAt = 0;
      const observer = new MutationObserver(records => {
        const now = Date.now();
        if (now - lastMutationAt < 180) return;
        const relevant = records.filter(record => {
          const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
          return this.isBehaviorInterestingTarget(target);
        });
        if (!relevant.length) return;
        lastMutationAt = now;
        const targets = [];
        const seen = new Set();
        for (const record of relevant.slice(0, 16)) {
          const node = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
          const anchor = node?.closest?.(".sync-embed, .internal-embed[src], .embedded-outline-view, .markdown-preview-view, .markdown-source-view") || node;
          if (!anchor || seen.has(anchor)) continue;
          seen.add(anchor);
          targets.push(this.describeBehaviorElement(anchor));
        }
        this.recordBehavior("dom-mutation", {
          recordCount: relevant.length,
          mutationTypes: Array.from(new Set(relevant.map(record => record.type))),
          targets,
        });
      });
      observer.observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
      cleanup.push(() => observer.disconnect());
    }

    this.behaviorDomCleanup = cleanup;
  }

  removeBehaviorDomListeners() {
    for (const dispose of this.behaviorDomCleanup.splice(0)) {
      try { dispose(); } catch (_) {}
    }
  }

  updateBehaviorRecordingIndicators() {
    const recording = this.isBehaviorRecording();
    for (const view of this.getViews()) {
      const button = view.contentEl?.querySelector?.(".embedded-outline-record");
      const status = view.contentEl?.querySelector?.(".embedded-outline-recording-status");
      if (button) {
        button.setAttribute("aria-label", recording ? "Stop behavior recording and copy JSON" : "Start behavior recording");
        button.setAttribute("title", recording ? "Stop behavior recording and copy JSON" : "Start behavior recording");
        setIcon(button, recording ? "square" : "circle");
        button.toggleClass?.("is-recording", recording);
      }
      if (status) {
        status.textContent = recording ? "REC" : "";
        status.toggleClass?.("is-recording", recording);
      }
    }
  }

  startBehaviorRecording() {
    if (this.behaviorRecorder) {
      new Notice("Embedded Outline: behavior recording is already running.");
      return;
    }
    const startedAt = new Date();
    this.behaviorRecorder = {
      schemaVersion: BEHAVIOR_RECORDING_SCHEMA,
      pluginVersion: this.manifest?.version || null,
      appVersion: this.app?.appVersion || null,
      vaultName: this.app.vault?.getName?.() || null,
      startedAt: startedAt.toISOString(),
      startedAtMs: startedAt.getTime(),
      settings: { ...this.settings },
      initialContext: this.captureBehaviorContext(),
      events: [],
      droppedEvents: 0,
    };
    this.installBehaviorDomListeners();
    this.recordBehavior("recording-started", { context: this.captureBehaviorContext() });
    this.updateBehaviorRecordingIndicators();
    new Notice("Embedded Outline: behavior recording started. Reproduce the issue, then stop and copy the JSON log.");
  }

  async stopBehaviorRecording({ copy = false, save = false, silent = false } = {}) {
    const recorder = this.behaviorRecorder;
    if (!recorder) {
      if (!silent) new Notice("Embedded Outline: no behavior recording is running.");
      return this.lastBehaviorRecording;
    }

    this.recordBehavior("recording-stopped", { context: this.captureBehaviorContext() });
    const finishedAt = new Date();
    const report = {
      schemaVersion: recorder.schemaVersion,
      pluginVersion: recorder.pluginVersion,
      appVersion: recorder.appVersion,
      vaultName: recorder.vaultName,
      startedAt: recorder.startedAt,
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - recorder.startedAtMs),
      settings: recorder.settings,
      initialContext: recorder.initialContext,
      finalContext: this.captureBehaviorContext(),
      droppedEvents: recorder.droppedEvents,
      events: recorder.events,
    };
    this.behaviorRecorder = null;
    this.lastBehaviorRecording = report;
    this.removeBehaviorDomListeners();
    this.updateBehaviorRecordingIndicators();

    let savedPath = null;
    if (save) {
      try {
        savedPath = await this.saveBehaviorRecording(report);
        if (!silent) new Notice(`Embedded Outline: behavior log saved to ${savedPath}.`);
      } catch (e) {
        console.error("Embedded Outline: failed to save behavior recording", e);
        if (!silent) new Notice("Embedded Outline: failed to save behavior log; it is still available for copying.");
      }
    }
    if (copy) await this.copyBehaviorRecording(report, { silent });
    if (!silent && !copy && !save) new Notice("Embedded Outline: behavior recording stopped.");
    return { ...report, savedPath };
  }

  async copyBehaviorRecording(report = null, { silent = false } = {}) {
    const target = report || this.lastBehaviorRecording;
    if (!target) {
      if (!silent) new Notice("Embedded Outline: no behavior log is available.");
      return false;
    }
    const text = JSON.stringify(target, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      if (!silent) new Notice("Embedded Outline: behavior log copied to clipboard.");
      return true;
    } catch (e) {
      console.log("Embedded Outline behavior recording:\n" + text);
      if (!silent) new Notice("Embedded Outline: clipboard failed; behavior log was written to the developer console.");
      return false;
    }
  }

  async saveBehaviorRecording(report) {
    const base = `embedded-outline-behavior-${moment().format("YYYYMMDD-HHmmss")}`;
    let path = `${base}.json`;
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${base}-${suffix++}.json`;
    await this.app.vault.create(path, JSON.stringify(report, null, 2));
    return path;
  }

  clearBehaviorRecording() {
    this.removeBehaviorDomListeners();
    this.behaviorRecorder = null;
    this.lastBehaviorRecording = null;
    this.updateBehaviorRecordingIndicators();
    new Notice("Embedded Outline: behavior recording cleared.");
  }

  getHostFile() {
    const active = this.app.workspace.getActiveFile();
    if (active instanceof TFile && active.extension === "md") {
      this.lastMarkdownFilePath = active.path;
      return active;
    }
    if (this.lastMarkdownFilePath) {
      const remembered = this.app.vault.getAbstractFileByPath(this.lastMarkdownFilePath);
      if (remembered instanceof TFile && remembered.extension === "md") return remembered;
    }
    return null;
  }

  findMarkdownViewForPath(path) {
    const candidates = this.app.workspace.getLeavesOfType("markdown")
      .map(leaf => leaf.view)
      .filter(view => view instanceof MarkdownView && view.file?.path === path);
    if (!candidates.length) return null;

    // Sync Embeds creates real MarkdownView instances and reparents their DOM
    // inside `.sync-embed`. Never mistake one of those embedded views for the
    // host document that the outline is controlling.
    const hostCandidates = candidates.filter(view => !view.containerEl?.closest?.(".sync-embed"));
    if (hostCandidates.length === 1) return hostCandidates[0];
    if (hostCandidates.length > 1) {
      const visible = hostCandidates.find(view => {
        const rect = view.containerEl?.getBoundingClientRect?.();
        return view.containerEl?.isConnected && rect && rect.width > 0 && rect.height > 0;
      });
      return visible || hostCandidates[0];
    }
    return candidates[0];
  }

  shortSource(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file.basename : path.split("/").pop()?.replace(/\.md$/i, "") || path;
  }

  getViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v instanceof EmbeddedOutlineView);
  }

  refreshIfRelevant(path) {
    const active = this.getHostFile();
    if (active?.path === path || this.getViews().some(v => v.dependencyPaths.has(path))) this.scheduleRefresh(120);
  }

  scheduleRefresh(delay = 100) {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const view of this.getViews()) view.refresh();
    }, delay);
  }

  getEmbeddedOutlineLeaves() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).slice();
  }

  detachLeafQuietly(leaf) {
    if (!leaf) return;
    try { leaf.detach(); } catch (e) { console.warn("Embedded Outline: failed to detach duplicate pane", e); }
  }

  async reconcileOutlinePanes({ reveal = true } = {}) {
    let embeddedLeaves = this.getEmbeddedOutlineLeaves();
    let outlineLeaves = this.app.workspace.getLeavesOfType("outline").slice();
    let canonical = embeddedLeaves[0] || null;

    if (!canonical && outlineLeaves.length) {
      canonical = outlineLeaves.shift();
      await canonical.setViewState({ type: VIEW_TYPE, active: true });
      embeddedLeaves = [canonical];
    }

    if (!canonical) {
      canonical = this.app.workspace.getRightLeaf(false);
      if (!canonical) return null;
      await canonical.setViewState({ type: VIEW_TYPE, active: true });
      embeddedLeaves = [canonical];
    }

    // Old versions could convert another native Outline on every startup,
    // leaving several Embedded Outline tabs in the same sidebar. Keep exactly
    // one canonical leaf and remove all stale duplicates.
    for (const leaf of this.getEmbeddedOutlineLeaves()) {
      if (leaf !== canonical) this.detachLeafQuietly(leaf);
    }

    if (this.settings.replaceNativeOutline) {
      for (const leaf of this.app.workspace.getLeavesOfType("outline").slice()) {
        if (leaf !== canonical) this.detachLeafQuietly(leaf);
      }
    }

    if (reveal) this.app.workspace.revealLeaf(canonical);
    if (canonical.view instanceof EmbeddedOutlineView) await canonical.view.refresh();
    return canonical;
  }

  async replaceNativeOutlinePane() {
    return await this.reconcileOutlinePanes({ reveal: true });
  }

  async restoreReplacedOutlinePane() {
    // When replacement is disabled, keep the Embedded Outline and ensure one
    // native Outline is available beside it.
    if (this.app.workspace.getLeavesOfType("outline").length) return;
    const leaf = this.app.workspace.getRightLeaf(true);
    if (!leaf) return;
    try { await leaf.setViewState({ type: "outline", active: false }); } catch (_) {}
  }

  async restoreOutlineForUnload() {
    const leaves = this.getEmbeddedOutlineLeaves();
    if (!leaves.length) return;
    const keep = leaves[0];
    for (let i = 1; i < leaves.length; i++) this.detachLeafQuietly(leaves[i]);
    try { await keep.setViewState({ type: "outline", active: true }); } catch (_) {}
  }

  async activateView() {
    if (this.settings.replaceNativeOutline) return await this.reconcileOutlinePanes({ reveal: true });
    let leaf = this.getEmbeddedOutlineLeaves()[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof EmbeddedOutlineView) await leaf.view.refresh();
    return leaf;
  }

  getMarkdownViewMode(view) {
    try {
      const mode = view?.getMode?.();
      if (mode) return mode;
    } catch (_) {}
    if (view?.currentMode && view?.previewMode && view.currentMode === view.previewMode) return "preview";
    return "source";
  }

  getNativeScrollBehavior() {
    return this.settings.smoothScrolling ? "smooth" : "auto";
  }

  getPreviewRoot(view) {
    return view?.previewMode?.containerEl?.querySelector?.(".markdown-preview-view")
      || view?.containerEl?.querySelector?.(".markdown-preview-view")
      || view?.previewMode?.containerEl
      || view?.containerEl
      || null;
  }

  getHeadingCacheForPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    return (this.app.metadataCache.getFileCache(file)?.headings || [])
      .slice()
      .sort((a, b) => a.position.start.offset - b.position.start.offset);
  }

  getHeadingOccurrence(item) {
    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    const headings = this.getHeadingCacheForPath(item.sourceFile);
    let occurrence = 0;
    let sourceIndex = -1;
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (h.position.start.line === item.sourceLine) sourceIndex = i;
      if (normalizeHeadingText(h.heading) !== wanted) continue;
      if (h.position.start.line === item.sourceLine) return { occurrence, sourceIndex: i };
      occurrence++;
    }
    return { occurrence: 0, sourceIndex };
  }

  headingElementText(el) {
    return normalizeHeadingText(el?.getAttribute?.("data-heading") || el?.textContent || "");
  }

  findRenderedHeading(elements, item, { allowSourceIndex = false } = {}) {
    const list = Array.from(elements || []);
    if (!list.length) return null;
    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    const { occurrence, sourceIndex } = this.getHeadingOccurrence(item);
    const matches = list.filter(el => this.headingElementText(el) === wanted);
    if (matches[occurrence]) return matches[occurrence];
    if (matches.length === 1) return matches[0];
    if (allowSourceIndex && sourceIndex >= 0 && list[sourceIndex]) return list[sourceIndex];
    return null;
  }

  findLocalPreviewHeading(view, item) {
    const root = this.getPreviewRoot(view);
    if (!root) return null;
    const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(el => {
      return !el.closest(".internal-embed[src], .sync-embed");
    });
    return this.findRenderedHeading(headings, item, { allowSourceIndex: true });
  }

  async nativeScrollElement(el, boundaryEl = null, debug = null, options = {}) {
    if (!el?.scrollIntoView) return false;
    const behavior = options.behavior || this.getNativeScrollBehavior();
    const block = options.block || "center";
    this.recordBehavior("dom-scroll-request", {
      target: this.describeBehaviorElement(el),
      boundary: this.describeBehaviorElement(boundaryEl),
      behavior,
      block,
    });
    try {
      if (debug) {
        debug.domScrollStrategy = "native-element-scrollIntoView";
        debug.domScrollBehavior = behavior;
        debug.domScrollBlock = block;
      }
      el.scrollIntoView({ block, inline: "nearest", behavior });
    } catch (e) {
      if (debug) debug.domScrollOptionsError = String(e?.message || e);
      try { el.scrollIntoView(); } catch (_) { return false; }
    }
    // Never synthesize our own scroll animation. Preparatory lazy-render reveals
    // use behavior:auto + block:nearest; the final target gets at most one smooth
    // scroll. This avoids the center->heading "back and forth" seen in v0.5.0.
    const settleMs = Number.isFinite(options.settleMs)
      ? Math.max(0, options.settleMs)
      : (behavior === "smooth" ? 300 : 25);
    if (settleMs) await this.wait(settleMs);
    if (options.highlight !== false) this.flashTarget(el);
    this.recordBehavior("dom-scroll-applied", {
      target: this.describeBehaviorElement(el),
      position: this.snapshotBehaviorScrollTarget(el),
      behavior,
      block,
    });
    return true;
  }

  async nativeScrollEditorLine(editor, line, rootEl, debug = null, options = {}) {
    if (!editor || !Number.isInteger(line) || line < 0) return false;
    try {
      const lineCount = Math.max(0, editor.lineCount());
      if (debug) {
        debug.editorRequestedLine = line + 1;
        debug.editorLineCount = lineCount;
      }
      // Never clamp an invalid line to the end of a different/stale editor.
      // Doing that was the root cause of v0.4.0 confidently scrolling to the
      // wrong place when a Sync Embed runtime match was incorrect.
      if (line >= lineCount) {
        if (debug) debug.editorLineOutOfRange = true;
        return false;
      }
      const point = { line, ch: 0 };
      if (debug) {
        debug.editorScrollStrategy = "obsidian-editor-scrollIntoView";
        debug.editorLineNumber = line + 1;
      }
      editor.scrollIntoView({ from: point, to: point }, true);
      await this.wait(55);
      const lineEl = this.findCodeMirrorLine(editor, line);
      const mounted = !!lineEl && (!rootEl || rootEl.contains(lineEl));
      if (debug) debug.editorLineElementFound = mounted;
      if (mounted && options.highlight !== false) this.flashTarget(lineEl);
      return true;
    } catch (e) {
      if (debug) {
        debug.editorScrollError = { name: e?.name || "Error", message: e?.message || String(e) };
      }
      console.warn("Embedded Outline: native editor navigation failed", e);
      return false;
    }
  }

  isElementVisibleInBoundary(el, boundaryEl) {
    if (!el?.isConnected || !boundaryEl?.getBoundingClientRect) return false;
    try {
      const rect = el.getBoundingClientRect();
      const boundary = boundaryEl.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && rect.bottom > boundary.top + 8
        && rect.top < boundary.bottom - 8;
    } catch (_) {
      return false;
    }
  }

  async nativeApplyMarkdownViewScroll(markdownView, line, debug = null, prefix = "host") {
    if (!markdownView || !Number.isInteger(line) || line < 0) return false;
    const editor = markdownView.editor;
    const lineCount = editor?.lineCount?.();
    this.recordBehavior("markdown-view-scroll-request", {
      prefix,
      filePath: markdownView.file?.path || null,
      mode: this.getMarkdownViewMode(markdownView),
      line: line + 1,
      lineCount: Number.isInteger(lineCount) ? lineCount : null,
    });
    if (debug && Number.isInteger(lineCount)) debug[`${prefix}EditorLineCount`] = lineCount;
    if (Number.isInteger(lineCount) && line >= lineCount) {
      if (debug) debug[`${prefix}LineOutOfRange`] = true;
      return false;
    }

    try {
      // This is the MarkdownView's own scroll path used by Obsidian views and
      // outline-like plugins. It lets the active source/preview mode decide how
      // a Markdown line maps to the currently rendered document.
      if (typeof markdownView.currentMode?.applyScroll === "function") {
        if (debug) debug[`${prefix}ScrollStrategy`] = "markdown-view-currentMode.applyScroll";
        markdownView.currentMode.applyScroll(line);
        await this.wait(90);
        this.recordBehavior("markdown-view-scroll-applied", {
          prefix,
          filePath: markdownView.file?.path || null,
          mode: this.getMarkdownViewMode(markdownView),
          line: line + 1,
          strategy: "currentMode.applyScroll",
          scrollSurfaces: this.getBehaviorScrollSurfaces(),
        });
        return true;
      }
      if (typeof markdownView.setEphemeralState === "function") {
        if (debug) debug[`${prefix}ScrollStrategy`] = "markdown-view-setEphemeralState";
        markdownView.setEphemeralState({ line });
        await this.wait(90);
        this.recordBehavior("markdown-view-scroll-applied", {
          prefix,
          filePath: markdownView.file?.path || null,
          mode: this.getMarkdownViewMode(markdownView),
          line: line + 1,
          strategy: "setEphemeralState",
          scrollSurfaces: this.getBehaviorScrollSurfaces(),
        });
        return true;
      }
    } catch (e) {
      if (debug) debug[`${prefix}ScrollError`] = { name: e?.name || "Error", message: e?.message || String(e) };
    }

    if (editor) {
      if (debug) debug[`${prefix}ScrollFallback`] = "obsidian-editor-scrollIntoView";
      return await this.nativeScrollEditorLine(editor, line, markdownView.containerEl, debug, { highlight: false });
    }
    return false;
  }

  findLocalSourceHeadingElement(view, item) {
    const byLine = this.findCodeMirrorLine(view?.editor, item.sourceLine);
    if (byLine && view.containerEl?.contains?.(byLine) && !byLine.closest?.(".sync-embed, .internal-embed[src]")) return byLine;
    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    return Array.from(view.containerEl?.querySelectorAll?.(".cm-line") || []).find(el => {
      if (el.closest?.(".sync-embed, .internal-embed[src]")) return false;
      const text = normalizeHeadingText(String(el.textContent || "").replace(/^#{1,12}\s*/, ""));
      return text === wanted;
    }) || null;
  }

  async navigateLocalNative(view, item, debug) {
    const mode = this.getMarkdownViewMode(view);
    debug.hostViewMode = mode;

    // Preview mode owns a separate scrolling surface in current Obsidian
    // layouts. Calling scrollIntoView() on a mounted preview heading can report
    // success without moving the host MarkdownView at all, leaving far-away
    // local headings visibly in the old position. Let Obsidian resolve the
    // source line first, then only flash the mounted heading; this is one
    // authoritative scroll operation and avoids the old double-scroll path.
    let target = mode === "preview"
      ? this.findLocalPreviewHeading(view, item)
      : this.findLocalSourceHeadingElement(view, item);
    debug.localTargetElementFoundBeforeScroll = !!target;

    if (mode === "preview") {
      const ok = await this.nativeApplyMarkdownViewScroll(view, item.sourceLine, debug, "host");
      if (!ok) {
        debug.result = "local-native-scroll-failed";
        return false;
      }

      await this.wait(45);
      target = this.findLocalPreviewHeading(view, item);
      debug.localTargetElementFoundAfterScroll = !!target;
      if (target) {
        this.flashTarget(target);
        debug.highlightTarget = "local-heading-element-after-native-reveal";
      }
      debug.result = "local-scrolled-once-via-markdown-view";
      return true;
    }

    // Source mode can safely use the mounted CodeMirror line directly.
    if (target) {
      const ok = await this.nativeScrollElement(target, view.containerEl, debug, { highlight: true });
      debug.highlightTarget = "local-heading-element";
      debug.result = ok ? "local-heading-scrolled-single-pass" : "local-heading-scroll-failed";
      return ok;
    }

    // Far/virtualized headings are handed to Obsidian's own MarkdownView. Once
    // it has revealed the line we only flash the mounted target; we deliberately
    // do not issue a second scrollIntoView, avoiding a visible two-step motion.
    const ok = await this.nativeApplyMarkdownViewScroll(view, item.sourceLine, debug, "host");
    if (!ok) {
      debug.result = "local-native-scroll-failed";
      return false;
    }

    await this.wait(45);
    target = mode === "preview"
      ? this.findLocalPreviewHeading(view, item)
      : this.findLocalSourceHeadingElement(view, item);
    debug.localTargetElementFoundAfterScroll = !!target;
    if (target) {
      this.flashTarget(target);
      debug.highlightTarget = "local-heading-element-after-native-reveal";
    }
    debug.result = "local-scrolled-once-via-markdown-view";
    return true;
  }

  async navigateToItem(item) {
    const debug = {
      pluginVersion: this.manifest?.version || null,
      timestamp: new Date().toISOString(),
      item: {
        kind: item.kind,
        title: item.title,
        hostFile: item.hostFile,
        hostEmbedLine: item.hostEmbedLine,
        sourceFile: item.sourceFile,
        sourceLine: item.sourceLine,
        sourceHeading: item.sourceHeading,
        section: item.section,
        depth: item.depth,
        embedType: item.embedType,
        embedOrdinal: item.embedOrdinal,
        rootEmbedType: item.rootEmbedType,
        rootEmbedOrdinal: item.rootEmbedOrdinal,
        rootEmbedSourceFile: item.rootEmbedSourceFile,
        rootEmbedSection: item.rootEmbedSection,
        embedTrail: item.embedTrail || [],
      },
      result: "started",
    };
    this.lastNavigationDebug = debug;
    this.recordBehavior("navigation-start", {
      item: this.serializeBehaviorItem(item),
      context: this.captureBehaviorContext(),
    });

    try {
      const view = this.findMarkdownViewForPath(item.hostFile);
      debug.hostViewFound = !!view;
      if (!view?.file || view.file.path !== item.hostFile) {
        debug.result = "host-view-not-found";
        return;
      }
      debug.hostViewMode = this.getMarkdownViewMode(view);

      if (item.kind === "local") {
        await this.navigateLocalNative(view, item, debug);
        return;
      }

      // Embedded Outline navigation is intentionally in-place only. v0.5.3
      // resolves the complete nested embed trail first, then performs one final
      // visible scroll to the exact container/heading. We never open the source
      // note and we avoid the old root-container -> heading double scroll.
      const ok = await this.navigateEmbeddedTrailInPlace(view, item, debug);
      if (!ok && debug.result === "started") debug.result = "embedded-target-not-found";
    } catch (e) {
      debug.result = "navigation-exception";
      debug.error = { name: e?.name || "Error", message: e?.message || String(e) };
      console.error("Embedded Outline: navigation failed", e);
    } finally {
      this.recordBehavior("navigation-end", {
        item: this.serializeBehaviorItem(item),
        result: debug.result,
        debug,
        context: this.captureBehaviorContext(),
      });
    }
  }

  async revealHostEmbedLineInEditorIfVisible(view, item, debug) {
    if (!Number.isInteger(item.hostEmbedLine) || item.hostEmbedLine < 0) return false;
    return await this.nativeApplyMarkdownViewScroll(view, item.hostEmbedLine, debug, "hostEmbed");
  }

  findCodeMirrorLine(editor, sourceLine) {
    try {
      const cm = editor?.cm;
      if (!cm?.state?.doc || typeof cm.domAtPos !== "function") return null;
      const lineNo = Math.max(1, Math.min(cm.state.doc.lines, sourceLine + 1));
      const pos = cm.state.doc.line(lineNo).from;
      const info = cm.domAtPos(pos);
      const node = info?.node;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      return el?.closest?.(".cm-line") || null;
    } catch (_) {
      return null;
    }
  }

  findCodeMirrorHeadingByText(container, item) {
    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    const lines = Array.from(container?.querySelectorAll?.(".cm-line") || []);
    return lines.find(el => {
      const text = normalizeHeadingText(String(el.textContent || "").replace(/^#{1,12}\s*/, ""));
      return text === wanted;
    }) || null;
  }

  getEmbedSelector() {
    return ".internal-embed[src], .sync-embed";
  }

  isEmbedContainerElement(el) {
    return !!el?.matches?.(this.getEmbedSelector());
  }

  getDirectEmbedChildren(root, type) {
    if (!root?.querySelectorAll) return [];
    const selector = type === "sync" ? ".sync-embed" : ".internal-embed[src]";
    const all = Array.from(root.querySelectorAll(selector));
    const rootIsEmbed = this.isEmbedContainerElement(root);
    return all.filter(el => {
      const parentEmbed = el.parentElement?.closest?.(this.getEmbedSelector()) || null;
      return rootIsEmbed ? parentEmbed === root : parentEmbed == null;
    });
  }

  syncRuntimeMatchesStep(data, step) {
    if (!data || !step) return false;
    if (data.file?.path !== step.sourceFile) return false;
    return this.normalizeSection(data.section) === this.normalizeSection(step.section);
  }

  findEmbedStepElement(root, step, debug, stepIndex) {
    const candidates = this.getDirectEmbedChildren(root, step.type);
    const ordinal = Number.isInteger(step.ordinal) ? step.ordinal : null;
    const ordinalEl = ordinal != null ? candidates[ordinal] : null;
    let matches = [];

    if (step.type === "native") {
      matches = candidates.filter(el => {
        const spec = this.resolveNativeEmbedSpec(el, step.containingFile);
        return spec?.file?.path === step.sourceFile
          && this.normalizeSection(spec.section) === this.normalizeSection(step.section);
      });
    } else {
      const manager = this.getSyncEmbedsPlugin()?.embedManager;
      matches = candidates.filter(el => {
        const data = manager?.getEmbedFromElement?.(el) || null;
        return data ? this.syncRuntimeMatchesStep(data, step) : false;
      });
    }

    let selected = null;
    let strategy = "none";
    if (ordinalEl && (matches.length === 0 || matches.includes(ordinalEl))) {
      selected = ordinalEl;
      strategy = matches.length ? "ordinal+target-match" : "ordinal";
    } else if (matches.length === 1) {
      selected = matches[0];
      strategy = "unique-target-match";
    } else if (matches.length > 1) {
      selected = matches[0];
      strategy = "first-target-match";
    } else if (ordinalEl) {
      // Runtime metadata for Sync Embeds may not exist until the element enters
      // the viewport. DOM ordinal is still the best non-destructive fallback.
      selected = ordinalEl;
      strategy = "ordinal-unverified";
    }

    if (debug) {
      debug.embedTrailResolution ||= [];
      debug.embedTrailResolution[stepIndex] = {
        type: step.type,
        ordinal: step.ordinal,
        containingFile: step.containingFile,
        sourceFile: step.sourceFile,
        section: step.section || "",
        candidateCount: candidates.length,
        matchCount: matches.length,
        strategy,
      };
    }
    this.recordBehavior("embed-trail-resolution", {
      stepIndex,
      step: {
        type: step?.type || null,
        ordinal: Number.isInteger(step?.ordinal) ? step.ordinal : null,
        sourceFile: step?.sourceFile || null,
        section: step?.section || "",
        containingFile: step?.containingFile || null,
      },
      candidateCount: candidates.length,
      matchCount: matches.length,
      strategy,
      selected: this.describeBehaviorElement(selected),
    });
    return selected;
  }

  getItemEmbedTrail(item) {
    if (Array.isArray(item.embedTrail) && item.embedTrail.length) return item.embedTrail;
    // Compatibility for an outline tree produced immediately after upgrading
    // from v0.5.0 before its first refresh.
    const type = item.rootEmbedType || item.embedType;
    const ordinal = item.rootEmbedOrdinal ?? item.embedOrdinal;
    const sourceFile = item.rootEmbedSourceFile || item.sourceFile;
    if (!type || !sourceFile) return [];
    return [{
      type,
      ordinal,
      sourceFile,
      section: item.rootEmbedSection || item.section || "",
      containingFile: item.hostFile,
      sourceLine: item.hostEmbedLine,
    }];
  }

  async resolveEmbedTrail(view, item, debug) {
    const trail = this.getItemEmbedTrail(item);
    debug.embedTrailLength = trail.length;
    if (!trail.length) return null;

    let root = view.containerEl;
    for (let i = 0; i < trail.length; i++) {
      const step = trail[i];
      let selected = this.findEmbedStepElement(root, step, debug, i);

      if (!selected) {
        // Only reveal when lazy rendering actually prevents us from resolving
        // the next step. Existing rendered targets never get this preliminary
        // scroll, which keeps nearby-heading navigation single-pass and crisp.
        if (i === 0 && Number.isInteger(item.hostEmbedLine)) {
          await this.nativeApplyMarkdownViewScroll(view, item.hostEmbedLine, debug, "trailReveal");
        } else if (this.isEmbedContainerElement(root)) {
          await this.nativeScrollElement(root, view.containerEl, debug, {
            behavior: "auto",
            block: "nearest",
            highlight: false,
            settleMs: 35,
          });
        }

        const deadline = Date.now() + 650;
        while (!selected && Date.now() < deadline) {
          await this.wait(45);
          selected = this.findEmbedStepElement(root, step, debug, i);
        }
      }

      if (!selected) {
        debug.embedTrailFailedAt = i;
        return null;
      }
      root = selected;
    }
    debug.embedTrailResolvedDepth = trail.length;
    return root;
  }

  getDirectHeadingElements(container) {
    if (!container?.querySelectorAll) return [];
    return Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(el => {
      return el.closest?.(this.getEmbedSelector()) === container;
    });
  }

  getDirectCodeMirrorLines(container) {
    if (!container?.querySelectorAll) return [];
    return Array.from(container.querySelectorAll(".cm-line")).filter(el => {
      return el.closest?.(this.getEmbedSelector()) === container;
    });
  }

  findRenderedHeadingInContainer(container, item) {
    const headings = this.getDirectHeadingElements(container);
    const heading = this.findRenderedHeading(headings, item, { allowSourceIndex: false });
    if (heading) return { el: heading, strategy: "rendered-heading-element" };

    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    const lines = this.getDirectCodeMirrorLines(container);
    const matches = lines.filter(el => {
      const text = normalizeHeadingText(String(el.textContent || "").replace(/^#{1,12}\s*/, ""));
      return text === wanted;
    });
    if (matches.length) {
      const { occurrence } = this.getHeadingOccurrence(item);
      return { el: matches[occurrence] || matches[0], strategy: "rendered-codemirror-line" };
    }
    return null;
  }

  findDirectEmbedTitle(container) {
    if (!container?.querySelectorAll) return null;
    const els = Array.from(container.querySelectorAll(".markdown-embed-title, .file-embed-title, .markdown-embed-link"));
    return els.find(el => el.closest?.(this.getEmbedSelector()) === container) || null;
  }

  async navigateEmbeddedTrailInPlace(view, item, debug) {
    let container = await this.resolveEmbedTrail(view, item, debug);
    if (!container) {
      debug.result = "embed-trail-not-resolved";
      return false;
    }

    debug.resolvedTargetContainerClass = container.className || "";

    // An embed-container outline row represents the visual embed block itself.
    // Highlight exactly that nested block, not the outer/root embed.
    if (item.kind === "embed-container") {
      // Sync Embeds may render their container as a loading placeholder that
      // does not participate in the host preview's scroll surface. Reveal the
      // host source line through Obsidian first, then highlight the resolved
      // container without issuing a second competing scroll.
      if (container.matches?.(".sync-embed") && Number.isInteger(item.hostEmbedLine)) {
        const revealed = await this.nativeApplyMarkdownViewScroll(view, item.hostEmbedLine, debug, "hostEmbed");
        if (revealed) {
          await this.wait(45);
          this.flashTarget(container);
          debug.highlightTarget = "exact-sync-embed-container-after-host-reveal";
          debug.result = "sync-embed-container-scrolled-once-via-host-line";
          return true;
        }
      }
      const ok = await this.nativeScrollElement(container, view.containerEl, debug, { highlight: true });
      debug.highlightTarget = "exact-embed-container";
      debug.result = ok ? "embed-container-scrolled-exact" : "embed-container-scroll-failed";
      return ok;
    }

    // Fast path: if the exact heading is already rendered, scroll only once.
    // v0.5.0 first centered the embed and then centered the heading, producing
    // the visible back-and-forth motion when headings were close together.
    let rendered = this.findRenderedHeadingInContainer(container, item);
    // A rendered CodeMirror line inside Sync Embed belongs to the nested
    // MarkdownView, not to the host preview scroll surface. Let the Sync
    // branch below use that view's applyScroll() path instead of calling
    // scrollIntoView() on a line that can report success without moving the
    // visible document.
    if (rendered?.el && !container.matches?.(".sync-embed")) {
      debug.renderedHeadingStrategy = rendered.strategy;
      const ok = await this.nativeScrollElement(rendered.el, view.containerEl, debug, { highlight: true });
      debug.highlightTarget = rendered.strategy;
      debug.result = ok ? "embedded-heading-scrolled-single-pass" : "embedded-heading-scroll-failed";
      return ok;
    }

    const trail = this.getItemEmbedTrail(item);
    const lastStep = trail[trail.length - 1] || null;

    if (container.matches?.(".sync-embed")) {
      // A nested Sync heading can be rendered while its host block is still
      // outside the host reading viewport. Scrolling only the nested
      // MarkdownView then updates an off-screen surface and appears to do
      // nothing. Reveal the host block first, but only when it is actually
      // outside the host viewport; this keeps nearby clicks single-pass.
      const hostBoundary = this.getPreviewRoot(view) || view.containerEl;
      const hostEmbedVisible = this.isElementVisibleInBoundary(container, hostBoundary);
      debug.hostEmbedVisibleBeforeScroll = hostEmbedVisible;
      if (!hostEmbedVisible && Number.isInteger(item.hostEmbedLine)) {
        debug.hostEmbedRevealRequired = true;
        const revealed = await this.nativeApplyMarkdownViewScroll(view, item.hostEmbedLine, debug, "hostEmbed");
        debug.hostEmbedRevealApplied = revealed;
        if (revealed) {
          // Sync Embeds may replace its loading placeholder with a fresh
          // container after the host MarkdownView has mounted the block. Do
          // not keep navigating through the stale placeholder reference.
          await this.wait(180);
          const refreshed = await this.resolveEmbedTrail(view, item, debug);
          if (refreshed) {
            container = refreshed;
            debug.resolvedTargetContainerClass = container.className || "";
            debug.syncContainerReResolvedAfterHostReveal = true;
          }
        }
      }

      const manager = this.getSyncEmbedsPlugin()?.embedManager;
      let data = manager?.getEmbedFromElement?.(container) || null;

      if (!data?.editor) {
        // Lazy Sync Embed: a nearest/instant reveal is only used when no runtime
        // editor exists yet. It is not used for normal nearby-heading clicks.
        await this.nativeScrollElement(container, view.containerEl, debug, {
          behavior: "auto",
          block: "nearest",
          highlight: false,
          settleMs: 30,
        });
        const deadline = Date.now() + 650;
        while (!data?.editor && Date.now() < deadline) {
          await this.wait(45);
          data = manager?.getEmbedFromElement?.(container) || null;
          if (!data?.editor) {
            const refreshed = await this.resolveEmbedTrail(view, item, debug);
            if (refreshed && refreshed !== container) {
              container = refreshed;
              debug.resolvedTargetContainerClass = container.className || "";
              debug.syncContainerReResolvedDuringLazyLoad = true;
              data = manager?.getEmbedFromElement?.(container) || null;
            }
          }
        }
      }

      debug.syncEditorFound = !!data?.editor;
      debug.syncRuntimeMatchesExactTrailStep = !!(data && lastStep && this.syncRuntimeMatchesStep(data, lastStep));
      if (data?.editor && data?.view && this.syncRuntimeMatchesStep(data, lastStep)) {
        const resolvedLine = this.resolveHeadingLineInEditor(data.editor, item, debug);
        if (resolvedLine != null) {
          const applied = await this.nativeApplyMarkdownViewScroll(data.view, resolvedLine, debug, "sync");
          if (applied) {
            await this.wait(45);
            const lineEl = this.findCodeMirrorLine(data.editor, resolvedLine)
              || this.findRenderedHeadingInContainer(container, item)?.el;
            if (lineEl) {
              // Sync Embed can expose a complete, non-scrollable nested
              // MarkdownView. In that case applyScroll() returns successfully
              // but cannot move the host preview, leaving the requested line
              // outside the user's viewport. Only fall back to the host scroll
              // when the exact line is still outside the host preview; this
              // keeps already-visible headings single-pass.
              const headingVisibleInHost = this.isElementVisibleInBoundary(lineEl, hostBoundary);
              debug.syncHeadingVisibleInHostAfterMarkdownScroll = headingVisibleInHost;
              let hostHeadingRevealApplied = false;
              if (!headingVisibleInHost) {
                debug.syncHostHeadingRevealRequired = true;
                hostHeadingRevealApplied = await this.nativeScrollElement(lineEl, view.containerEl, debug, {
                  highlight: false,
                });
                debug.syncHostHeadingRevealApplied = hostHeadingRevealApplied;
              }

              this.flashTarget(lineEl);
              debug.highlightTarget = "sync-editor-heading-line";
              debug.result = hostHeadingRevealApplied
                ? "sync-heading-scrolled-via-markdown-view-and-host-reveal"
                : "sync-heading-scrolled-once-via-markdown-view";
              return true;
            }
            debug.result = "sync-heading-scrolled-target-not-mounted";
            return true;
          }
        }
      }
    } else {
      // Native embeds can lazy-render their Markdown. Reveal only when the exact
      // heading is genuinely absent, then do one final smooth scroll to it.
      await this.nativeScrollElement(container, view.containerEl, debug, {
        behavior: "auto",
        block: "nearest",
        highlight: false,
        settleMs: 30,
      });
      const deadline = Date.now() + 700;
      while (!rendered && Date.now() < deadline) {
        await this.wait(45);
        rendered = this.findRenderedHeadingInContainer(container, item);
      }
      if (rendered?.el) {
        debug.renderedHeadingStrategy = rendered.strategy + "-after-lazy-render";
        const ok = await this.nativeScrollElement(rendered.el, view.containerEl, debug, { highlight: true });
        debug.highlightTarget = rendered.strategy;
        debug.result = ok ? "native-heading-scrolled-after-lazy-render" : "native-heading-scroll-failed";
        return ok;
      }

      if (this.isFirstSourceHeading(item)) {
        const titleEl = this.findDirectEmbedTitle(container);
        if (titleEl) {
          const ok = await this.nativeScrollElement(titleEl, view.containerEl, debug, { highlight: true });
          debug.highlightTarget = "native-embed-title";
          debug.result = ok ? "native-first-heading-via-exact-embed-title" : "native-embed-title-scroll-failed";
          return ok;
        }
      }
    }

    // Last resort stays in-place, but for a heading row we must NOT pulse the
    // whole embed container. A broad fallback highlight was the reason v0.5.0
    // could tint an entire parent document when only one nested heading was
    // selected. Scroll the exact resolved container into view and leave the
    // highlight absent rather than highlighting the wrong region.
    const ok = await this.nativeScrollElement(container, view.containerEl, debug, {
      highlight: false,
      block: "nearest",
    });
    debug.highlightTarget = null;
    debug.result = ok ? "exact-container-scrolled-heading-unresolved-no-highlight" : "exact-container-scroll-failed";
    return ok;
  }

  getSyncEmbedsPlugin() {
    return this.app?.plugins?.plugins?.["sync-embeds"] || null;
  }

  getTopLevelSyncEmbedElements(root) {
    return Array.from(root.querySelectorAll(".sync-embed")).filter(el => {
      const ancestor = el.parentElement?.closest?.(".sync-embed");
      return !ancestor;
    });
  }

  getRootTargetFile(item) {
    return item.rootEmbedSourceFile || item.sourceFile;
  }

  normalizeSection(section) {
    return normalizeHeadingText(section || "");
  }

  syncEmbedMatches(embedData, item) {
    if (!embedData) return false;
    if (embedData.file?.path !== this.getRootTargetFile(item)) return false;
    return this.normalizeSection(embedData.section) === this.normalizeSection(item.rootEmbedSection || item.section);
  }

  chooseClosestToView(elements, view) {
    if (!elements.length) return null;
    const rect = view.containerEl.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    return elements.slice().sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const ad = Math.abs((ar.top + ar.height / 2) - center);
      const bd = Math.abs((br.top + br.height / 2) - center);
      return ad - bd;
    })[0];
  }

  getHostTopLevelSyncEmbedElements(view) {
    return this.getTopLevelSyncEmbedElements(view.containerEl).filter(el => {
      // A native embed may itself contain sync blocks. Those are descendants of
      // the host document visually, but they are not top-level ```sync events in
      // the host Markdown and must not shift the ordinal mapping.
      if (el.closest?.(".internal-embed[src]")) return false;
      const embeddedMarkdownView = el.parentElement?.closest?.(".sync-embed");
      return !embeddedMarkdownView;
    });
  }

  async findSyncEmbedTarget(view, item, debug) {
    const manager = this.getSyncEmbedsPlugin()?.embedManager;
    debug.syncPluginFound = !!this.getSyncEmbedsPlugin();
    debug.syncManagerFound = !!manager;

    const elements = this.getHostTopLevelSyncEmbedElements(view);
    const ordinal = item.rootEmbedOrdinal ?? item.embedOrdinal;
    debug.syncTopLevelCount = elements.length;
    debug.syncRequestedOrdinal = ordinal;

    // DOM order is the authoritative mapping for the host document because it
    // directly corresponds to the order of ```sync blocks rendered in that
    // MarkdownView. Do not wait for private runtime metadata before scrolling.
    if (Number.isInteger(ordinal) && elements[ordinal]) {
      const el = elements[ordinal];
      const data = manager?.getEmbedFromElement?.(el) || null;
      debug.syncTargetStrategy = data ? "sync-dom-ordinal-runtime-ready" : "sync-dom-ordinal";
      if (data) {
        debug.syncRuntimeFile = data.file?.path || null;
        debug.syncRuntimeSourcePath = data.sourcePath || null;
        debug.syncRuntimeSection = data.section || "";
      }
      return { el, data };
    }

    // Fallback only when DOM ordinal is unavailable (for example during an
    // unusual partial render). Restrict runtime records to containers that are
    // actually inside this host view, then match the target file/section.
    const active = Array.from(manager?.activeEmbeds || []).filter(data => {
      const el = data?.containerEl;
      return el && view.containerEl.contains(el) && this.syncEmbedMatches(data, item);
    });
    debug.syncRuntimeFallbackMatches = active.length;
    if (active.length) {
      const data = active[0];
      debug.syncTargetStrategy = "sync-runtime-host-contained";
      return { el: data.containerEl, data };
    }
    return null;
  }

  editorHeadingLineText(editor, line) {
    try {
      const raw = editor?.getLine?.(line);
      if (typeof raw !== "string") return "";
      const match = raw.match(/^\s{0,3}#{1,12}\s+(.*?)(?:\s+#+\s*)?$/);
      return normalizeHeadingText(match ? match[1] : "");
    } catch (_) {
      return "";
    }
  }

  resolveHeadingLineInEditor(editor, item, debug = null) {
    if (!editor) return null;
    const lineCount = Math.max(0, editor.lineCount?.() || 0);
    const wanted = normalizeHeadingText(item.sourceHeading || item.title);
    if (debug) {
      debug.syncEditorLineCount = lineCount;
      debug.syncRequestedSourceLine = item.sourceLine + 1;
    }

    if (item.sourceLine >= 0 && item.sourceLine < lineCount && this.editorHeadingLineText(editor, item.sourceLine) === wanted) {
      if (debug) debug.syncResolvedLineStrategy = "source-line-verified-by-heading-text";
      return item.sourceLine;
    }

    const matches = [];
    for (let line = 0; line < lineCount; line++) {
      if (this.editorHeadingLineText(editor, line) === wanted) matches.push(line);
    }
    if (!matches.length) {
      if (debug) debug.syncResolvedLineStrategy = "heading-text-not-found-in-runtime-editor";
      return null;
    }
    const { occurrence } = this.getHeadingOccurrence(item);
    const resolved = matches[occurrence] ?? matches[0];
    if (debug) {
      debug.syncResolvedLineStrategy = matches[occurrence] != null ? "heading-text-occurrence" : "heading-text-first-match";
      debug.syncResolvedEditorLine = resolved + 1;
      debug.syncHeadingTextMatchCount = matches.length;
    }
    return resolved;
  }

  async navigateSyncEmbedInPlace(view, item, debug) {
    let target = await this.findSyncEmbedTarget(view, item, debug);
    if (!target?.el) {
      debug.result = "sync-embed-dom-not-found";
      return false;
    }

    const container = target.el;
    if (container.classList.contains("is-collapsed")) container.classList.remove("is-collapsed");

    // Start moving the visible host document immediately. This also causes
    // Sync Embeds' IntersectionObserver to instantiate a lazy editor if needed.
    await this.nativeScrollElement(container, view.containerEl, debug, { highlight: false });

    if ((item.depth || 0) > 1 || item.kind === "embed-container") {
      const ok = await this.nativeScrollElement(container, view.containerEl, debug, { highlight: true });
      debug.result = ok ? ((item.depth || 0) > 1 ? "sync-nested-root-scrolled-native" : "sync-container-scrolled-native") : "sync-container-scroll-failed";
      return ok;
    }

    const manager = this.getSyncEmbedsPlugin()?.embedManager;
    let data = target.data;
    const deadline = Date.now() + 1200;
    while (!data?.editor && Date.now() < deadline) {
      await this.wait(45);
      data = manager?.getEmbedFromElement?.(container) || null;
    }

    debug.syncEditorFound = !!data?.editor;
    if (data) {
      debug.syncRuntimeFile = data.file?.path || null;
      debug.syncRuntimeSourcePath = data.sourcePath || null;
      debug.syncRuntimeSection = data.section || "";
      debug.syncRuntimeMatchesRequestedTarget = this.syncEmbedMatches(data, item);
    }

    // First try the already-rendered heading DOM. This is the least invasive
    // path and uses only the browser's native element scrolling.
    let lineEl = this.findCodeMirrorHeadingByText(container, item);
    if (lineEl) {
      debug.syncHeadingFoundBeforeEditorScroll = true;
      const ok = await this.nativeScrollElement(lineEl, view.containerEl, debug, { highlight: true });
      debug.result = ok ? "sync-heading-scrolled-from-rendered-dom" : "sync-heading-dom-scroll-failed";
      return ok;
    }

    if (data?.editor && data?.view && this.syncEmbedMatches(data, item)) {
      const resolvedLine = this.resolveHeadingLineInEditor(data.editor, item, debug);
      if (resolvedLine != null) {
        const applied = await this.nativeApplyMarkdownViewScroll(data.view, resolvedLine, debug, "sync");
        if (applied) {
          await this.wait(55);
          lineEl = this.findCodeMirrorLine(data.editor, resolvedLine)
            || this.findCodeMirrorHeadingByText(container, item);
          debug.syncLineElementFound = !!lineEl;
          if (lineEl) {
            const ok = await this.nativeScrollElement(lineEl, view.containerEl, debug, { highlight: true });
            debug.result = ok ? "sync-heading-scrolled-via-sync-markdown-view" : "sync-heading-scroll-failed";
            return ok;
          }
        }
      }
    } else if (data?.editor) {
      // Important: never scroll an editor whose file/section does not match the
      // outline item. v0.4.0 did this and then clamped line 30 to line 10.
      debug.syncEditorRejectedAsWrongTarget = true;
    }

    const ok = await this.nativeScrollElement(container, view.containerEl, debug, { highlight: true });
    debug.result = ok ? "sync-container-scrolled-heading-not-resolved" : "sync-container-scroll-failed";
    return ok;
  }

  resolveNativeEmbedSpec(el, hostFile) {
    const src = el.getAttribute("src") || "";
    if (!src) return null;
    const spec = splitWikiTarget(src.replace(/^!\[\[|\]\]$/g, ""));
    const file = this.app.metadataCache.getFirstLinkpathDest(spec.path, hostFile);
    return file ? { file, section: spec.section || "" } : null;
  }

  getTopLevelNativeEmbedElements(root) {
    return Array.from(root.querySelectorAll(".internal-embed[src]")).filter(el => {
      const ancestor = el.parentElement?.closest?.(".internal-embed[src]");
      return !ancestor;
    });
  }

  findNativeEmbedHeading(candidate, item) {
    const headings = Array.from(candidate.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(el => {
      return el.closest(".internal-embed[src]") === candidate;
    });
    return this.findRenderedHeading(headings, item, { allowSourceIndex: false });
  }

  isFirstSourceHeading(item) {
    const headings = this.getHeadingCacheForPath(item.sourceFile);
    return !!headings.length && headings[0].position.start.line === item.sourceLine;
  }

  chooseNativeEmbedCandidate(candidates, matches, item) {
    const ordinal = item.rootEmbedOrdinal ?? item.embedOrdinal;
    const ordinalEl = Number.isInteger(ordinal) ? candidates[ordinal] : null;
    if (ordinalEl && matches.includes(ordinalEl)) return ordinalEl;
    if (matches.length) return matches[0];
    return ordinalEl || null;
  }

  async navigateNativeEmbedInPlace(view, item, debug) {
    let candidates = this.getTopLevelNativeEmbedElements(view.containerEl);
    if (!candidates.length) {
      await this.revealHostEmbedLineInEditorIfVisible(view, item, debug);
      await this.wait(80);
      candidates = this.getTopLevelNativeEmbedElements(view.containerEl);
    }

    const rootFile = this.getRootTargetFile(item);
    const rootSection = this.normalizeSection(item.rootEmbedSection || item.section);
    let matches = candidates.filter(el => {
      const spec = this.resolveNativeEmbedSpec(el, item.hostFile);
      return spec?.file?.path === rootFile && this.normalizeSection(spec.section) === rootSection;
    });
    debug.nativeCandidateCount = candidates.length;
    debug.nativeMatchCount = matches.length;

    const candidate = this.chooseNativeEmbedCandidate(candidates, matches, item);
    if (!candidate) {
      debug.result = "native-embed-dom-not-found";
      return false;
    }

    // Browser/Obsidian-native element scrolling only; no manual scrollTop math.
    await this.nativeScrollElement(candidate, view.containerEl, debug, { highlight: false });

    if ((item.depth || 0) > 1 || item.kind === "embed-container") {
      const ok = await this.nativeScrollElement(candidate, view.containerEl, debug, { highlight: true });
      debug.result = ok ? ((item.depth || 0) > 1 ? "native-nested-root-scrolled-native" : "native-container-scrolled-native") : "native-container-scroll-failed";
      return ok;
    }

    let heading = null;
    const deadline = Date.now() + 1200;
    while (!heading && Date.now() < deadline) {
      heading = this.findNativeEmbedHeading(candidate, item);
      if (heading) break;
      await this.wait(60);
    }

    if (heading) {
      const ok = await this.nativeScrollElement(heading, view.containerEl, debug, { highlight: true });
      debug.result = ok ? "native-heading-scrolled-native" : "native-heading-scroll-failed";
      return ok;
    }

    // Obsidian may visually replace/suppress the first H1 of an embedded note
    // with the embed title. Treat that title as the native visual target rather
    // than inventing coordinates for a heading that is not in the DOM.
    if (this.isFirstSourceHeading(item)) {
      const titleEl = candidate.querySelector(".markdown-embed-title, .file-embed-title, .markdown-embed-link");
      if (titleEl) {
        const ok = await this.nativeScrollElement(titleEl, view.containerEl, debug, { highlight: true });
        debug.nativeUsedEmbedTitleFallback = true;
        debug.result = ok ? "native-first-heading-scrolled-via-embed-title" : "native-embed-title-scroll-failed";
        return ok;
      }
    }

    const ok = await this.nativeScrollElement(candidate, view.containerEl, debug, { highlight: true });
    debug.result = ok ? "native-container-scrolled-heading-not-rendered" : "native-container-scroll-failed-heading-not-rendered";
    return ok;
  }

  flashTarget(el) {
    if (!this.settings.navigationHighlight || !el?.classList) return;
    const duration = Math.max(300, Number(this.settings.highlightDurationMs) || 1500);
    el.style?.setProperty?.("--embedded-outline-highlight-duration", `${duration}ms`);
    el.classList.remove("embedded-outline-nav-target");
    // Force a style recalc so repeated clicks replay the breathing animation.
    void el.offsetWidth;
    el.classList.add("embedded-outline-nav-target");
    window.setTimeout(() => {
      el.classList?.remove("embedded-outline-nav-target");
      el.style?.removeProperty?.("--embedded-outline-highlight-duration");
    }, duration + 80);
  }

  wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async copyNavigationDiagnostics() {
    if (!this.lastNavigationDebug) {
      new Notice("Embedded Outline: no navigation attempt recorded yet.");
      return;
    }
    const text = JSON.stringify(this.lastNavigationDebug, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Embedded Outline: navigation diagnostics copied.");
    } catch (e) {
      console.log("Embedded Outline navigation diagnostics:\n" + text);
      new Notice("Embedded Outline: clipboard failed; diagnostics were written to the developer console.");
    }
  }

};
