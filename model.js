// model.js — run Qwen2.5-Coder-1.5B-LF-FIM-Heavy locally on GPU (llama.cpp).
// No npm dependencies. Node 18+.
//
// Usage:
//   node model.js infill --prefix "<code before>" --suffix "<code after>" [--max-tokens 128]
//   node model.js infill --prefix-file pre.py --suffix-file suf.py
//   node model.js run "write a python quicksort"
//   node model.js chat "explain this code: ..."
//   node model.js server [--port 8080]        # start server and keep it running
//
// Env overrides: MODEL_PATH, PORT, NGL (gpu layers), CTX (context size)

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SERVER_BIN = path.join(ROOT, "llama-bin", "llama-server.exe");
const DEFAULT_MODEL = path.join(ROOT, "models", "Qwen2.5-Coder-1.5B-LF-FIM-Heavy.gguf");

const CONFIG = {
  model: process.env.MODEL_PATH || DEFAULT_MODEL,
  port: Number(process.env.PORT || 8080),
  ngl: Number(process.env.NGL || 99), // 99 = offload all layers to GPU
  ctx: Number(process.env.CTX || 8192),
};

const FIM = {
  PREFIX: "<|fim_prefix|>",
  SUFFIX: "<|fim_suffix|>",
  MIDDLE: "<|fim_middle|>",
  END: "<|endoftext|>",
};

let serverProc = null;

function baseUrl(port = CONFIG.port) {
  return `http://127.0.0.1:${port}`;
}

async function isServerUp(port = CONFIG.port) {
  try {
    const res = await fetch(`${baseUrl(port)}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(port, timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    if (await isServerUp(port)) return;
    if (Date.now() - start > timeoutMs) throw new Error("llama-server did not become ready in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Start llama-server if one isn't already running on the port.
// Returns true if this process owns the server (and should stop it later).
async function ensureServer() {
  if (await isServerUp()) return false;
  if (!fs.existsSync(SERVER_BIN)) throw new Error(`Server binary not found: ${SERVER_BIN}`);
  if (!fs.existsSync(CONFIG.model)) throw new Error(`Model file not found: ${CONFIG.model}`);

  const args = [
    "-m", CONFIG.model,
    "--port", String(CONFIG.port),
    "-c", String(CONFIG.ctx),
    "-ngl", String(CONFIG.ngl),
    "--jinja", // enable chat templates
  ];
  serverProc = spawn(SERVER_BIN, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  serverProc.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.env.VERBOSE && process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code !== 0 && code !== null) console.error(`[server] exited with code ${code}`);
  });
  await waitForServer(CONFIG.port);
  return true;
}

function stopOwnedServer() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}
process.on("SIGINT", () => { stopOwnedServer(); process.exit(130); });
process.on("SIGTERM", () => { stopOwnedServer(); process.exit(143); });

async function complete(prompt, { maxTokens = 512, temperature = 0.2, topP = 0.95, stop = [], stream = false, onToken = null } = {}) {
  const res = await fetch(`${baseUrl()}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      temperature,
      top_p: topP,
      n_predict: maxTokens,
      stop,
      stream,
      cache_prompt: true,
    }),
  });
  if (!res.ok) throw new Error(`completion failed: ${res.status} ${await res.text()}`);
  if (!stream) {
    const data = await res.json();
    return data.content;
  }
  // SSE stream
  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.content) {
            full += evt.content;
            onToken && onToken(evt.content);
          }
          if (evt.stop) return full;
        } catch { /* partial chunk */ }
      }
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
  return full;
}

// PSM-style fill-in-the-middle, same order as the HumanEval-Infilling eval:
// <|fim_prefix|> {prefix} <|fim_suffix|> {suffix} <|fim_middle|> {generate}
async function infill(prefix, suffix, opts = {}) {
  const prompt = `${FIM.PREFIX}${prefix}${FIM.SUFFIX}${suffix}${FIM.MIDDLE}`;
  return complete(prompt, {
    maxTokens: 128,
    temperature: 0.2,
    topP: 0.95,
    stop: [FIM.END, FIM.PREFIX, FIM.SUFFIX, FIM.MIDDLE, "<|fim_pad|>", "<|im_end|>"],
    ...opts,
  });
}

async function run(prompt, opts = {}) {
  return complete(prompt, { maxTokens: 512, temperature: 0.2, topP: 0.95, ...opts });
}

async function chat(userText, opts = {}) {
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: userText }],
      temperature: opts.temperature ?? 0.2,
      top_p: opts.topP ?? 0.95,
      max_tokens: opts.maxTokens ?? 512,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function readMaybeFile(flag, fileFlag, def = "") {
  const file = getArg(fileFlag);
  if (file) return fs.readFileSync(file, "utf8");
  return getArg(flag, def);
}

async function main() {
  const cmd = process.argv[2];
  const stream = hasFlag("--stream");
  const keepAlive = hasFlag("--keep-alive");

  if (cmd === "server") {
    if (await isServerUp()) {
      console.log(`Server already running on port ${CONFIG.port}`);
      return;
    }
    const owned = await ensureServer();
    console.log(`Server running on port ${CONFIG.port} (model: ${path.basename(CONFIG.model)}, ctx=${CONFIG.ctx}, ngl=${CONFIG.ngl}). Ctrl+C to stop.`);
    if (owned) await new Promise(() => {}); // park until Ctrl+C
    return;
  }

  if (cmd === "infill") {
    const prefix = readMaybeFile("--prefix", "--prefix-file");
    const suffix = readMaybeFile("--suffix", "--suffix-file");
    const owned = await ensureServer();
    try {
      const out = await infill(prefix, suffix, {
        maxTokens: Number(getArg("--max-tokens", 128)),
        temperature: Number(getArg("--temperature", 0.2)),
        topP: Number(getArg("--top-p", 0.95)),
        stream,
        onToken: stream ? (t) => process.stdout.write(t) : null,
      });
      if (!stream) process.stdout.write(out + "\n");
    } finally {
      if (owned && !keepAlive) stopOwnedServer();
    }
    return;
  }

  if (cmd === "run" || cmd === "chat") {
    const prompt = process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" ");
    if (!prompt) throw new Error(`Usage: node model.js ${cmd} "<prompt>"`);
    const owned = await ensureServer();
    try {
      const fn = cmd === "chat" ? chat : run;
      const out = await fn(prompt, {
        maxTokens: Number(getArg("--max-tokens", 512)),
        stream,
        onToken: stream ? (t) => process.stdout.write(t) : null,
      });
      if (!stream) process.stdout.write(out + "\n");
    } finally {
      if (owned && !keepAlive) stopOwnedServer();
    }
    return;
  }

  console.log(`Usage:
  node model.js infill --prefix "<before>" --suffix "<after>" [--max-tokens 128] [--stream]
  node model.js infill --prefix-file pre.py --suffix-file suf.py
  node model.js run "prompt" [--max-tokens 512] [--stream]
  node model.js chat "prompt"
  node model.js server   (keep server running; Ctrl+C to stop)

Env: MODEL_PATH, PORT (default 8080), NGL (default 99 = full GPU), CTX (default 8192)`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error("Error:", e.message); stopOwnedServer(); process.exit(1); });
}

module.exports = { ensureServer, stopOwnedServer, infill, run, chat, complete, CONFIG };
