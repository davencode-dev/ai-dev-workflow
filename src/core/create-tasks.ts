import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { Git } from './git.ts';
import { runProcess } from './process.ts';
import { selectRepository } from './repository-registry.ts';
import type { CreateTasksReport, ImageEvidence, ProposedTask, RepositoryConfig, TaskProposal } from './types.ts';
import { sessionEnv, type TaskProposalProvider } from '../providers/agent-provider.ts';
import { assertHeadroomReady, finishHeadroomSession, headroomProxyUrl, startHeadroomSession } from './headroom.ts';

const formats = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export type CreateOptions = { root: string; provider: TaskProposalProvider; registry: RepositoryConfig[]; application: string; description: string; imagePaths: string[]; dryRun?: boolean; singleTask?: boolean; persistImages?: boolean; proposalReportPath?: string };

export async function validateImages(paths: string[]): Promise<ImageEvidence[]> {
  const result: ImageEvidence[] = [];
  for (const path of paths) {
    const format = extname(path).toLowerCase();
    if (!formats.has(format)) throw new Error(`Unsupported image format: ${path}. Supported: PNG, JPG, JPEG, WEBP`);
    await access(path, constants.R_OK).catch(() => { throw new Error(`Image is missing or unreadable: ${path}`); });
    const info = await stat(path); if (!info.isFile()) throw new Error(`Image is not a file: ${path}`);
    result.push({ path: resolve(path), filename: basename(path), bytes: info.size, format: format.slice(1) });
  }
  return result;
}

export async function createTasks(options: CreateOptions): Promise<{ report: CreateTasksReport; reportPath: string }> {
  if (!options.description.trim()) throw new Error('Description is required');
  if (options.description.trim().length < 12) throw new Error('Description is too brief to scope safely');
  const repository = selectRepository(options.registry, options.application); const images = await validateImages(options.imagePaths);
  const git = new Git(); const workflowState = await git.status(options.root); const targetState = await git.status(repository.path);
  if (workflowState) throw new Error('ai-dev-workflow is dirty; commit or stash it before task creation');
  if (targetState) throw new Error(`Target repository is dirty: ${repository.path}`);
  const existing = await existingText(repository); const duplicates = findDuplicates(options.description, existing);
  const report: CreateTasksReport = { provider: options.provider.id, repository: repository.path, description: options.description, images, proposed: [], created: [], duplicates, filesChanged: [], trackingFile: join(repository.path, repository.taskTracking), dryRun: !!options.dryRun, startedAt: new Date().toISOString(), warnings: [], runCommand: '' };
  if (duplicates.length) { report.warnings.push(`Possible duplicate task evidence: ${duplicates.join(', ')}`); report.endedAt = new Date().toISOString(); return { report, reportPath: await writeCreateReport(options.root, report) }; }
  let proposal: TaskProposal;
  if (options.proposalReportPath) proposal = await replayProposal(options, repository, images);
  else {
    const available = await options.provider.available(); if (!available.ok) throw new Error(`Provider ${options.provider.id} unavailable: ${available.reason ?? 'unknown error'}`);
    sessionEnv(options.provider, headroomProxyUrl(repository)); await assertHeadroomReady(repository);
    const schemaPath = await schema(options.root);
    const session = await startHeadroomSession(repository);
    const response = await options.provider.propose({ repository, images, schemaPath, prompt: proposalPrompt(repository, options.description, images, options.singleTask), env: sessionEnv(options.provider, session?.proxyUrl) });
    if (session) { const { evidence, bypassed } = await finishHeadroomSession(repository, session); report.headroom = evidence; if (bypassed) throw new Error(bypassed); }
    if (response.status !== 'success') throw new Error(`Provider task proposal failed: ${response.output}`);
    proposal = validateProposal(parseJson(response.output));
  }
  const proposedTasks = proposal.tasks.map((task) => ({ ...task, title: withoutProviderId(task.title, repository.taskPrefix) })); report.proposed = proposedTasks; report.warnings.push(...(proposal.warnings ?? []));
  if (options.singleTask && proposal.tasks.length !== 1) throw new Error('--single-task cannot safely scope this report as one task');
  const ids = allocate(repository.taskPrefix, existing, proposal.tasks.length); report.created = ids;
  report.runCommand = `npm run tasks -- --agent ${options.provider.id} ${repository.id} ${ids.join(' ')}`;
  const documentImages = options.persistImages ? images.map((image) => ({ ...image, path: join(repository.taskEvidenceDir!, imageName(image)) })) : [];
  const planned = await files(repository, ids, proposedTasks, documentImages); report.filesChanged = planned.map((entry) => entry.path);
  if (!options.dryRun) {
    for (const entry of planned) { await mkdir(join(entry.path, '..'), { recursive: true }); await writeFile(entry.path, entry.content); }
    if (options.persistImages && images.length) await persist(repository, images, report.filesChanged);
    const changed = await git.changedFiles(repository.path); if (changed.some((file) => !allowed(file, repository))) throw new Error(`Application-code modification blocked: ${changed.join(', ')}`);
    const commit = await git.commitFiles(repository.path, changed, 'docs(tasks): add tasks from reported UI issues'); report.commit = commit;
    if (await git.status(repository.path)) throw new Error('Target repository not clean after task-document commit');
  }
  report.endedAt = new Date().toISOString(); return { report, reportPath: await writeCreateReport(options.root, report) };
}

