import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { retryInstruction, taskInstruction } from '../src/providers/agent-provider.ts';
import type { RepositoryConfig, ResolvedTask } from '../src/core/types.ts';

const task = { id: 'APP-001', document: 'docs/tasks/APP-001-example.md' } as ResolvedTask;
const repository = { id: 'example-app', path: '/tmp/example-app', guidance: ['AGENTS.md'], androidBuild: 'npm run build:android:local' } as RepositoryConfig;

test('task instruction carries the execution discipline into the provider process', () => {
  const prompt = taskInstruction(task, repository);
  assert.match(prompt, /Implement only APP-001/);
  assert.match(prompt, /goes red on this exact symptom/);
  assert.match(prompt, /Never report work done on inspection alone/);
  assert.match(prompt, /quote the command and its result as evidence/);
});

test('task instruction names the configured closure build, not a hardcoded one', () => {
  assert.match(taskInstruction(task, repository), /npm run build:android:local/);
  assert.match(taskInstruction(task, { ...repository, androidBuild: './gradlew assembleDebug' }), /\.\/gradlew assembleDebug/);
  const unset = taskInstruction(task, { ...repository, androidBuild: undefined });
  assert.match(unset, /the configured closure build/);
  assert.doesNotMatch(unset, /build:android:local/);
});

test('retry instruction adds diagnosis and keeps the discipline', () => {
  const prompt = retryInstruction(task, repository, 'tsc: type error', 1, 2);
  assert.match(prompt, /tsc: type error/);
  assert.match(prompt, /Diagnose before editing/);
  assert.match(prompt, /three ranked hypotheses/);
  assert.match(prompt, /one variable at a time/);
  assert.match(prompt, /goes red on this exact symptom/);
});
