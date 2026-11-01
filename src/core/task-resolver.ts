import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { RepositoryConfig, ResolvedTask } from './types.ts';

const exists = async (path: string) => access(path, constants.F_OK).then(() => true).catch(() => false);

export async function resolveTasks(repository: RepositoryConfig, ids: string[]): Promise<ResolvedTask[]> {
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate task identifiers are not allowed');
  const matcher = new RegExp(`^${repository.taskPrefix}-\\d{3}$`);
  for (const id of ids) if (!matcher.test(id)) throw new Error(`Task does not match ${repository.id} prefix: ${id}`);
  if (!(await exists(join(repository.path, '.git')))) throw new Error(`Target repository unavailable: ${repository.path}`);
  return Promise.all(ids.map((id) => resolveTask(repository, id)));
}

async function resolveTask(repository: RepositoryConfig, id: string): Promise<ResolvedTask> {
  const resolver = repository.taskResolver;
  if (resolver.kind === 'heading') {
    const document = join(repository.path, resolver.path);
    const content = await readFile(document, 'utf8');
    const heading = resolver.heading!.replace('{id}', id);
    const matches = [...content.matchAll(new RegExp(`^${escapeRegex(heading)}(?:[ —-]|$)`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Task resolution is missing or ambiguous: ${id}`);
    const start = matches[0].index!;
    const end = content.slice(start + 1).search(/^### /m);
    const section = end < 0 ? content.slice(start) : content.slice(start, start + 1 + end);
    return task(id, document, section, content.slice(0, start).split('\n').length);
  }
  const directory = join(repository.path, resolver.path);
  const prefix = `${id}-`;
  const names = (await readdir(directory)).filter((name) => name.startsWith(prefix) && name.endsWith('.md'));
  if (names.length !== 1) throw new Error(`Task resolution is missing or ambiguous: ${id}`);
  const document = join(directory, names[0]);
  return task(id, document, await readFile(document, 'utf8'), 1);
}

// An explicit `- Documentation only: yes|no` line decides. Documents without it fall back to the legacy
// phrase heuristic so task documents written before the marker keep their commit type.
const marker = /^\s*[-*]\s*Documentation only:\s*(yes|no|true|false)\s*$/im;
const legacyPhrase = /(?:documentation|documentaci[oó]n|planning|planificaci[oó]n)[\s\S]{0,100}(?:only|primero|first)|no application code changes/i;

export function isDocumentationOnly(content: string): boolean {
  const explicit = content.match(marker);
  if (explicit) return /^(yes|true)$/i.test(explicit[1]);
  return legacyPhrase.test(content);
}

function task(id: string, document: string, content: string, line: number): ResolvedTask {
  return { id, document, content, line, documentationOnly: isDocumentationOnly(content) };
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
