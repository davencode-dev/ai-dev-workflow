import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RepositoryConfig } from './types.ts';

export async function loadRegistry(root: string): Promise<RepositoryConfig[]> {
  const config = JSON.parse(await readFile(resolve(root, 'config/repositories.json'), 'utf8')) as { headroom?: RepositoryConfig['headroom']; repositories: RepositoryConfig[] };
  // A top-level headroom block applies to every application, so a new entry cannot silently bypass the proxy.
  return config.repositories.map((repository) => (config.headroom && !repository.headroom ? { ...repository, headroom: config.headroom } : repository));
}

export function selectRepository(registry: RepositoryConfig[], id: string): RepositoryConfig {
  const repository = registry.find((entry) => entry.id === id);
  if (!repository) throw new Error(`Unknown application: ${id}`);
  return repository;
}
