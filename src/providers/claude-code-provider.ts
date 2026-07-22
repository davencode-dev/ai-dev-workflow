import { runProcess } from '../core/process.ts';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';

export class ClaudeCodeProvider implements AgentProvider {
  id = 'claude-code';
  async available() { const r = await runProcess('claude', ['--help'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'claude CLI unavailable or invalid; install/authenticate Claude Code' }; }
  async execute({ repository, prompt, timeoutMs }: Parameters<AgentProvider['execute']>[0]) {
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'acceptEdits', '--output-format', 'text', prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs }: Parameters<TaskProposalProvider['propose']>[0]) {
    const schema = await readFile(schemaPath, 'utf8'); const imageDirs = [...new Set(images.map((image) => dirname(image.path)))];
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'plan', '--output-format', 'text', '--json-schema', schema, ...imageDirs.flatMap((dir) => ['--add-dir', dir]), prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
}
