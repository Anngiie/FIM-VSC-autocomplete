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
| `model.js` | Standalone zero-dependency script: starts `llama-server` and exposes FIM infill over HTTP (advanced path) |
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