async function replayProposal(options: CreateOptions, repository: RepositoryConfig, images: ImageEvidence[]): Promise<TaskProposal> {
  const reportsRoot = resolve(options.root, '.agent-runs'); const reportPath = resolve(options.proposalReportPath!); const reportRelative = relative(reportsRoot, reportPath);
  if (!reportRelative || reportRelative.startsWith('..')) throw new Error('Proposal report must be a file inside .agent-runs');
  const prior = JSON.parse(await readFile(reportPath, 'utf8')) as CreateTasksReport;
  if (!prior.dryRun || prior.repository !== repository.path || prior.provider !== options.provider.id || prior.description !== options.description) throw new Error('Proposal report does not match this dry-run request');
  const imageSignature = (items: ImageEvidence[]) => JSON.stringify(items.map(({ path, bytes, format }) => ({ path, bytes, format })));
  if (imageSignature(prior.images) !== imageSignature(images)) throw new Error('Proposal report images do not match this request');
  return validateProposal({ tasks: prior.proposed });
}

async function existingText(repository: RepositoryConfig): Promise<string[]> { const root = join(repository.path, repository.taskResolver.path); return allMarkdown(root); }
async function allMarkdown(path: string): Promise<string[]> { try { const s = await stat(path); if (s.isFile()) return path.endsWith('.md') ? [await readFile(path, 'utf8')] : []; const names = await readdir(path, { withFileTypes: true }); return (await Promise.all(names.map((n) => allMarkdown(join(path, n.name))))).flat(); } catch { return []; } }
const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'of', 'with', 'by', 'from', 'this', 'that', 'it', 'as', 'are', 'was', 'be', 'has', 'have', 'had', 'not', 'but']);

function stem(word: string): string {
  return word.replace(/ies$/, 'y').replace(/(?:ing|ed|ly|es|s)$/, '').replace(/tion$/, 't');
}

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((word) => word.length >= 3 && !stopWords.has(word)).map(stem);
}

function normalize(value: string) {
  return tokenize(value).join(' ');
}

function stringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  const getBigrams = (str: string) => {
    const set = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
  };
  const b1 = getBigrams(str1); const b2 = getBigrams(str2);
  if (!b1.size || !b2.size) return 0;
  let intersection = 0;
  for (const bg of b1) { if (b2.has(bg)) intersection++; }
  return (2 * intersection) / (b1.size + b2.size);
}

