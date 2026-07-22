import { AntigravityProvider } from './antigravity-provider.ts';
import { ClaudeCodeProvider } from './claude-code-provider.ts';
import { CodexProvider } from './codex-provider.ts';
import type { AgentProvider, TaskProposalProvider } from './agent-provider.ts';

export type Provider = AgentProvider & TaskProposalProvider;
export const providerUsage = '<codex|claude-code|claude|antigravity|agy>';

// Aliases share the instance of their canonical id, so provider.id stays canonical in reports and resume commands.
export function providerMap(): Record<string, Provider> {
  const claude = new ClaudeCodeProvider(); const antigravity = new AntigravityProvider();
  return { codex: new CodexProvider(), 'claude-code': claude, claude, antigravity, agy: antigravity };
}

export function selectProvider(agent: string): Provider {
  const provider = providerMap()[agent];
  if (!provider) throw new Error(`Unknown provider: ${agent}. Available: codex, claude-code (alias claude), antigravity (alias agy)`);
  return provider;
}
