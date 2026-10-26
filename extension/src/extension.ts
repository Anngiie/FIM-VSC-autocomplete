import * as vscode from 'vscode';
import axios from 'axios';
import { getSettings } from './config';
import { composeGhostColor, parseGhostColor, portFromUrl, type GhostStyle } from './platform';
import { ServerManager, type ServerStatus } from './serverManager';
import { SidebarProvider } from './sidebar';

const FIM_PREFIX = '<|fim_prefix|>';
const FIM_SUFFIX = '<|fim_suffix|>';
const FIM_MIDDLE = '<|fim_middle|>';
const STOP = [
  '<|endoftext|>',
  '<|fim_prefix|>',
  '<|fim_suffix|>',
  '<|fim_middle|>',
  '<|fim_pad|>',
  '<|im_end|>',
];

const SIDEBAR_COMMAND = 'workbench.view.extension.fim-autocomplete';
const GHOST_COLOR_KEY = 'editorGhostText.foreground';
const PREV_HL_STATE = 'fim.prevSyntaxHighlighting';

let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let manager: ServerManager | undefined;
let sidebar: SidebarProvider | undefined;
let extContext: vscode.ExtensionContext | undefined;
let notifiedDown = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function paintStatusBar(s: ServerStatus) {
  if (s.state === 'running') {
    statusBar.text = '$(check) FIM';
    statusBar.tooltip = s.managed
      ? 'FIM Autocomplete: server running — click to open'
      : 'FIM Autocomplete: connected to external server — click to open';
  } else if (s.state === 'downloading' || s.state === 'extracting' || s.state === 'starting') {
    statusBar.text = '$(sync~spin) FIM';
    statusBar.tooltip = 'FIM Autocomplete: working… — click to open';
  } else {
    statusBar.text = '$(alert) FIM: server off';
    statusBar.tooltip = 'FIM Autocomplete: server not running — click to open setup';
  }
  statusBar.command = SIDEBAR_COMMAND;
  statusBar.show();
}

async function maybeNotifyDown() {
  if (notifiedDown) {
    return;
  }
  notifiedDown = true;
  const choice = await vscode.window.showWarningMessage(
    'FIM Autocomplete: model server is not running.',
    'Open setup',
    'Retry'
  );
  if (choice === 'Open setup') {
    void vscode.commands.executeCommand(SIDEBAR_COMMAND);
  } else if (choice === 'Retry') {
    notifiedDown = false;
    await refresh();
  }
}

async function refresh() {
  if (!manager) {
    return;
  }
  const s = await manager.refresh(portFromUrl(getSettings().serverUrl));
  if (s.state === 'running') {
    notifiedDown = false;
  }
}

async function install() {
  if (!manager) {
    return;
  }
  try {
    await manager.install(portFromUrl(getSettings().serverUrl));
    notifiedDown = false;
  } catch (e) {
    output.appendLine(`install failed: ${(e as Error).message}`);
  }
}

async function start() {
  if (!manager) {
    return;
  }
  try {
    await manager.start(portFromUrl(getSettings().serverUrl));
    if (manager.getStatus().state === 'running') {
      notifiedDown = false;
    }
  } catch (e) {
    output.appendLine(`start failed: ${(e as Error).message}`);
  }
}

function stop() {
  manager?.stop();
}

function getGhostStyle(): GhostStyle {
  const customizations = vscode.workspace
    .getConfiguration('workbench')
    .get<Record<string, string>>('colorCustomizations');
  return parseGhostColor(customizations?.[GHOST_COLOR_KEY]);
}

async function setGhostColor(custom: boolean, color: string, opacity: number) {
  try {
    const wb = vscode.workspace.getConfiguration('workbench');
    const inlineCfg = vscode.workspace.getConfiguration('editor.inlineSuggest');
    const current = { ...(wb.get<Record<string, string>>('colorCustomizations') || {}) };
    if (custom) {
      current[GHOST_COLOR_KEY] = composeGhostColor(color, opacity);
      // Remember the current highlighting mode, then turn it off: when VS Code
      // syntax-highlights suggestions, the flat ghost color is ignored.
      await extContext?.globalState.update(
        PREV_HL_STATE,
        inlineCfg.get<boolean>('syntaxHighlightingEnabled', true)
      );
      await inlineCfg.update('syntaxHighlightingEnabled', false, vscode.ConfigurationTarget.Global);
    } else {
      delete current[GHOST_COLOR_KEY];
      const prev = extContext?.globalState.get<boolean>(PREV_HL_STATE, true);
      await inlineCfg.update(
        'syntaxHighlightingEnabled',
        prev ? undefined : false,
        vscode.ConfigurationTarget.Global
      );
    }
    await wb.update(
      'colorCustomizations',
      Object.keys(current).length ? current : undefined,
      vscode.ConfigurationTarget.Global
    );
  } catch (e) {
    output.appendLine(`ghost color failed: ${(e as Error).message}`);
  }
  sidebar?.pushConfig(getSettings(), getGhostStyle());
}

class FimProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const s = getSettings();
    if (!s.enabled) {
      return undefined;
    }
    if (s.disabledLanguages.includes(doc.languageId)) {
      return undefined;
    }

    // Debounce: VS Code cancels the token when the user keeps typing.
    if (s.delay > 0) {
      await sleep(s.delay);
      if (token.isCancellationRequested) {
        return undefined;
      }
    }

    const docStart = new vscode.Position(0, 0);
    const docEnd = new vscode.Position(doc.lineCount, 0);
    const prefix = doc.getText(new vscode.Range(docStart, pos)).slice(-s.maxPrefixChars);
    const suffix = doc.getText(new vscode.Range(pos, docEnd)).slice(0, s.maxSuffixChars);
    if (!prefix.trim() && !suffix.trim()) {
      return undefined;
    }

    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    try {
      //salje prefiks i sufiks upakovan,, signal sluzi da otkaze zahtev dok kucamo
      const res = await axios.post(
        `${s.serverUrl}/completion`,
        {
          prompt: `${FIM_PREFIX}${prefix}${FIM_SUFFIX}${suffix}${FIM_MIDDLE}`,
          temperature: s.temperature,
          top_p: 0.95,
          n_predict: s.maxTokens,
          stop: STOP,
          stream: false,
          cache_prompt: true,
        },
        { signal: controller.signal }
      );
      const data = res.data as { content?: string };
      let text = data.content ?? '';
      if (!s.multiline) {
        text = text.split('\n')[0];
      }
      if (!text) {
        return undefined;
      }
      notifiedDown = false;
      return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
    } catch (e) {
      if (axios.isCancel(e) || (e as Error).name === 'AbortError') {
        return undefined; // user kept typing — normal
      }
      output.appendLine(`completion failed: ${(e as Error).message}`);
      if (manager && manager.getStatus().state !== 'running') {
        await maybeNotifyDown();
      }
      return undefined;
    } finally {
      sub.dispose();
      controller.abort();
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('FIM Autocomplete');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  extContext = context;
  manager = new ServerManager(context.globalStorageUri.fsPath);
  manager.backendSetting = getSettings().serverBackend;

  sidebar = new SidebarProvider({
    install: () => void install(),
    start: () => void start(),
    stop: () => stop(),
    retry: () => void refresh(),
    setConfig: (key, value) => {
      void vscode.workspace
        .getConfiguration('fimAutocomplete')
        .update(key, value, vscode.ConfigurationTarget.Global);
    },
    setGhostColor: (custom, color, opacity) => void setGhostColor(custom, color, opacity),
    openSettings: () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fim-dev.fim-autocomplete');
    },
    getState: () => ({ status: manager!.getStatus(), config: getSettings(), ghost: getGhostStyle() }),
  });

  manager.onStatus((s) => {
    sidebar?.pushStatus(s);
    paintStatusBar(s);
  });
  manager.onProgress((p) => sidebar?.pushProgress(p));

  context.subscriptions.push(
    statusBar,
    output,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('fimAutocomplete.retryConnection', refresh),
    vscode.commands.registerCommand('fimAutocomplete.installServer', install),
    vscode.commands.registerCommand('fimAutocomplete.startServer', start),
    vscode.commands.registerCommand('fimAutocomplete.stopServer', stop),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('fimAutocomplete')) {
        if (manager) {
          manager.backendSetting = getSettings().serverBackend;
        }
        sidebar?.pushConfig(getSettings(), getGhostStyle());
        if (e.affectsConfiguration('fimAutocomplete.serverUrl')) {
          void refresh();
        }
      }
      if (e.affectsConfiguration('workbench.colorCustomizations')) {
        sidebar?.pushConfig(getSettings(), getGhostStyle());
      }
    }),
    // All languages, all files: the model only sees text, so any language works.
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      new FimProvider()
    )
  );

  paintStatusBar(manager.getStatus());
  // If the user installed the server before, start it automatically.
  void (async () => {
    const s = await manager!.refresh(portFromUrl(getSettings().serverUrl));
    if (s.state === 'stopped') {
      await start();
    }
  })();
}

export function deactivate() {
  manager?.dispose();
  manager = undefined;
  extContext = undefined;
}
