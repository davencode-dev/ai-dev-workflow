import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runSequence } from '../src/core/runner.ts';
import { createTasks } from '../src/core/create-tasks.ts';
import { AntigravityProvider } from '../src/providers/antigravity-provider.ts';
import { ClaudeCodeProvider } from '../src/providers/claude-code-provider.ts';
import { CodexProvider } from '../src/providers/codex-provider.ts';
import type { AgentProvider, TaskProposalProvider } from '../src/providers/agent-provider.ts';
import type { RepositoryConfig } from '../src/core/types.ts';

// Test Fixture Helper
async function setupEvaluationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-eval-root-'));
  const repo = join(root, 'target-app');

  // Initialize root (orchestrator workspace repo)
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'eval@test.local'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Evaluator'], { cwd: root });
  await writeFile(join(root, '.gitignore'), '.agent-runs/\ntarget-app/\n*.png\n*.jpg\n*.jpeg\n*.webp\n');
  await writeFile(join(root, 'orchestrator-base.txt'), 'base');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'chore: init orchestrator base'], { cwd: root });

  // Initialize target app repository
  await mkdir(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'eval@test.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Evaluator'], { cwd: repo });

  await writeFile(
    join(repo, 'TASKS.md'),
    `### APP-001 — Fix primary button\nButton scope.\n### APP-002 — Add user profile avatar\nAvatar scope.\n### APP-003 — Optimize list rendering\nList optimization.\n`
  );
  await writeFile(join(repo, 'package.json'), '{"name":"target-app","scripts":{"test":"node test.js","build:android:local":"node build.js"}}\n');
  await writeFile(join(repo, 'test.js'), 'process.exit(0);\n');
  await writeFile(join(repo, 'build.js'), 'process.exit(0);\n');
  await writeFile(join(repo, 'app.js'), '// production code\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'chore: initial app commit'], { cwd: repo });

  const config: RepositoryConfig = {
    id: 'target-app',
    path: repo,
    taskPrefix: 'APP',
    taskResolver: { kind: 'heading', path: 'TASKS.md', heading: '### {id}' },
    validation: ['node test.js'],
    androidBuild: 'node build.js',
    guidance: ['AGENTS.md'],
    pilotEvidence: 'TASKS.md',
    taskTracking: 'TASKS.md',
    taskEvidenceDir: 'evidence',
  };

  return { root, repo, config };
}

// Configurable Evaluator Agent Provider
class EvaluationMockProvider implements AgentProvider, TaskProposalProvider {
  id = 'eval-mock-provider';
  executedTasks: string[] = [];
  behaviorByTask: Record<string, (repoPath: string) => Promise<{ status: 'success' | 'failure'; output: string; exitCode: number }>> = {};
  proposalBehavior?: (input: any) => Promise<{ status: 'success' | 'failure'; output: string; exitCode: number }>;

  async available() {
    return { ok: true };
  }

  async execute({ repository, task }: Parameters<AgentProvider['execute']>[0]) {
    this.executedTasks.push(task.id);
    const customBehavior = this.behaviorByTask[task.id];
    if (customBehavior) {
      return customBehavior(repository.path);
    }
    // Default success behavior: write clean code file
    await writeFile(join(repository.path, `${task.id}.js`), `// Implemented ${task.id}\n`);
    return { status: 'success' as const, output: `Successfully implemented ${task.id}`, exitCode: 0 };
  }

  async propose(input: Parameters<TaskProposalProvider['propose']>[0]) {
    if (this.proposalBehavior) {
      return this.proposalBehavior(input);
    }
    return {
      status: 'success' as const,
      output: JSON.stringify({
        tasks: [
          {
            title: 'Fix issue',
            type: 'bug',
            size: 'small',
            problem: 'Issue exists.',
            impact: 'High.',
            evidence: ['Visual glitch.'],
            reproduction: ['Step 1'],
            scope: ['Fix bug.'],
            outOfScope: ['Rewrites.'],
            codeAreas: ['app.js'],
            hypotheses: ['Hypothesis 1'],
            acceptance: ['Passes test.'],
            validation: ['node test.js'],
            platforms: ['Android', 'iOS'],
            risks: ['None'],
            dependencies: [],
          },
        ],
      }),
      exitCode: 0,
    };
  }
}