function findDuplicates(description: string, existing: string[]): string[] {
  const descTokens = tokenize(description);
  if (!descTokens.length) return [];
  const descKey = normalize(description);
  const matchedIds: string[] = [];

  for (const text of existing) {
    if (!text.trim()) continue;
    const idMatch = text.match(/[A-Z][A-Z0-9_-]*-\d{3}/)?.[0] ?? 'existing task';
    const textKey = normalize(text);
    const textTokens = tokenize(text);
    if (!textTokens.length) continue;

    // Substring / prefix matching
    const normalizedPrefix = textKey.slice(0, 180);
    if (descKey && (textKey.includes(descKey) || (!!normalizedPrefix && descKey.includes(normalizedPrefix)))) {
      matchedIds.push(idMatch);
      continue;
    }

    // Token set overlap & Jaccard similarity
    const intersection = descTokens.filter((t) => textTokens.includes(t));
    const union = new Set([...descTokens, ...textTokens]);
    const jaccard = union.size ? intersection.length / union.size : 0;
    const descOverlap = descTokens.length ? intersection.length / descTokens.length : 0;
    const dice = stringSimilarity(descKey, textKey.slice(0, 300));

    if (jaccard >= 0.35 || descOverlap >= 0.6 || dice >= 0.5 || (intersection.length >= 3 && descOverlap >= 0.4)) {
      matchedIds.push(idMatch);
    }
  }
  return [...new Set(matchedIds)].slice(0, 3);
}
function allocate(prefix: string, texts: string[], count: number) { const ids = [...texts.join('\n').matchAll(new RegExp(`${prefix}-(\\d{3})`, 'g'))].map((m) => Number(m[1])); const start = Math.max(0, ...ids) + 1; return Array.from({ length: count }, (_, i) => `${prefix}-${String(start + i).padStart(3, '0')}`); }
async function files(repository: RepositoryConfig, ids: string[], tasks: ProposedTask[], images: ImageEvidence[]) { const tracker = join(repository.path, repository.taskTracking); const evidence = (document: string) => images.map((image) => `- Screenshot: [${image.filename}](./${relative(dirname(document), join(repository.path, image.path))}) (${image.format.toUpperCase()}, ${image.bytes} bytes)`).join('\n'); if (repository.taskResolver.kind === 'heading') { const current = await readFile(tracker, 'utf8'); const prefix = repository.taskResolver.heading ? repository.taskResolver.heading.replace('{id}', '') : '### '; const additions = tasks.map((task, i) => markdown(ids[i], task, evidence(tracker), prefix)).join('\n'); return [{ path: tracker, content: `${current.trimEnd()}\n\n${additions}` }]; }
  const directory = join(repository.path, repository.taskResolver.path); const docs = tasks.map((task, i) => { const path = join(directory, `${ids[i]}-${slug(task.title)}.md`); return { path, content: markdown(ids[i], task, evidence(path), '# ') }; }); const currentTracker = await readFile(tracker, 'utf8'); return [...docs, { path: tracker, content: index(currentTracker, ids, tasks) }]; }
