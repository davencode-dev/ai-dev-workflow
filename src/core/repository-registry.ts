import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RepositoryConfig } from './types.ts';

export async function loadRegistry(root: string): Promise<RepositoryConfig[]> {
  const config = JSON.parse(await readFile(resolve(root, 'config/repositories.json'), 'utf8')) as { repositories: RepositoryConfig[] };
  return config.repositories;
}

export function selectRepository(registry: RepositoryConfig[], id: string): RepositoryConfig {
  const repository = registry.find((entry) => entry.id === id);
  if (!repository) throw new Error(`Unknown application: ${id}`);
  return repository;
}