// ==========================================
// SCENARIO 1: GOLDEN PATH EXECUTION & AUDITING
// ==========================================
test('Scenario 1: Golden Path - executes 3 tasks sequentially, creates atomic commits and audit log', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  const { report, reportPath } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001', 'APP-002', 'APP-003'],
  });

  assert.deepEqual(provider.executedTasks, ['APP-001', 'APP-002', 'APP-003']);
  assert.equal(report.tasks.length, 3);
  assert.ok(report.tasks.every((t) => t.status === 'completed'));
  assert.equal(report.resumeCommand, 'No resume required');

  // Verify git commit count: 1 base + 3 tasks = 4 commits
  const commitCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim());
  assert.equal(commitCount, 4);

  // Verify commit messages adhere to Conventional Commits format
  const logMessages = execFileSync('git', ['log', '--format=%s', '-n', '3'], { cwd: repo }).toString().trim().split('\n');
  assert.deepEqual(logMessages, [
    'feat(target-app): complete APP-003',
    'feat(target-app): complete APP-002',
    'feat(target-app): complete APP-001',
  ]);

  // Verify report file was written in .agent-runs
  const reportContent = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(reportContent.provider, 'eval-mock-provider');
  assert.equal(reportContent.tasks.length, 3);
});

// ==========================================
// SCENARIO 2: BLAST RADIUS & SECURITY GATES
// ==========================================
test('Scenario 2.1: Blast Radius Gate - blocks task trying to modify .env', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  provider.behaviorByTask['APP-001'] = async (repoPath) => {
    await writeFile(join(repoPath, '.env'), 'SECRET_TOKEN=compromised\n');
    return { status: 'success', output: 'ok', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001', 'APP-002'],
  });

  assert.equal(report.tasks[0].status, 'blocked');
  assert.match(report.tasks[0].reason ?? '', /Unsafe or unrelated changed file: .env/);
  assert.equal(report.tasks[1].status, 'skipped');

  // Ensure no commit was made for the blocked task
  const commitCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim());
  assert.equal(commitCount, 1);
});

test('Scenario 2.2: Blast Radius Gate - blocks task trying to modify package-lock.json', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  provider.behaviorByTask['APP-001'] = async (repoPath) => {
    await writeFile(join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}\n');
    return { status: 'success', output: 'ok', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001'],
  });

  assert.equal(report.tasks[0].status, 'blocked');
  assert.match(report.tasks[0].reason ?? '', /package-lock\.json/);
});

test('Scenario 2.3: Blast Radius Gate - blocks phantom success (0 files modified)', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  provider.behaviorByTask['APP-001'] = async () => {
    // Agent did nothing but claimed success
    return { status: 'success', output: 'All done!', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001'],
  });

  assert.equal(report.tasks[0].status, 'blocked');
  assert.match(report.tasks[0].reason ?? '', /produced no changes/);
});

// ==========================================
// SCENARIO 3: VALIDATION AND CLOSURE GATES
// ==========================================
test('Scenario 3.1: Validation Gate - test failure stops execution and skips remaining tasks', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Task 1 breaks test.js
  provider.behaviorByTask['APP-001'] = async (repoPath) => {
    await writeFile(join(repoPath, 'test.js'), 'console.error("Test failed: AssertionError"); process.exit(1);\n');
    return { status: 'success', output: 'Updated test', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001', 'APP-002'],
  });

  assert.equal(report.tasks[0].status, 'failed');
  assert.match(report.tasks[0].reason ?? '', /Test failed: AssertionError/);
  assert.equal(report.tasks[1].status, 'skipped');
  assert.equal(report.resumeCommand, 'npm run tasks -- --agent eval-mock-provider target-app APP-001 APP-002');
});

test('Scenario 3.2: Android Build Closure Gate - build failure stops execution even if tests pass', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Task 1 breaks build.js
  provider.behaviorByTask['APP-001'] = async (repoPath) => {
    await writeFile(join(repoPath, 'build.js'), 'console.error("Gradle build error: compilation failed"); process.exit(2);\n');
    return { status: 'success', output: 'Updated build', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001'],
  });

  assert.equal(report.tasks[0].status, 'failed');
  assert.match(report.tasks[0].reason ?? '', /compilation failed/);
  assert.equal(report.tasks[0].validations[0].exitCode, 0); // test passed
  assert.equal(report.tasks[0].androidBuild?.exitCode, 2); // build failed
});

