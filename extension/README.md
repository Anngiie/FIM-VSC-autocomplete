# FIM Autocomplete

Local ghost-text code completions in VS Code, powered by your own
fill-in-the-middle model running on [llama.cpp](https://github.com/ggml-org/llama.cpp).
Free, private, and unlimited — no account, no per-token billing, everything runs on your PC.

## Getting started (one click)

1. Install this extension.
2. Click the **FIM icon** in the left Activity Bar.
3. Press **Install server** — the extension downloads the model (~2.9 GB) and
   the server for your OS once, then starts it automatically.
4. Start coding. That's it.

The sidebar always shows the server status and lets you start/stop it, tune
the suggestion settings, and change the ghost text color and opacity.

## How it works

As you type, the extension sends the code before and after your cursor to your
local model server, which predicts the missing middle. The suggestion appears as
faint ghost text at your cursor.

- **Tab** — accept the suggestion
- **Esc** — dismiss it
- Keep typing — the suggestion is cancelled automatically

Works in **every language** — the model only sees text, so Python, JavaScript,
Rust, Go, or anything else all work the same way.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `fimAutocomplete.enabled` | `true` | Master on/off switch |
| `fimAutocomplete.serverUrl` | `http://127.0.0.1:8080` | Model server URL (managed or your own) |
| `fimAutocomplete.serverBackend` | `auto` | Server build to install: `auto` (CUDA if NVIDIA GPU, Metal on macOS), `cpu`, `cuda` |
| `fimAutocomplete.delay` | `300` | ms to wait after you stop typing |
| `fimAutocomplete.maxTokens` | `128` | Max length of one suggestion (tokens) |
| `fimAutocomplete.temperature` | `0.2` | Lower = more deterministic |
| `fimAutocomplete.multiline` | `true` | Allow multi-line suggestions |
| `fimAutocomplete.maxPrefixChars` | `4000` | Code before cursor sent as context |
| `fimAutocomplete.maxSuffixChars` | `2000` | Code after cursor sent as context |
| `fimAutocomplete.disabledLanguages` | `[]` | Language ids to skip, e.g. `["markdown"]` |

The most-used settings, plus the ghost text color and opacity, are also
available directly in the sidebar. (The color override applies to all inline
suggestions in VS Code, since the ghost style is owned by the editor theme.
Enabling it turns off VS Code's suggestion syntax highlighting so the flat
color is visible; disabling it restores your previous value.)

## Commands

- **FIM Autocomplete: Install local server**
- **FIM Autocomplete: Start local server**
- **FIM Autocomplete: Stop local server**
- **FIM Autocomplete: Retry server connection**

## Advanced: using your own server

If you already run `llama-server` yourself (e.g. via the `model.js` script),
just point `fimAutocomplete.serverUrl` at it. The extension detects the
external server and uses it — the Install button stays out of the way, and you
stop that server from its own terminal (the sidebar says so).
Any GGUF fill-in-the-middle model works.

## Roadmap

Planned improvements, not yet implemented — scope and order may change:

- **Shared server across windows** — one `llama-server` per machine, owned by
  the window that started it; other windows connect to it instead of spawning
  a duplicate or reporting a false error.
- **Duplicate-operation guard** — make install/start idempotent so a rapid
  double-click cannot launch two downloads or two server processes.
- **Crash recovery** — detect and clean up (or adopt) a server left running
  after VS Code exits unexpectedly.
- **Smaller extension package** — drop the bundled `adm-zip` and use the OS
  `tar` (included with Windows 10+), removing its advisories and shrinking
  the `.vsix`.
- **Remembered install plan** — persist which build (CPU/CUDA/Metal) was
  installed and offer a one-click reinstall when switching backends or after
  a CUDA driver change.
- **Verified downloads** — SHA-256 checks for the model and server archives,
  complementing the pinned URL and exact-size check.
- **Automated install tests and CI** — mock-server download tests plus a
  GitHub Actions workflow running compile, test, and package on every push.
