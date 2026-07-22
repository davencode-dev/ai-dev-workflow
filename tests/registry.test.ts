import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProvider } from '../src/providers/registry.ts';

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
