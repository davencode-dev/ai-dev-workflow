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

export function taskInstruction(task: ResolvedTask, repository: RepositoryConfig): string {
  return `Implement only ${task.id}. Read task document ${task.document}, then repository guidance ${repository.guidance.join(', ')} when present. Do not prepare later tasks. Do not commit, push, or run the Android build yourself; the common runner executes npm run build:android:local after validations for every task. Do not modify task/orchestrator repositories. Make only task-related changes; report files changed and validations run.`;
}

export function retryInstruction(task: ResolvedTask, repository: RepositoryConfig, failureReason: string, attempt: number, maxRetries: number): string {
  return `Previous attempt (${attempt}/${maxRetries}) for ${task.id} failed checks or validations.\nFailure output:\n${failureReason}\n\nPlease inspect the error, fix the issues in the target repository, and ensure all tests and builds succeed. Read task document ${task.document} and repository guidance ${repository.guidance.join(', ')}. Do not commit, push, or run the Android build yourself.`;
}
