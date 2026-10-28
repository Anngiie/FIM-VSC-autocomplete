import * as vscode from 'vscode';
import type { ServerStatus, ProgressInfo } from './serverManager';
import type { Settings } from './config';
import type { GhostStyle } from './platform';

export interface SidebarActions {
  install(): void;
  start(): void;
  stop(): void;
  retry(): void;
  setConfig(key: string, value: unknown): void;
  setGhostColor(custom: boolean, color: string, opacity: number): void;
  openSettings(): void;
  getState(): { status: ServerStatus; config: Settings; ghost: GhostStyle };
}

interface IncomingMessage {
  type: string;
  action?: string;
  key?: string;
  value?: unknown;
  custom?: boolean;
  color?: string;
  opacity?: number;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'fimAutocomplete.sidebar';
  private view?: vscode.WebviewView;

  constructor(private readonly actions: SidebarActions) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((msg: IncomingMessage) => {
      if (msg.type === 'ready') {
        this.pushAll();
      } else if (msg.type === 'action') {
        if (msg.action === 'install') {
          this.actions.install();
        } else if (msg.action === 'start') {
          this.actions.start();
        } else if (msg.action === 'stop') {
          this.actions.stop();
        } else if (msg.action === 'retry') {
          this.actions.retry();
        }
      } else if (msg.type === 'setConfig' && msg.key !== undefined) {
        this.actions.setConfig(msg.key, msg.value);
      } else if (msg.type === 'ghostColor') {
        this.actions.setGhostColor(!!msg.custom, String(msg.color || ''), Number(msg.opacity));
      } else if (msg.type === 'openSettings') {
        this.actions.openSettings();
      }
    });
    this.pushAll();
  }

  pushStatus(status: ServerStatus) {
    void this.view?.webview.postMessage({ type: 'state', status });
  }

  pushProgress(p: ProgressInfo) {
    void this.view?.webview.postMessage({ type: 'progress', progress: p });
  }

  pushConfig(config: Settings, ghost: GhostStyle) {
    void this.view?.webview.postMessage({ type: 'config', config, ghost });
  }

  private pushAll() {
    const { status, config, ghost } = this.actions.getState();
    this.pushStatus(status);
    this.pushConfig(config, ghost);
  }

  private html(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { padding: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .card { border: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  .status-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; background: var(--vscode-descriptionForeground); }
  .dot.on { background: var(--vscode-testing-iconPassed, #89d185); }
  .dot.off { background: var(--vscode-testing-iconFailed, #f14c4c); }
  .dot.busy { background: var(--vscode-progressBar-background, #007fd4); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  #title { font-weight: 600; font-size: 13px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .small { font-size: 11px; }
  button { font-family: inherit; font-size: 13px; border-radius: 4px; cursor: pointer; transition: background-color 150ms ease; }
  button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .primary { width: 100%; padding: 8px; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-bottom: 6px; }
  .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .ghostbtn { width: 100%; padding: 6px; background: transparent; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-button-border, transparent); }
  .ghostbtn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
  #progressWrap { margin-top: 10px; }
  .bar { height: 6px; border-radius: 3px; background: var(--vscode-progressBar-background, #007fd4); opacity: 0.25; margin: 6px 0; overflow: hidden; }
  .bar > div { height: 100%; width: 0%; border-radius: 3px; background: var(--vscode-progressBar-background, #007fd4); opacity: 1; transition: width 200ms linear; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); margin: 0 0 10px 0; }
  label { display: block; font-size: 13px; margin-bottom: 10px; }
  label.row { display: flex; align-items: center; justify-content: space-between; }
  label .val { color: var(--vscode-descriptionForeground); }
  input[type="range"] { width: 100%; accent-color: var(--vscode-button-background); margin-top: 4px; }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--vscode-button-background); }
  input[type="color"] { width: 48px; height: 26px; padding: 0; border: 1px solid var(--vscode-button-border, transparent); background: none; cursor: pointer; }
  input:disabled { opacity: 0.45; cursor: default; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
  <section class="card" aria-live="polite" aria-label="Server status">
    <div class="status-row">
      <span id="dot" class="dot"></span>
      <div><div id="title">Checking…</div><div id="sub" class="muted"></div></div>
    </div>
    <button id="primary" class="primary">…</button>
    <button id="retry" class="ghostbtn">Retry connection</button>
    <div id="progressWrap" hidden>
      <div id="fileLabel" class="muted"></div>
      <div class="bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="bar"><div id="fill"></div></div>
      <div id="mbLabel" class="muted"></div>
    </div>
  </section>
  <section class="card" aria-label="Suggestion settings">
    <h2>Suggestions</h2>
    <label class="row"><span>Enabled</span><input type="checkbox" id="enabled"></label>
    <label><span>Delay <span class="val" id="delayVal"></span></span><input type="range" id="delay" min="0" max="3000" step="50"></label>
    <label><span>Max length <span class="val" id="maxTokensVal"></span></span><input type="range" id="maxtok" min="16" max="1024" step="16"></label>
    <label><span>Temperature <span class="val" id="tempVal"></span></span><input type="range" id="temp" min="0" max="2" step="0.05"></label>
    <label class="row"><span>Multi-line</span><input type="checkbox" id="multiline"></label>
  </section>
  <section class="card" aria-label="Ghost text style">
    <h2>Ghost text</h2>
    <label class="row"><span>Custom color</span><input type="checkbox" id="gcustom"></label>
    <label class="row"><span>Color</span><input type="color" id="gcolor" value="#8b8b8b"></label>
    <label><span>Opacity <span class="val" id="gopacityVal"></span></span><input type="range" id="gopacity" min="0.2" max="1" step="0.05"></label>
    <p class="muted small">Overrides the theme color for all inline suggestions. Turns off suggestion syntax highlighting so the flat color shows.</p>
  </section>
  <section class="card">
    <button id="allSettings" class="ghostbtn">All settings</button>
    <p class="muted small">Runs 100% locally. No account, no limits.</p>
  </section>
<script>
  var vscode = acquireVsCodeApi();
  function $(id) { return document.getElementById(id); }
  var primaryAction = null;
  var ghost = { custom: false, color: '#8b8b8b', opacity: 0.55 };

  function render(status) {
    var state = status.state;
    var dot = $('dot'), title = $('title'), sub = $('sub');
    var primary = $('primary'), retry = $('retry');
    $('progressWrap').hidden = (state !== 'downloading');
    dot.className = 'dot';
    primary.hidden = false;
    retry.hidden = false;
    if (state === 'missing') {
      dot.classList.add('off');
      title.textContent = 'Server not installed';
      sub.textContent = 'One-time download (~3.5 GB), then it just works.';
      primary.textContent = 'Install server';
      primary.disabled = false;
      primaryAction = 'install';
    } else if (state === 'downloading') {
      dot.classList.add('busy');
      title.textContent = 'Downloading…';
      sub.textContent = 'Keep VS Code open. This happens once.';
      primary.textContent = 'Downloading…';
      primary.disabled = true;
      primaryAction = null;
      retry.hidden = true;
    } else if (state === 'extracting') {
      dot.classList.add('busy');
      title.textContent = 'Extracting…';
      sub.textContent = '';
      primary.textContent = 'Extracting…';
      primary.disabled = true;
      primaryAction = null;
      retry.hidden = true;
    } else if (state === 'stopped') {
      dot.classList.add('off');
      title.textContent = 'Server installed, stopped';
      sub.textContent = status.detail || '';
      primary.textContent = 'Start server';
      primary.disabled = false;
      primaryAction = 'start';
    } else if (state === 'starting') {
      dot.classList.add('busy');
      title.textContent = 'Starting server…';
      sub.textContent = 'Loading the model into memory.';
      primary.textContent = 'Starting…';
      primary.disabled = true;
      primaryAction = null;
      retry.hidden = true;
    } else if (state === 'running') {
      dot.classList.add('on');
      if (status.managed) {
        title.textContent = 'Server running';
        sub.textContent = status.detail || '';
        primary.textContent = 'Stop server';
        primary.disabled = false;
        primaryAction = 'stop';
      } else {
        title.textContent = 'Connected (external server)';
        sub.textContent = 'Stop it with Ctrl+C in its own terminal.';
        primary.hidden = true;
        primaryAction = null;
      }
      retry.hidden = true;
    } else if (state === 'error') {
      dot.classList.add('off');
      title.textContent = 'Something went wrong';
      sub.textContent = status.detail || '';
      primary.textContent = 'Retry';
      primary.disabled = false;
      primaryAction = 'retry';
    }
  }

  function renderProgress(p) {
    $('fileLabel').textContent = p.file;
    var mb = p.receivedMb.toFixed(1) + ' MB' + (p.totalMb ? ' / ' + p.totalMb.toFixed(1) + ' MB' : '');
    $('mbLabel').textContent = mb;
    var pct = p.totalMb ? Math.min(100, (p.receivedMb / p.totalMb) * 100) : 0;
    $('fill').style.width = pct + '%';
    $('bar').setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function syncConfig(c) {
    $('enabled').checked = !!c.enabled;
    $('delay').value = c.delay;
    $('delayVal').textContent = c.delay + ' ms';
    $('maxtok').value = c.maxTokens;
    $('maxTokensVal').textContent = c.maxTokens + ' tokens';
    $('temp').value = c.temperature;
    $('tempVal').textContent = Number(c.temperature).toFixed(2);
    $('multiline').checked = !!c.multiline;
  }

  function syncGhost(g) {
    ghost = { custom: !!g.custom, color: g.color || '#8b8b8b', opacity: Number(g.opacity) || 0.55 };
    $('gcustom').checked = ghost.custom;
    $('gcolor').value = ghost.color;
    $('gcolor').disabled = !ghost.custom;
    $('gopacity').value = ghost.opacity;
    $('gopacity').disabled = !ghost.custom;
    $('gopacityVal').textContent = ghost.opacity.toFixed(2);
  }

  function postGhost() {
    vscode.postMessage({ type: 'ghostColor', custom: ghost.custom, color: ghost.color, opacity: ghost.opacity });
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (msg.type === 'state') { render(msg.status); }
    else if (msg.type === 'progress') { renderProgress(msg.progress); }
    else if (msg.type === 'config') { syncConfig(msg.config); syncGhost(msg.ghost); }
  });

  $('primary').addEventListener('click', function () {
    if (primaryAction) { vscode.postMessage({ type: 'action', action: primaryAction }); }
  });
  $('retry').addEventListener('click', function () { vscode.postMessage({ type: 'action', action: 'retry' }); });
  $('allSettings').addEventListener('click', function () { vscode.postMessage({ type: 'openSettings' }); });

  function bindCheck(id, key) {
    $(id).addEventListener('change', function () { vscode.postMessage({ type: 'setConfig', key: key, value: $(id).checked }); });
  }
  function bindRange(id, key, fmt) {
    $(id).addEventListener('input', function () { fmt(Number($(id).value)); });
    $(id).addEventListener('change', function () { vscode.postMessage({ type: 'setConfig', key: key, value: Number($(id).value) }); });
  }
  bindCheck('enabled', 'enabled');
  bindCheck('multiline', 'multiline');
  bindRange('delay', 'delay', function (v) { $('delayVal').textContent = v + ' ms'; });
  bindRange('maxtok', 'maxTokens', function (v) { $('maxTokensVal').textContent = v + ' tokens'; });
  bindRange('temp', 'temperature', function (v) { $('tempVal').textContent = v.toFixed(2); });

  $('gcustom').addEventListener('change', function () {
    ghost.custom = $('gcustom').checked;
    $('gcolor').disabled = !ghost.custom;
    $('gopacity').disabled = !ghost.custom;
    postGhost();
  });
  $('gcolor').addEventListener('input', function () { ghost.color = $('gcolor').value; });
  $('gcolor').addEventListener('change', function () { ghost.color = $('gcolor').value; postGhost(); });
  $('gopacity').addEventListener('input', function () {
    ghost.opacity = Number($('gopacity').value);
    $('gopacityVal').textContent = ghost.opacity.toFixed(2);
  });
  $('gopacity').addEventListener('change', function () { postGhost(); });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
