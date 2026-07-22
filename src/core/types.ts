export type RepositoryConfig = {
  id: string;
  path: string;
  taskPrefix: string;
  taskResolver: { kind: 'heading' | 'file'; path: string; heading?: string; pattern?: string };
  validation: string[];
  androidBuild?: string;
  guidance: string[];
  pilotEvidence: string;
  taskTracking: string;
  taskEvidenceDir?: string;
};

export type TaskType = 'bug' | 'ux' | 'feature' | 'technical' | 'investigation';
export type ProposedTask = {
  title: string; type: TaskType; size: 'small' | 'medium' | 'large'; problem: string; impact: string;
  evidence: string[]; reproduction: string[]; scope: string[]; outOfScope: string[]; codeAreas: string[];
  hypotheses: string[]; acceptance: string[]; validation: string[]; platforms: string[]; risks: string[]; dependencies: string[];
};
export type TaskProposal = { tasks: ProposedTask[]; warnings?: string[] };
export type ImageEvidence = { path: string; filename: string; bytes: number; format: string };
export type CreateTasksReport = {
  provider: string; repository: string; description: string; images: ImageEvidence[]; proposed: ProposedTask[];
  created: string[]; duplicates: string[]; filesChanged: string[]; trackingFile: string; dryRun: boolean;
  startedAt: string; endedAt?: string; commit?: { hash: string; message: string }; warnings: string[]; runCommand: string;
};

export type ResolvedTask = { id: string; document: string; line: number; content: string; documentationOnly: boolean };
export type CommandResult = { command: string; exitCode: number; output: string };
export type ProviderResult = { status: 'success' | 'failure' | 'timeout' | 'unavailable'; output: string; exitCode?: number };
export type TaskResult = {
  id: string; status: 'completed' | 'failed' | 'blocked' | 'skipped' | 'dry-run'; filesChanged: string[];
  validations: CommandResult[]; androidBuild?: CommandResult; commit?: { hash: string; message: string }; providerOutput?: string; reason?: string;
};
export type SequenceReport = {
  provider: string; repository: string; requestedTasks: string[]; resolvedTasks: Pick<ResolvedTask, 'id' | 'document' | 'line'>[];
  startedAt: string; endedAt?: string; tasks: TaskResult[]; finalGitStates: { workflow: string; target: string };
  resumeCommand: string; dryRun: boolean;
};
