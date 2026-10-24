import { ChildProcess, execFile, spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { MODEL_FILE, MODEL_URL, getInstallPlan, resolveCuda, type InstallPlan } from './platform';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ServerState =
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error';

export interface ServerStatus {
  state: ServerState;
  managed: boolean;
  detail?: string;
  backend?: string;
}

export interface ProgressInfo {
  file: string;
  receivedMb: number;
  totalMb: number | null;
}

const BUSY: ServerState[] = ['downloading', 'extracting', 'starting'];

// Owns the llama-server lifecycle: one-time download, start/stop, health.
// No vscode dependency; the extension wires events to the UI.
export class ServerManager {
  backendSetting: 'auto' | 'cpu' | 'cuda' = 'auto';

  private readonly baseDir: string;
  private readonly binDir: string;
  private readonly modelPath: string;
  private proc: ChildProcess | null = null;
  private status: ServerStatus = { state: 'missing', managed: false };
  private statusListeners = new Set<(s: ServerStatus) => void>();
  private progressListeners = new Set<(p: ProgressInfo) => void>();

  constructor(storageDir: string) {
    this.baseDir = path.join(storageDir, 'server');
    this.binDir = path.join(this.baseDir, 'bin');
    this.modelPath = path.join(this.baseDir, MODEL_FILE);
  }

  onStatus(cb: (s: ServerStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onProgress(cb: (p: ProgressInfo) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  getStatus(): ServerStatus {
    return this.status;
  }

  private setStatus(patch: Partial<ServerStatus>) {
    this.status = { ...this.status, ...patch };
    for (const cb of this.statusListeners) {
      cb(this.status);
    }
  }

  private emitProgress(p: ProgressInfo) {
    for (const cb of this.progressListeners) {
      cb(p);
    }
  }

  async plan(): Promise<InstallPlan> {
    const wantCuda = await resolveCuda(this.backendSetting);
    return getInstallPlan(process.platform, process.arch, wantCuda);
  }

  private binaryPath(plan: InstallPlan): string {
    return path.join(this.binDir, plan.binaryName);
  }

  async hasFiles(): Promise<boolean> {
    try {
      const plan = await this.plan();
      await fs.access(this.binaryPath(plan));
      await fs.access(this.modelPath);
      return true;
    } catch {
      return false;
    }
  }

  static async isHealthy(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Recompute state from reality. Never disturbs an active operation.
  async refresh(port: number): Promise<ServerStatus> {
    if (BUSY.includes(this.status.state)) {
      return this.status;
    }
    if (await ServerManager.isHealthy(port)) {
      this.setStatus({
        state: 'running',
        managed: this.proc !== null,
        detail: this.proc ? 'managed by FIM Autocomplete' : 'external server on this port',
      });
    } else {
      if (this.proc) {
        this.proc = null;
      }
      this.setStatus({
        state: (await this.hasFiles()) ? 'stopped' : 'missing',
        managed: false,
        detail: undefined,
      });
    }
    return this.status;
  }

  async install(port: number): Promise<void> {
    if (BUSY.includes(this.status.state)) {
      return;
    }
    const plan = await this.plan();
    this.setStatus({ state: 'downloading', managed: false, backend: plan.backend, detail: undefined });
    await fs.mkdir(this.binDir, { recursive: true });
    try {
      for (const f of plan.files) {
        await this.download(f.url, path.join(this.binDir, f.name), f.name);
      }
      await this.download(MODEL_URL, this.modelPath, `${MODEL_FILE} (2.9 GB)`);
      this.setStatus({ state: 'extracting', managed: false, backend: plan.backend });
      for (const f of plan.files) {
        const archive = path.join(this.binDir, f.name);
        if (plan.archiveType === 'zip') {
          new AdmZip(archive).extractAllTo(this.binDir, true);
        } else {
          await execFileAsync('tar', ['-xzf', archive, '-C', this.binDir]);
        }
        await fs.unlink(archive);
      }
      if (process.platform !== 'win32') {
        await fs.chmod(this.binaryPath(plan), 0o755);
      }
      this.setStatus({ state: 'stopped', managed: false, backend: plan.backend });
      await this.start(port);
    } catch (e) {
      this.setStatus({ state: 'error', managed: false, detail: (e as Error).message });
      throw e;
    }
  }

  private async download(url: string, dest: string, label: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (HTTP ${res.status}): ${label}`);
    }
    const total = Number(res.headers.get('content-length')) || null;
    const out = createWriteStream(dest);
    const reader = res.body.getReader();
    let received = 0;
    let lastEmit = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += value.byteLength;
        if (!out.write(value)) {
          await new Promise<void>((r) => out.once('drain', () => r()));
        }
        const now = Date.now();
        if (now - lastEmit > 300) {
          lastEmit = now;
          this.emitProgress({ file: label, receivedMb: received / 1048576, totalMb: total ? total / 1048576 : null });
        }
      }
    } finally {
      reader.releaseLock();
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
    this.emitProgress({ file: label, receivedMb: received / 1048576, totalMb: total ? total / 1048576 : null });
  }

  async start(port: number): Promise<void> {
    if (this.proc || BUSY.includes(this.status.state)) {
      return;
    }
    if (await ServerManager.isHealthy(port)) {
      this.setStatus({ state: 'running', managed: false, detail: 'external server on this port' });
      return;
    }
    if (!(await this.hasFiles())) {
      this.setStatus({ state: 'missing', managed: false });
      return;
    }
    const plan = await this.plan();
    this.setStatus({ state: 'starting', managed: false, backend: plan.backend });
    const args = ['-m', this.modelPath, '--port', String(port), '-c', '8192', '-ngl', String(plan.ngl), '--jinja'];
    const env = { ...process.env };
    if (process.platform === 'linux' && plan.backend === 'cuda') {
      env['LD_LIBRARY_PATH'] = this.binDir + (env['LD_LIBRARY_PATH'] ? `:${env['LD_LIBRARY_PATH']}` : '');
    }
    let stderrTail = '';
    const proc = spawn(this.binaryPath(plan), args, { cwd: this.binDir, windowsHide: true, env });
    this.proc = proc;
    proc.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    proc.on('exit', (code) => {
      if (this.proc === proc) {
        this.proc = null;
        if (this.status.state === 'running' || this.status.state === 'starting') {
          this.setStatus({
            state: 'stopped',
            managed: false,
            detail: code ? `server exited (code ${code})` : undefined,
          });
        }
      }
    });

    const deadline = Date.now() + 180000;
    for (;;) {
      if (this.proc !== proc) {
        this.setStatus({ state: 'error', managed: false, detail: stderrTail || 'server failed to start' });
        return;
      }
      if (await ServerManager.isHealthy(port)) {
        this.setStatus({ state: 'running', managed: true, detail: `managed by FIM Autocomplete (${plan.backend})` });
        return;
      }
      if (Date.now() > deadline) {
        this.stop();
        this.setStatus({ state: 'error', managed: false, detail: 'server did not start in time' });
        return;
      }
      await sleep(500);
    }
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p && !p.killed) {
      p.kill();
    }
    if (this.status.state === 'running' || this.status.state === 'starting') {
      this.setStatus({ state: 'stopped', managed: false, detail: undefined });
    }
  }

  dispose() {
    this.stop();
    this.statusListeners.clear();
    this.progressListeners.clear();
  }
}