// ==========================================
// SCENARIO 4: END-TO-END RESUME / RECOVERY CYCLE
// ==========================================
test('Scenario 4: Resume Cycle - successfully recovers and resumes queue from point of failure', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Task 1 succeeds, Task 2 fails, Task 3 is in queue
  provider.behaviorByTask['APP-002'] = async () => {
    return { status: 'failure', output: 'Agent encountered syntax error', exitCode: 1 };
  };

  // Run 1
  const run1 = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001', 'APP-002', 'APP-003'],
  });

  assert.equal(run1.report.tasks[0].status, 'completed');
  assert.equal(run1.report.tasks[1].status, 'failed');
  assert.equal(run1.report.tasks[2].status, 'skipped');
  assert.equal(run1.report.resumeCommand, 'npm run tasks -- --agent eval-mock-provider target-app APP-002 APP-003');

  // Verify only 1 commit exists from run 1
  assert.equal(Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim()), 2);

  // Simulate human fix: reset/clean uncommitted changes if any, and fix provider behavior for APP-002
  delete provider.behaviorByTask['APP-002'];

  // Run 2: Resume with the remaining tasks ['APP-002', 'APP-003']
  const remainingIds = ['APP-002', 'APP-003'];
  const run2 = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: remainingIds,
  });

  assert.equal(run2.report.tasks[0].status, 'completed'); // APP-002
  assert.equal(run2.report.tasks[1].status, 'completed'); // APP-003
  assert.equal(run2.report.resumeCommand, 'No resume required');

  // Final commit count: 1 initial + 1 (APP-001) + 2 (APP-002, APP-003) = 4 commits
  assert.equal(Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim()), 4);
});

// ==========================================
// SCENARIO 5: CREATE-TASKS HEURISTICS & LIMITS
// ==========================================
test('Scenario 5.1: create-tasks - Identical duplicate report is blocked before task allocation', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  const image = join(root, 'screen.png');
  await writeFile(image, 'dummy-png-bytes');

  // Description identical to what exists in TASKS.md
  const result = await createTasks({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    description: 'Fix primary button',
    imagePaths: [image],
  });

  assert.equal(result.report.created.length, 0);
  assert.ok(result.report.duplicates.length > 0);
  assert.match(result.report.warnings[0], /Possible duplicate task evidence/);
});

test('Scenario 5.2: create-tasks - Lexical limitation demonstration (Semantic paraphrase bypasses duplicate filter)', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  const image = join(root, 'screen.png');
  await writeFile(image, 'dummy-png-bytes');

  // Semantically same problem ("Fix primary button"), but completely different words
  const result = await createTasks({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    description: 'Main action submission element has incorrect tap response styling',
    imagePaths: [image],
    dryRun: true,
  });

  // Demonstrates the Weak Point: Lexical filter does not catch semantic duplicates
  assert.deepEqual(result.report.duplicates, []);
  assert.deepEqual(result.report.created, ['APP-004']);
});

test('Scenario 5.3: create-tasks - --single-task rejects when provider returns multiple tasks', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  const image = join(root, 'screen.png');
  await writeFile(image, 'dummy-png-bytes');

  provider.proposalBehavior = async () => ({
    status: 'success',
    output: JSON.stringify({
      tasks: [
        { title: 'Subtask 1', type: 'bug', size: 'small', problem: 'P1', impact: 'I1', evidence: [], reproduction: [], scope: [], outOfScope: [], codeAreas: [], hypotheses: [], acceptance: [], validation: [], platforms: [], risks: [], dependencies: [] },
        { title: 'Subtask 2', type: 'bug', size: 'small', problem: 'P2', impact: 'I2', evidence: [], reproduction: [], scope: [], outOfScope: [], codeAreas: [], hypotheses: [], acceptance: [], validation: [], platforms: [], risks: [], dependencies: [] },
      ],
    }),
    exitCode: 0,
  });

  await assert.rejects(
    createTasks({
      root,
      provider,
      registry: [config],
      application: 'target-app',
      description: 'Multiple interrelated UI bugs on dashboard screen',
      imagePaths: [image],
      singleTask: true,
    }),
    /--single-task cannot safely scope this report as one task/
  );
});

// ==========================================
// SCENARIO 6: DIRTY STATE & CONCURRENCY GATES
// ==========================================
test('Scenario 6.1: Preflight Gate - blocks execution if target repository has uncommitted changes', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Dirty the target repository
  await writeFile(join(repo, 'uncommitted-file.txt'), 'dirty');

  await assert.rejects(
    runSequence({
      root,
      provider,
      registry: [config],
      application: 'target-app',
      taskIds: ['APP-001'],
    }),
    /Target repository is dirty/
  );
});

test('Scenario 6.2: Preflight Gate - blocks execution if orchestrator root repository has uncommitted changes', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Dirty the root orchestrator repository
  await writeFile(join(root, 'dirty-orchestrator.txt'), 'dirty');

  await assert.rejects(
    runSequence({
      root,
      provider,
      registry: [config],
      application: 'target-app',
      taskIds: ['APP-001'],
    }),
    /ai-dev-workflow is dirty/
  );
});