function markdown(id: string, task: ProposedTask, evidence: string, prefix = '# ') { return `${prefix.trim()} ${id} — ${task.title}\n\n- Status: ready\n- Type: ${task.type}\n- Documentation only: no\n- Estimated size: ${task.size}\n\n## Problem\n\n${task.problem}\n\n## User impact\n\n${task.impact}\n\n## Observable evidence\n\n${evidence || '- Report: visual evidence was supplied but not persisted.'}\n${list(task.evidence)}\n\n## Reproduction\n${list(task.reproduction)}\n\n## Scope\n${list(task.scope)}\n\n## Out of scope\n${list(task.outOfScope)}\n\n## Likely repository areas\n${list(task.codeAreas)}\n\n## Hypotheses to verify\n${list(task.hypotheses)}\n\n## Acceptance criteria\n${list(task.acceptance)}\n\n## Validation\n${list(task.validation)}\n\n## Platform considerations\n${list(task.platforms)}\n\n## Risks and blockers\n${list(task.risks)}\n\n## Dependencies\n${list(task.dependencies && Array.isArray(task.dependencies) && task.dependencies.length ? task.dependencies : ['None.'])}\n`; }
function list(items: unknown) { if (!items) return '- Establish during implementation.'; if (typeof items === 'string') return `- ${items}`; if (Array.isArray(items)) return items.map((item) => `- ${item}`).join('\n') || '- Establish during implementation.'; return '- Establish during implementation.'; }
function index(current: string, ids: string[], tasks: ProposedTask[]) { const rows = tasks.map((task, i) => `| [${ids[i]}](./${ids[i]}-${slug(task.title)}.md) | ${task.title} | ${task.size} | Ready |`).join('\n'); return `${current.trimEnd()}\n${rows}\n`; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 72); }
function withoutProviderId(value: string, prefix: string) { return value.replace(new RegExp(`^${prefix}-\\d{3}\\s*(?:—|–|-)\\s*`, 'i'), '').trim(); }
function allowed(file: string, repository: RepositoryConfig) { return file === repository.taskTracking || file.startsWith(`${repository.taskResolver.path}/`) || (!!repository.taskEvidenceDir && file.startsWith(`${repository.taskEvidenceDir}/`)); }
function imageName(image: ImageEvidence) { return `${slug(image.filename.replace(extname(image.filename), ''))}-${image.bytes}${extname(image.filename).toLowerCase()}`; }
async function persist(repository: RepositoryConfig, images: ImageEvidence[], changed: string[]) { const dir = join(repository.path, repository.taskEvidenceDir!); await mkdir(dir, { recursive: true }); for (const image of images) { const destination = join(dir, imageName(image)); try { await access(destination, constants.F_OK); } catch { await copyFile(image.path, destination); changed.push(destination); } } }
async function schema(root: string) {
  const path = join(root, '.agent-runs', 'task-proposal-schema.json');
  await mkdir(join(root, '.agent-runs'), { recursive: true });
  const requiredFields = ['title','type','size','problem','impact','evidence','reproduction','scope','outOfScope','codeAreas','hypotheses','acceptance','validation','platforms','risks','dependencies'];
  const taskProperties = Object.fromEntries(requiredFields.map((field) => [
    field,
    field === 'title' || field === 'type' || field === 'size' || field === 'problem' || field === 'impact'
      ? { type: 'string' }
      : { type: 'array', items: { type: 'string' } },
  ]));
  await writeFile(path, JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: requiredFields,
          properties: taskProperties,
        },
      },
    },
  }, null, 2));
  return path;
}
function parseJson(value: string) {
  const codeBlockMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/);
  const textToParse = codeBlockMatch ? codeBlockMatch[1].trim() : value;
  try { return JSON.parse(textToParse); } catch { const match = textToParse.match(/\{[\s\S]*\}/); if (!match) throw new Error('Provider did not return JSON task proposal'); return JSON.parse(match[0]); }
}
function validateProposal(value: unknown): TaskProposal { if (!value || typeof value !== 'object' || !Array.isArray((value as TaskProposal).tasks) || !(value as TaskProposal).tasks.length) throw new Error('Invalid provider task proposal schema'); const fields: (keyof ProposedTask)[] = ['title','type','size','problem','impact','evidence','reproduction','scope','outOfScope','codeAreas','hypotheses','acceptance','validation','platforms','risks','dependencies']; for (const task of (value as TaskProposal).tasks) for (const field of fields) if (task[field] === undefined) throw new Error(`Invalid provider task proposal: missing ${field}`); return value as TaskProposal; }
function proposalPrompt(repository: RepositoryConfig, description: string, images: ImageEvidence[], single?: boolean) { return `Create only task proposals; do not edit files or implement product work. Target ${repository.id} at ${repository.path}. Description: ${description}. Screenshots: ${images.map((i) => i.path).join(', ') || 'none'}. Inspect repository routes, navigation, state, persistence, localization, design system, guidance, task conventions, and supplied images. Split independently implementable issues; ${single ? 'return exactly one only if safely scoped.' : 'do not create speculative follow-ups.'} Return JSON with tasks. Every task requires title,type,size,problem,impact,evidence,reproduction,scope,outOfScope,codeAreas,hypotheses,acceptance,validation,platforms,risks,dependencies. Evidence facts only; hypotheses marked as such.`; }
async function writeCreateReport(root: string, report: CreateTasksReport) { const dir = join(root, '.agent-runs'); await mkdir(dir, { recursive: true }); const path = join(dir, `create-tasks-${report.startedAt.replace(/[:.]/g, '-')}.json`); await writeFile(path, `${JSON.stringify(report, null, 2)}\n`); return path; }
