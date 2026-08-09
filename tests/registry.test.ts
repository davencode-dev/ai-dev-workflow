import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProvider } from '../src/providers/registry.ts';
import { codexProposalArgs } from '../src/providers/codex-provider.ts';

test('aliases resolve to providers with canonical ids', () => {
  assert.equal(selectProvider('codex').id, 'codex');
  assert.equal(selectProvider('claude-code').id, 'claude-code');
  assert.equal(selectProvider('claude').id, 'claude-code');
  assert.equal(selectProvider('antigravity').id, 'antigravity');
  assert.equal(selectProvider('agy').id, 'antigravity');
});

test('unknown provider lists available names', () => {
  assert.throws(() => selectProvider('gpt'), /Unknown provider: gpt.*claude-code.*antigravity/s);
});

test('Codex proposal arguments terminate variadic image values before prompt', () => {
  const args = codexProposalArgs('/repo', '/schema.json', '/output.json', ['/one.jpg', '/two.jpg'], 'Create one task');
  assert.deepEqual(args.slice(-2), ['--', 'Create one task']);
  assert.deepEqual(args.slice(-6, -2), ['--image', '/one.jpg', '--image', '/two.jpg']);
});
