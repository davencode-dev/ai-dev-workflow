import { runProcess } from '../core/process.ts';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';
import type { ProviderResult } from '../core/types.ts';

export class ClaudeCodeProvider implements AgentProvider {
  id = 'claude-code';
  async available() { const r = await runProcess('claude', ['--help'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'claude CLI unavailable or invalid; install/authenticate Claude Code' }; }
  async execute({ repository, prompt, timeoutMs }: Parameters<AgentProvider['execute']>[0]): Promise<ProviderResult> {
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'acceptEdits', '--output-format', 'text', prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs }: Parameters<TaskProposalProvider['propose']>[0]): Promise<ProviderResult> {
    const schema = await readFile(schemaPath, 'utf8');
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'plan', '--output-format', 'text', `${prompt}\nRespond with JSON only, matching this schema:\n${schema}`], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
}
