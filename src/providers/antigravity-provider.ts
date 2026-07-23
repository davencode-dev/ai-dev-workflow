import { runProcess } from '../core/process.ts';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';

const printTimeout = '120m';

export class AntigravityProvider implements AgentProvider {
  id = 'antigravity';
  async available() { const r = await runProcess('agy', ['models'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'agy CLI unavailable or unauthenticated; install/authenticate Antigravity' }; }
  async execute({ repository, prompt, timeoutMs }: Parameters<AgentProvider['execute']>[0]) {
    const r = await runProcess('agy', ['--print-timeout', printTimeout, '--mode', 'accept-edits', '--add-dir', repository.path, '-p', prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs }: Parameters<TaskProposalProvider['propose']>[0]) {
    // agy has no output-schema flag; the schema travels in the prompt and create-tasks parses JSON out of the response.
    const schema = await readFile(schemaPath, 'utf8'); const imageDirs = [...new Set(images.map((image) => dirname(image.path)))];
    const args = ['--print-timeout', printTimeout, '--mode', 'plan', '--add-dir', repository.path, ...imageDirs.flatMap((dir) => ['--add-dir', dir]), '-p', `${prompt}\nCRITICAL: Respond ONLY with valid JSON matching this schema:\n${schema}`];
    const r = await runProcess('agy', args, repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
}
