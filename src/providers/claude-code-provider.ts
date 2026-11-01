import { runProcess } from '../core/process.ts';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';
import type { ProviderResult } from '../core/types.ts';

export class ClaudeCodeProvider implements AgentProvider {
  id = 'claude-code';
  // Same variables `headroom wrap claude` sets. ENABLE_TOOL_SEARCH keeps tool schemas deferred behind a custom
  // base url instead of materialising all of them into the context window.
  proxyEnv(proxyUrl: string) { return { ANTHROPIC_BASE_URL: proxyUrl, ENABLE_TOOL_SEARCH: 'true' }; }
  async available() { const r = await runProcess('claude', ['--help'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'claude CLI unavailable or invalid; install/authenticate Claude Code' }; }
  async execute({ repository, prompt, timeoutMs, env }: Parameters<AgentProvider['execute']>[0]): Promise<ProviderResult> {
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'acceptEdits', '--output-format', 'text', prompt], repository.path, timeoutMs, env);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs, env }: Parameters<TaskProposalProvider['propose']>[0]): Promise<ProviderResult> {
    const schema = await readFile(schemaPath, 'utf8');
    const r = await runProcess('claude', ['-p', '--no-session-persistence', '--permission-mode', 'plan', '--output-format', 'text', `${prompt}\nRespond with JSON only, matching this schema:\n${schema}`], repository.path, timeoutMs, env);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
}
