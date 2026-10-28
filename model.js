// model.js — run Qwen2.5-Coder-1.5B-LF-FIM-Heavy locally on GPU (llama.cpp).
// Requires: npm install (axios). Node 18+.
// ubacujemo axios sa require jer ovo je običan JavaScript fajl u starom Node.js sistemu koji se zove CommonJS.
// dokaz vidimo u package.json

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
const axios = require("axios");

const ROOT = __dirname;
const SERVER_BIN = path.join(
  ROOT,
  "llama-bin",
  process.platform === "win32" ? "llama-server.exe" : "llama-server"
);
// The Hugging Face file is named ...-GGUF.gguf; older local copies dropped the
// suffix. Use whichever one exists.
const MODEL_CANDIDATES = [
  path.join(ROOT, "models", "Qwen2.5-Coder-1.5B-LF-FIM-Heavy-GGUF.gguf"),
  path.join(ROOT, "models", "Qwen2.5-Coder-1.5B-LF-FIM-Heavy.gguf"),
];
const DEFAULT_MODEL = MODEL_CANDIDATES.find((p) => fs.existsSync(p)) || MODEL_CANDIDATES[0];
const PORT_ARG = getArg("--port");

const CONFIG = {
  model: process.env.MODEL_PATH || DEFAULT_MODEL,
  port: Number(process.env.PORT || PORT_ARG || 8080),
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
    //ovde ga pitamo "dal server radi"
    await axios.get(`${baseUrl(port)}/health`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function formatAxiosError(e) {
  if (e && e.response) {
    const data = e.response.data;
    const text = typeof data === "string" ? data : (data && typeof data.pipe === "function" ? "" : JSON.stringify(data));
    return `${e.response.status} ${text}`.trim();
  }
  return e.message;
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
  const payload = {
    prompt,
    temperature,
    top_p: topP,
    n_predict: maxTokens,
    stop,
    stream,
    cache_prompt: true,
  };
  if (!stream) {
    try {
      //obican FIM zahtev, vraca nam res.data.contetnt
      const res = await axios.post(`${baseUrl()}/completion`, payload);
      return res.data.content;
    } catch (e) {
      throw new Error(`completion failed: ${formatAxiosError(e)}`);
    }
  }
  // SSE stream
  let res;
  try {
    res = await axios.post(`${baseUrl()}/completion`, payload, { responseType: "stream" });
  } catch (e) {
    throw new Error(`completion failed: ${formatAxiosError(e)}`);
  }
  return new Promise((resolve, reject) => {
    let full = "";
    let buf = "";
    res.data.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.content) {
              full += evt.content;
              onToken && onToken(evt.content);
            }
            if (evt.stop) {
              res.data.destroy();
              resolve(full);
              return;
            }
          } catch { /* partial chunk */ }
        }
      }
    });
    res.data.on("end", () => resolve(full));
    res.data.on("error", reject);
  });
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
  const stream = !!opts.stream;
  let res;
  try {
    res = await axios.post(
      `${baseUrl()}/v1/chat/completions`,
      {
        messages: [{ role: "user", content: userText }],
        temperature: opts.temperature ?? 0.2,
        top_p: opts.topP ?? 0.95,
        max_tokens: opts.maxTokens ?? 512,
        stream,
      },
      stream ? { responseType: "stream" } : undefined
    );
  } catch (e) {
    throw new Error(`chat failed: ${formatAxiosError(e)}`);
  }
  if (!stream) {
    return res.data.choices[0].message.content;
  }
  // SSE stream: each event carries choices[0].delta.content.
  return new Promise((resolve, reject) => {
    let full = "";
    let buf = "";
    res.data.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          res.data.destroy();
          resolve(full);
          return;
        }
        try {
          const evt = JSON.parse(payload);
          const token = evt.choices?.[0]?.delta?.content;
          if (token) {
            full += token;
            opts.onToken && opts.onToken(token);
          }
        } catch { /* partial chunk */ }
      }
    });
    res.data.on("end", () => resolve(full));
    res.data.on("error", reject);
  });
}

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
const VALUE_FLAGS = new Set(["--max-tokens", "--temperature", "--top-p", "--port"]);
function positionalArgs(from) {
  const out = [];
  for (let i = from; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) i++; // skip the flag's value too
      continue;
    }
    out.push(a);
  }
  return out;
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
    const prompt = positionalArgs(3).join(" ");
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
  node model.js chat "prompt" [--stream]
  node model.js server [--port 8080]   (keep server running; Ctrl+C to stop)

Env: MODEL_PATH, PORT (default 8080), NGL (default 99 = full GPU), CTX (default 8192)`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error("Error:", e.message); stopOwnedServer(); process.exit(1); });
}

module.exports = { ensureServer, stopOwnedServer, infill, run, chat, complete, CONFIG };
