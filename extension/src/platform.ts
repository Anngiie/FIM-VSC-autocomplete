import { execFile } from 'node:child_process';

// Pinned llama.cpp build + model. Bump LLAMA_BUILD (and asset names if they
// change) to ship a newer server. Pure logic, no vscode dependency.
export const LLAMA_BUILD = 'b11669';
export const LLAMA_REPO = 'https://github.com/ggml-org/llama.cpp';
export const MODEL_URL =
  'https://huggingface.co/jolovicdev/Qwen2.5-Coder-1.5B-LF-FIM-Heavy-GGUF/resolve/main/Qwen2.5-Coder-1.5B-LF-FIM-Heavy-GGUF.gguf';
export const MODEL_FILE = 'model.gguf';

export interface DownloadFile {
  name: string;
  url: string;
}

export interface InstallPlan {
  backend: 'cuda' | 'cpu' | 'metal';
  binaryName: string;
  archiveType: 'zip' | 'targz';
  ngl: number;
  files: DownloadFile[];
}

export function portFromUrl(url: string, fallback = 8080): number {
  try {
    const p = Number(new URL(url).port);
    return Number.isFinite(p) && p > 0 ? p : fallback;
  } catch {
    return fallback;
  }
}

export function hasNvidiaGpu(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['-L'], { timeout: 8000 }, (err) => resolve(!err));
  });
}

export async function resolveCuda(
  setting: 'auto' | 'cpu' | 'cuda',
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (setting === 'cpu' || platform === 'darwin') {
    return false;
  }
  if (setting === 'cuda') {
    return true;
  }
  return hasNvidiaGpu();
}

export function getInstallPlan(
  platform: NodeJS.Platform,
  arch: string,
  wantCuda: boolean
): InstallPlan {
  const dl = (name: string) => `${LLAMA_REPO}/releases/download/${LLAMA_BUILD}/${name}`;
  const B = LLAMA_BUILD;

  if (platform === 'win32') {
    if (arch === 'arm64') {
      return wantCuda
        ? {
            backend: 'cuda',
            binaryName: 'llama-server.exe',
            archiveType: 'zip',
            ngl: 99,
            files: [
              { name: `llama-${B}-bin-win-cuda-13.4-arm64.zip`, url: dl(`llama-${B}-bin-win-cuda-13.4-arm64.zip`) },
              { name: 'cudart-llama-bin-win-cuda-13.4-arm64.zip', url: dl('cudart-llama-bin-win-cuda-13.4-arm64.zip') },
            ],
          }
        : {
            backend: 'cpu',
            binaryName: 'llama-server.exe',
            archiveType: 'zip',
            ngl: 0,
            files: [{ name: `llama-${B}-bin-win-cpu-arm64.zip`, url: dl(`llama-${B}-bin-win-cpu-arm64.zip`) }],
          };
    }
    return wantCuda
      ? {
          backend: 'cuda',
          binaryName: 'llama-server.exe',
          archiveType: 'zip',
          ngl: 99,
          files: [
            { name: `llama-${B}-bin-win-cuda-12.4-x64.zip`, url: dl(`llama-${B}-bin-win-cuda-12.4-x64.zip`) },
            { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', url: dl('cudart-llama-bin-win-cuda-12.4-x64.zip') },
          ],
        }
      : {
          backend: 'cpu',
          binaryName: 'llama-server.exe',
          archiveType: 'zip',
          ngl: 0,
          files: [{ name: `llama-${B}-bin-win-cpu-x64.zip`, url: dl(`llama-${B}-bin-win-cpu-x64.zip`) }],
        };
  }

  if (platform === 'darwin') {
    const asset = arch === 'arm64' ? `llama-${B}-bin-macos-arm64.tar.gz` : `llama-${B}-bin-macos-x64.tar.gz`;
    return {
      backend: 'metal',
      binaryName: 'llama-server',
      archiveType: 'targz',
      ngl: 99,
      files: [{ name: asset, url: dl(asset) }],
    };
  }

  if (platform === 'linux') {
    if (arch === 'arm64') {
      return wantCuda
        ? {
            backend: 'cuda',
            binaryName: 'llama-server',
            archiveType: 'targz',
            ngl: 99,
            files: [
              { name: `llama-${B}-bin-ubuntu-cuda-13.4-arm64.tar.gz`, url: dl(`llama-${B}-bin-ubuntu-cuda-13.4-arm64.tar.gz`) },
              { name: `cudart-llama-${B}-bin-ubuntu-cuda-13.4-arm64.tar.gz`, url: dl(`cudart-llama-${B}-bin-ubuntu-cuda-13.4-arm64.tar.gz`) },
            ],
          }
        : {
            backend: 'cpu',
            binaryName: 'llama-server',
            archiveType: 'targz',
            ngl: 0,
            files: [{ name: `llama-${B}-bin-ubuntu-arm64.tar.gz`, url: dl(`llama-${B}-bin-ubuntu-arm64.tar.gz`) }],
          };
    }
    return wantCuda
      ? {
          backend: 'cuda',
          binaryName: 'llama-server',
          archiveType: 'targz',
          ngl: 99,
          files: [
            { name: `llama-${B}-bin-ubuntu-cuda-12.8-x64.tar.gz`, url: dl(`llama-${B}-bin-ubuntu-cuda-12.8-x64.tar.gz`) },
            { name: `cudart-llama-${B}-bin-ubuntu-cuda-12.8-x64.tar.gz`, url: dl(`cudart-llama-${B}-bin-ubuntu-cuda-12.8-x64.tar.gz`) },
          ],
        }
      : {
          backend: 'cpu',
          binaryName: 'llama-server',
          archiveType: 'targz',
          ngl: 0,
          files: [{ name: `llama-${B}-bin-ubuntu-x64.tar.gz`, url: dl(`llama-${B}-bin-ubuntu-x64.tar.gz`) }],
        };
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export interface GhostStyle {
  custom: boolean;
  color: string; // #rrggbb
  opacity: number; // 0..1
}

export const DEFAULT_GHOST: GhostStyle = { custom: false, color: '#8b8b8b', opacity: 0.55 };

// VS Code themes ghost text via workbench.colorCustomizations
// "editorGhostText.foreground", which accepts #rrggbbaa.
export function composeGhostColor(color: string, opacity: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`Invalid color: ${color}`);
  }
  const clamped = Math.min(1, Math.max(0, opacity));
  const alpha = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color}${alpha}`.toLowerCase();
}

export function parseGhostColor(value: unknown): GhostStyle {
  if (typeof value === 'string') {
    const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(value);
    if (m) {
      return {
        custom: true,
        color: `#${m[1]}`.toLowerCase(),
        opacity: m[2] ? Math.round((parseInt(m[2], 16) / 255) * 100) / 100 : 1,
      };
    }
  }
  return { ...DEFAULT_GHOST };
}
