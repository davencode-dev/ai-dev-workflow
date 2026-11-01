import type { ImageEvidence, RepositoryConfig, ResolvedTask, ProviderResult } from '../core/types.ts';

// proxyEnv maps a headroom proxy url to the environment that points this CLI at it. A provider without it
// cannot run for an application that configures headroom.
export type AgentProvider = {
  id: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  proxyEnv?(proxyUrl: string): Record<string, string>;
  execute(input: { repository: RepositoryConfig; task: ResolvedTask; prompt: string; timeoutMs?: number; env?: Record<string, string> }): Promise<ProviderResult>;
};

export type TaskProposalProvider = {
  id: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  proxyEnv?(proxyUrl: string): Record<string, string>;
  propose(input: { repository: RepositoryConfig; prompt: string; images: ImageEvidence[]; schemaPath: string; timeoutMs?: number; env?: Record<string, string> }): Promise<ProviderResult>;
};

export function sessionEnv(provider: Pick<AgentProvider, 'id' | 'proxyEnv'>, proxyUrl: string | undefined): Record<string, string> | undefined {
  if (!proxyUrl) return undefined;
  if (!provider.proxyEnv) throw new Error(`Provider ${provider.id} cannot route through headroom`);
  return provider.proxyEnv(proxyUrl);
}

// Execution discipline forwarded into every provider process. Providers run with cwd set to the
// target repository, so skills installed in ai-dev-workflow never reach them; this prompt is the
// only channel the orchestrator has for it.
const evidence = "Never report work done on inspection alone: run the task's own tests or the repository validation commands, watch them pass, and quote the command and its result. State hypotheses as hypotheses, never as findings.";

const discipline = `When the task changes behaviour, work in a tight loop: before editing, name one fast, deterministic command that goes red on this exact symptom, and run it. Red before green: for a defect, make that command fail first; for new behaviour, cover it at an existing seam. For a documentation or planning task, the evidence is the configured validations passing. ${evidence}`;

const diagnosis = 'Diagnose before editing. Reproduce the failure with the exact command that failed and confirm it is the reported symptom rather than a nearby one, then shrink it to the smallest case that still fails. List three ranked hypotheses, each naming the observation that would falsify it, and test them one variable at a time. Tag temporary logging with a unique prefix and remove it before you finish. Never patch a symptom you have not reproduced.';

export function taskInstruction(task: ResolvedTask, repository: RepositoryConfig): string {
  return `Implement only ${task.id}. Read task document ${task.document}, then repository guidance ${repository.guidance.join(', ')} when present. Do not prepare later tasks. Do not commit, push, or run the closure build yourself; the common runner executes ${repository.androidBuild ?? 'the configured closure build'} after validations for every task. Do not modify task/orchestrator repositories. Make only task-related changes; report files changed and validations run.\n\n${discipline}`;
}

// Gradle and Metro failures run to megabytes; the cause is almost always at the end. The full output stays
// in the run report.
const failureTailLines = 200;
const failureTailChars = 12000;

export function failureTail(output: string): string {
  const lines = output.trimEnd().split('\n');
  let tail = lines.slice(-failureTailLines).join('\n');
  if (tail.length > failureTailChars) tail = tail.slice(-failureTailChars);
  return tail.length < output.trimEnd().length ? `[earlier output truncated; showing the last ${tail.split('\n').length} lines]\n${tail}` : tail;
}

export function retryInstruction(task: ResolvedTask, repository: RepositoryConfig, failureReason: string, attempt: number, maxRetries: number): string {
  return `Previous attempt (${attempt}/${maxRetries}) for ${task.id} failed checks or validations.\nFailure output:\n${failureTail(failureReason)}\n\n${diagnosis}\n\nFix the issues in the target repository and ensure all tests and builds succeed. Read task document ${task.document} and repository guidance ${repository.guidance.join(', ')}. Do not commit, push, or run the closure build yourself.\n\n${evidence}`;
}
