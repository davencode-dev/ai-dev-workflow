import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { McpServer, type McpTool } from './protocol.ts';
import { loadRegistry, selectRepository } from '../core/repository-registry.ts';
import { selectProvider } from '../providers/registry.ts';
import { runSequence } from '../core/runner.ts';
import { createTasks } from '../core/create-tasks.ts';
import { runMobileVerification } from '../core/mobile-verification.ts';
import type { RepositoryConfig } from '../core/types.ts';

const ORCHESTRATOR_ROOT = process.cwd();

async function getRegistry(root: string): Promise<RepositoryConfig[]> {
  const primaryPath = resolve(root, 'config/repositories.json');
  const fallbackPath = resolve(root, 'config/repositories.example.json');

  if (existsSync(primaryPath)) {
    return loadRegistry(root);
  }
  if (existsSync(fallbackPath)) {
    const config = JSON.parse(await readFile(fallbackPath, 'utf8')) as { repositories: RepositoryConfig[] };
    return config.repositories;
  }
  return [];
}

export function createWorkflowTools(root: string = ORCHESTRATOR_ROOT): McpTool[] {
  const listRepositoriesTool: McpTool = {
    name: 'list_repositories',
    description: 'List all registered application repositories configured in ai-dev-workflow.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const repositories = await getRegistry(root);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              repositories.map((repo) => ({
                id: repo.id,
                path: repo.path,
                taskPrefix: repo.taskPrefix,
                taskResolver: repo.taskResolver,
                validation: repo.validation,
                androidBuild: repo.androidBuild,
                guidance: repo.guidance,
                taskTracking: repo.taskTracking,
                taskEvidenceDir: repo.taskEvidenceDir,
                pilotEvidence: repo.pilotEvidence,
              })),
              null,
              2
            ),
          },
        ],
      };
    },
  };

  const createTasksTool: McpTool = {
    name: 'create_tasks',
    description: 'Analyze an issue description (and optional screenshots) to create structured, actionable task definitions.',
    inputSchema: {
      type: 'object',
      properties: {
        application: { type: 'string', description: 'Application identifier (e.g. "ai-dev-workflow" or "my-app")' },
        description: { type: 'string', description: 'Short bug report or feature request description' },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional local file paths to screenshots (PNG, JPG, WebP)',
        },
        singleTask: { type: 'boolean', description: 'Enforce generating at most 1 focused task' },
        dryRun: { type: 'boolean', description: 'Propose task definitions without writing files or committing' },
        writeDirectly: { type: 'boolean', description: 'Directly write task definitions without external proposal provider' },
        provider: { type: 'string', description: 'Provider for task proposal ("antigravity", "claude-code", "codex")' },
      },
      required: ['application', 'description'],
    },
    handler: async (args) => {
      const app = String(args.application || '');
      const description = String(args.description || '');
      const images = Array.isArray(args.images) ? (args.images as string[]) : [];
      const singleTask = Boolean(args.singleTask);
      const dryRun = Boolean(args.dryRun);
      const writeDirectly = Boolean(args.writeDirectly);
      const providerName = args.provider ? String(args.provider) : 'antigravity';

      const registry = await getRegistry(root);
      const provider = selectProvider(providerName);

      const result = await createTasks({
        root,
        registry,
        application: app,
        provider,
        description,
        imagePaths: images,
        singleTask,
        dryRun,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };

  const runTasksTool: McpTool = {
    name: 'run_tasks',
    description: 'Execute an ordered sequence of task identifiers against an application with isolated commits, validations, and auto-rollback.',
    inputSchema: {
      type: 'object',
      properties: {
        application: { type: 'string', description: 'Application identifier' },
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task identifiers in execution order (e.g. ["APP-001", "APP-002"])',
        },
        provider: { type: 'string', description: 'Coding agent provider ("antigravity", "claude-code", "codex")' },
        dryRun: { type: 'boolean', description: 'Inspect resolved tasks and planned validations without executing' },
        retries: { type: 'number', description: 'Number of reflection retry attempts on validation failure (default 0)' },
        rollbackOnFailure: { type: 'boolean', description: 'Discard uncommitted changes on permanent failure' },
      },
      required: ['application', 'tasks'],
    },
    handler: async (args) => {
      const app = String(args.application || '');
      const taskIds = Array.isArray(args.tasks) ? (args.tasks as string[]) : [];
      const providerName = args.provider ? String(args.provider) : 'antigravity';
      const dryRun = Boolean(args.dryRun);
      const retries = typeof args.retries === 'number' ? args.retries : 0;
      const rollbackOnFailure = Boolean(args.rollbackOnFailure);

      const registry = await getRegistry(root);
      const provider = selectProvider(providerName);

      const result = await runSequence({
        root,
        registry,
        application: app,
        taskIds,
        provider,
        dryRun,
        retries,
        rollbackOnFailure,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };

  const verifyMobileTool: McpTool = {
    name: 'verify_mobile',
    description: 'Run the declarative mobile verification suite (manifest check, static analysis, Android build gate, and Maestro E2E flows).',
    inputSchema: {
      type: 'object',
      properties: {
        application: { type: 'string', description: 'Application identifier' },
        dryRun: { type: 'boolean', description: 'Print planned verification steps without running commands' },
        flows: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional subset of Maestro flow names to run',
        },
        skipBuild: { type: 'boolean', description: 'Skip local Android build gate' },
        skipFlows: { type: 'boolean', description: 'Skip Maestro flows' },
      },
      required: ['application'],
    },
    handler: async (args) => {
      const app = String(args.application || '');
      const dryRun = Boolean(args.dryRun);
      const manifestPath = args.manifestPath ? String(args.manifestPath) : undefined;

      const registry = await getRegistry(root);

      const result = await runMobileVerification({
        root,
        registry,
        application: app,
        manifestPath,
        dryRun,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };

  const getLatestReportsTool: McpTool = {
    name: 'get_latest_reports',
    description: 'Retrieve the most recent task execution run reports from .agent-runs.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of reports to retrieve (default: 5)' },
      },
    },
    handler: async (args) => {
      const limit = typeof args.limit === 'number' ? args.limit : 5;
      const directory = join(root, '.agent-runs');

      if (!existsSync(directory)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ reports: [] }, null, 2) }],
        };
      }

      const files = (await readdir(directory)).filter((f) => f.startsWith('tasks-') && f.endsWith('.json')).sort().reverse().slice(0, limit);

      const reports = await Promise.all(
        files.map(async (file) => {
          try {
            const content = JSON.parse(await readFile(join(directory, file), 'utf8'));
            return { file, ...content };
          } catch {
            return { file, error: 'Could not parse report' };
          }
        })
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ reports }, null, 2),
          },
        ],
      };
    },
  };

  return [listRepositoriesTool, createTasksTool, runTasksTool, verifyMobileTool, getLatestReportsTool];
}

export function startWorkflowServer(root: string = ORCHESTRATOR_ROOT): McpServer {
  const tools = createWorkflowTools(root);
  const server = new McpServer({
    name: 'ai-dev-workflow-mcp',
    version: '1.0.0',
    tools,
  });
  server.startStdio();
  return server;
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkflowServer();
}