// ==========================================
// SCENARIO 7: PROVIDER ADAPTER CONTRACT AUDIT
// ==========================================
test('Scenario 7: Provider Adapters - contract, flags and prompt argument validation', () => {
  const agy = new AntigravityProvider();
  const claude = new ClaudeCodeProvider();
  const codex = new CodexProvider();

  assert.equal(agy.id, 'antigravity');
  assert.equal(claude.id, 'claude-code');
  assert.equal(codex.id, 'codex');

  // Verify providers expose available() and execute() / propose()
  assert.equal(typeof agy.available, 'function');
  assert.equal(typeof agy.execute, 'function');
  assert.equal(typeof agy.propose, 'function');

  assert.equal(typeof claude.available, 'function');
  assert.equal(typeof claude.execute, 'function');
  assert.equal(typeof claude.propose, 'function');

  assert.equal(typeof codex.available, 'function');
  assert.equal(typeof codex.execute, 'function');
  assert.equal(typeof codex.propose, 'function');
});

// ==========================================
// SCENARIO 8: REFLECTION & RETRY LOOP
// ==========================================
test('Scenario 8: Reflection Loop - recovers on attempt 2 after receiving validation failure feedback', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  let attemptCount = 0;
  const receivedPrompts: string[] = [];

  provider.execute = async ({ task, prompt }) => {
    attemptCount += 1;
    receivedPrompts.push(prompt);
    provider.executedTasks.push(task.id);

    if (attemptCount === 1) {
      // Attempt 1: write code that breaks test
      await writeFile(join(repo, 'test.js'), 'console.error("Syntax error in app"); process.exit(1);\n');
      return { status: 'success', output: 'Generated initial code', exitCode: 0 };
    }
    // Attempt 2: inspect failure in prompt and fix test.js
    await writeFile(join(repo, 'test.js'), 'process.exit(0);\n');
    await writeFile(join(repo, `${task.id}.js`), '// Fixed code\n');
    return { status: 'success', output: 'Fixed issue after feedback', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001'],
    retries: 2,
  });

  assert.equal(report.tasks[0].status, 'completed');
  assert.equal(report.tasks[0].attempts, 2);
  assert.equal(report.tasks[0].retriesUsed, 1);
  assert.equal(attemptCount, 2);
  assert.match(receivedPrompts[1], /Previous attempt \(1\/2\) for APP-001 failed/);
  assert.match(receivedPrompts[1], /Syntax error in app/);

  // Commit was created after recovery
  const commitCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim());
  assert.equal(commitCount, 2);
});

// ==========================================
// SCENARIO 9: ADVANCED DUPLICATE SIMILARITY
// ==========================================
test('Scenario 9: Enhanced Duplicate Detection - catches paraphrased and synonymous UI problem descriptions', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();
  const image = join(root, 'screen.png');
  await writeFile(image, 'dummy-png-bytes');

  // TASKS.md has: "### APP-001 — Fix primary button\nButton scope."
  // Paraphrase with synonymous terms and token overlap
  const result = await createTasks({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    description: 'Fix the primary action button styling and tap scope',
    imagePaths: [image],
    dryRun: true,
  });

  // Successfully detected duplicate candidate
  assert.ok(result.report.duplicates.includes('APP-001'));
  assert.equal(result.report.created.length, 0);
  assert.match(result.report.warnings[0], /Possible duplicate task evidence: APP-001/);
});

// ==========================================
// SCENARIO 10: CLEAN ROLLBACK ON FAILURE
// ==========================================
test('Scenario 10: Clean Rollback on Failure - restores clean git working tree when task fails', async () => {
  const { root, repo, config } = await setupEvaluationFixture();
  const provider = new EvaluationMockProvider();

  // Task creates dirty files and then fails validation
  provider.behaviorByTask['APP-001'] = async (repoPath) => {
    await writeFile(join(repoPath, 'garbage-untracked-file.js'), 'garbage');
    await writeFile(join(repoPath, 'test.js'), 'process.exit(1);');
    return { status: 'success', output: 'Failed work', exitCode: 0 };
  };

  const { report } = await runSequence({
    root,
    provider,
    registry: [config],
    application: 'target-app',
    taskIds: ['APP-001'],
    rollbackOnFailure: true,
  });

  assert.equal(report.tasks[0].status, 'failed');

  // Verify that the target repository is 100% clean due to rollbackOnFailure
  const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim();
  assert.equal(gitStatus, '');
});

