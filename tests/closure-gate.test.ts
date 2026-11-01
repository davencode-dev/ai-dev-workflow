import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAndroidBuild } from '../src/core/validation.ts';
import type { RepositoryConfig } from '../src/core/types.ts';

async function repository(scripts: Record<string, string>, androidBuild?: string): Promise<RepositoryConfig> {
  const path = await mkdtemp(join(tmpdir(), 'closure-gate-'));
  execFileSync('git', ['init', '-q'], { cwd: path });
  await writeFile(join(path, 'package.json'), `${JSON.stringify({ name: 'target', scripts })}\n`);
  return { id: 'target', path, taskPrefix: 'T', taskResolver: { kind: 'file', path: 'docs/tasks', pattern: '{id}-*.md' }, validation: [], androidBuild, guidance: [], pilotEvidence: 'docs/tasks/index.md', taskTracking: 'docs/tasks/index.md' };
}

test('closure gate runs the configured npm script, not a hardcoded one', async () => {
  const config = await repository({ gate: 'node --version' }, 'npm run gate');
  const result = await runAndroidBuild(config);
  assert.equal(result?.command, 'npm run gate');
  assert.equal(result?.exitCode, 0);
});

test('closure gate configured but unrunnable fails the task instead of being skipped', async () => {
  const config = await repository({ test: 'true' }, 'npm run gate');
  const result = await runAndroidBuild(config);
  assert.notEqual(result, undefined);
  assert.notEqual(result?.exitCode, 0);
  assert.match(result!.output, /no gate script/);
});

test('closure gate accepts a command that is not an npm script', async () => {
  const config = await repository({}, 'node -e process.exit(0)');
  assert.equal((await runAndroidBuild(config))?.exitCode, 0);
  const failing = await repository({}, 'node -e process.exit(3)');
  assert.equal((await runAndroidBuild(failing))?.exitCode, 3);
});

test('no configured closure gate stays undefined', async () => {
  assert.equal(await runAndroidBuild(await repository({ test: 'true' })), undefined);
});
