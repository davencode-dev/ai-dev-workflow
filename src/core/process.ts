import { spawn } from 'node:child_process';

export async function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : undefined;
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ exitCode: code ?? 1, output }); });
    child.on('error', (error) => { if (timer) clearTimeout(timer); resolve({ exitCode: 127, output: `${error.message}\n` }); });
  });
}
