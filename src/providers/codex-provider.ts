import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { runProcess } from '../core/process.ts';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';

export function codexProposalArgs(repositoryPath: string, schemaPath: string, outputPath: string, imagePaths: string[], prompt: string): string[] {
  return ['exec', '--ephemeral', '-C', repositoryPath, '-s', 'read-only', '--output-schema', schemaPath, '--output-last-message', outputPath, ...imagePaths.flatMap((path) => ['--image', path]), '--', prompt];
}

export class CodexProvider implements AgentProvider {
  id = 'codex';
  async available() { const r = await runProcess('codex', ['exec', '--help'], process.cwd()); return r.exitCode === 0 ? { ok: true } : { ok: false, reason: 'codex CLI unavailable or invalid' }; }
  async execute({ repository, prompt, timeoutMs }: Parameters<AgentProvider['execute']>[0]) {
    const r = await runProcess('codex', ['exec', '--ephemeral', '-C', repository.path, '-s', 'workspace-write', prompt], repository.path, timeoutMs);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output: r.output, exitCode: r.exitCode };
  }
  async propose({ repository, prompt, images, schemaPath, timeoutMs }: Parameters<TaskProposalProvider['propose']>[0]) {
    const outputPath = `${schemaPath}.output-${process.pid}-${Date.now()}.json`;
    const args = codexProposalArgs(repository.path, schemaPath, outputPath, images.map((image) => image.path), prompt);
    const r = await runProcess('codex', args, repository.path, timeoutMs);
    const output = existsSync(outputPath) ? await readFile(outputPath, 'utf8') : r.output;
    if (existsSync(outputPath)) await unlink(outputPath);
    return { status: r.exitCode === 0 ? 'success' : 'failure', output, exitCode: r.exitCode };
  }
}
