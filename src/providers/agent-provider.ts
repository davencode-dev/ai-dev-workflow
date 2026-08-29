import type { ImageEvidence, RepositoryConfig, ResolvedTask, ProviderResult } from '../core/types.ts';

export type AgentProvider = {
  id: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  execute(input: { repository: RepositoryConfig; task: ResolvedTask; prompt: string; timeoutMs?: number }): Promise<ProviderResult>;
};

export type TaskProposalProvider = {
  id: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  propose(input: { repository: RepositoryConfig; prompt: string; images: ImageEvidence[]; schemaPath: string; timeoutMs?: number }): Promise<ProviderResult>;
};

// Execution discipline forwarded into every provider process. Providers run with cwd set to the
// target repository, so skills installed in ai-dev-workflow never reach them; this prompt is the
// only channel the orchestrator has for it.
const discipline = 'Work in a tight loop: before editing, name one fast, deterministic command that goes red on this exact symptom, and run it. Red before green: for a defect, make that command fail first; for a new behaviour, cover it at an existing seam. Never report work done on inspection alone. Run the check, watch it pass, and quote the command and its result as evidence. State hypotheses as hypotheses, never as findings.';

const diagnosis = 'Diagnose before editing. Reproduce the failure with the exact command that failed and confirm it is the reported symptom rather than a nearby one, then shrink it to the smallest case that still fails. List three ranked hypotheses, each naming the observation that would falsify it, and test them one variable at a time. Tag temporary logging with a unique prefix and remove it before you finish. Never patch a symptom you have not reproduced.';

export function taskInstruction(task: ResolvedTask, repository: RepositoryConfig): string {
  return `Implement only ${task.id}. Read task document ${task.document}, then repository guidance ${repository.guidance.join(', ')} when present. Do not prepare later tasks. Do not commit, push, or run the closure build yourself; the common runner executes ${repository.androidBuild ?? 'the configured closure build'} after validations for every task. Do not modify task/orchestrator repositories. Make only task-related changes; report files changed and validations run.\n\n${discipline}`;
}

export function retryInstruction(task: ResolvedTask, repository: RepositoryConfig, failureReason: string, attempt: number, maxRetries: number): string {
  return `Previous attempt (${attempt}/${maxRetries}) for ${task.id} failed checks or validations.\nFailure output:\n${failureReason}\n\n${diagnosis}\n\nFix the issues in the target repository and ensure all tests and builds succeed. Read task document ${task.document} and repository guidance ${repository.guidance.join(', ')}. Do not commit, push, or run the closure build yourself.\n\n${discipline}`;
}
