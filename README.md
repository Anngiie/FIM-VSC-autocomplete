# FIM Autocomplete

Local ghost-text code completions for VS Code, powered by your own
fill-in-the-middle model running on
[llama.cpp](https://github.com/ggml-org/llama.cpp).
Free, private, and unlimited — no account, no per-token billing.

## Layout

| Path | What |
|---|---|
| `extension/` | The VS Code extension (TypeScript): inline completions, sidebar with one-click server install, ghost color settings |
| `extension/test/` | Pure-logic tests (`npm test` inside `extension/`) |
| `model.js` | Standalone script (`npm install` for axios): starts `llama-server` and exposes FIM infill over HTTP (advanced path) |
| `.vscode/` | Launch config — press F5 to debug the extension |

`models/` and `llama-bin/` are local-only (multi-GB downloads) and are never
committed. End users get them automatically via the sidebar's **Install server**
button; see [extension/README.md](extension/README.md).

## Develop

```sh
cd extension
npm install
npm test        # compiles + runs tests
```

Then open this folder in VS Code and press **F5** to launch the Extension
Development Host, or run `npm run package` to build a `.vsix`.

## Model

Built around
[Qwen2.5-Coder-1.5B-LF-FIM-Heavy](https://huggingface.co/jolovicdev/Qwen2.5-Coder-1.5B-LF-FIM-Heavy-GGUF),
a fill-in-the-middle finetune of `Qwen/Qwen2.5-Coder-1.5B`, but any GGUF
FIM-capable model works with your own server URL.

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
