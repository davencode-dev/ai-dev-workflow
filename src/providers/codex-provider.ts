import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { runProcess } from '../core/process.ts';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';

export class CodexProvider implements AgentProvider {
  id = 'codex';
  async available() { const r = await runProcess('codex', ['exec', '--help'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'codex CLI unavailable or invalid' }; }
  async execute({ repository, prompt, timeoutMs }: Parameters<AgentProvider['execute']>[0]) {
    const r = await runProcess('codex', ['exec', '--ephemeral', '-C', repository.path, '-s', 'workspace-write', prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs }: Parameters<TaskProposalProvider['propose']>[0]) {
    const args = ['exec', '--ephemeral', '-C', repository.path, '-s', 'read-only', '--output-schema', schemaPath, ...images.flatMap((image) => ['--image', image.path]), prompt];
    const r = await runProcess('codex', args, repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
}
