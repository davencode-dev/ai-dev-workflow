import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { runProcess } from './process.ts';
import { selectRepository } from './repository-registry.ts';
import type { RepositoryConfig } from './types.ts';
import type {
  EmulatorRole,
  MaestroConfig,
  MobileCheck,
  MobileCommand,
  MobileCommandResult,
  MobileFlowResult,
  MobileVerificationManifest,
  MobileVerificationReport,
  MobileVerificationStatus,
} from './mobile-types.ts';

export type MobileVerificationOptions = {
  root: string;
  registry: RepositoryConfig[];
  application: string;
  manifestPath?: string;
  dryRun?: boolean;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function stringArray(value: unknown, label: string, required = false): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value as string[];
}

function command(value: unknown, label: string): MobileCommand {
  const raw = object(value, label);
  const args = raw.args === undefined ? [] : stringArray(raw.args, `${label}.args`, true);
  const cwd = optionalString(raw.cwd, `${label}.cwd`);
  const timeoutMs = raw.timeoutMs === undefined ? undefined : Number(raw.timeoutMs);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`${label}.timeoutMs must be a positive integer`);
  }
  return { command: string(raw.command, `${label}.command`), args, cwd, timeoutMs };
}

function role(value: unknown, label: string): EmulatorRole {
  const raw = object(value, label);
  const avd = optionalString(raw.avd, `${label}.avd`);
  const serial = optionalString(raw.serial, `${label}.serial`);
  if (!avd && !serial) throw new Error(`${label} must define avd or serial`);
  const port = raw.port === undefined ? undefined : Number(raw.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error(`${label}.port must be a valid TCP port`);
  }
  return {
    avd,
    serial,
    port,
    required: raw.required === undefined ? true : Boolean(raw.required),
    start: raw.start === undefined ? false : Boolean(raw.start),
  };
}

function check(value: unknown, index: number): MobileCheck {
  const raw = object(value, `checks[${index}]`);
  return { id: string(raw.id, `checks[${index}].id`), command: command(raw.command, `checks[${index}].command`) };
}

function maestro(value: unknown): MaestroConfig {
  const raw = object(value, 'maestro');
  const roots = stringArray(raw.roots, 'maestro.roots', true);
  if (!roots.length) throw new Error('maestro.roots must not be empty');
  return {
    command: command(raw.command, 'maestro.command'),
    deviceFlag: optionalString(raw.deviceFlag, 'maestro.deviceFlag') ?? '--device',
    roots,
    include: stringArray(raw.include, 'maestro.include'),
    exclude: stringArray(raw.exclude, 'maestro.exclude'),
    testOutputDir: optionalString(raw.testOutputDir, 'maestro.testOutputDir'),
  };
}

function validateManualWorkflows(value: unknown): MobileVerificationManifest['manualWorkflows'] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('manualWorkflows must be an array');
  return value.map((entry, index) => {
    const raw = object(entry, `manualWorkflows[${index}]`);
    return {
      id: string(raw.id, `manualWorkflows[${index}].id`),
      title: string(raw.title, `manualWorkflows[${index}].title`),
      reason: string(raw.reason, `manualWorkflows[${index}].reason`),
      documentation: optionalString(raw.documentation, `manualWorkflows[${index}].documentation`),
    };
  });
}

export function parseMobileManifest(value: unknown): MobileVerificationManifest {
  const raw = object(value, 'manifest');
  if (raw.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (raw.platform !== 'android') throw new Error('platform must be android');
  const devices = object(raw.devices, 'devices');
  const documentation = object(raw.documentation, 'documentation');
  const checks = raw.checks;
  if (!Array.isArray(checks) || !checks.length) throw new Error('checks must be a non-empty array');
  const bootTimeoutMs = devices.bootTimeoutMs === undefined ? 120000 : Number(devices.bootTimeoutMs);
  if (!Number.isInteger(bootTimeoutMs) || bootTimeoutMs <= 0) throw new Error('devices.bootTimeoutMs must be positive');
  const isolation = devices.isolation === undefined ? 'dedicated' : devices.isolation;
  if (isolation !== 'dedicated' && isolation !== 'reuse') throw new Error('devices.isolation must be dedicated or reuse');
  return {
    schemaVersion: 1,
    platform: 'android',
    appId: string(raw.appId, 'appId'),
    launchActivity: optionalString(raw.launchActivity, 'launchActivity'),
    checks: checks.map(check),
    build: { ...command(raw.build, 'build'), artifact: string(object(raw.build, 'build').artifact, 'build.artifact') },
    devices: {
      primary: role(devices.primary, 'devices.primary'),
      secondary: devices.secondary === undefined ? undefined : role(devices.secondary, 'devices.secondary'),
      bootTimeoutMs,
      isolation,
    },
    maestro: maestro(raw.maestro),
    manualWorkflows: validateManualWorkflows(raw.manualWorkflows),
    documentation: {
      inventory: string(documentation.inventory, 'documentation.inventory'),
      verification: string(documentation.verification, 'documentation.verification'),
      evidenceDir: string(documentation.evidenceDir, 'documentation.evidenceDir'),
    },
  };
}

function targetPath(targetRoot: string, value: string): string {
  const root = resolve(targetRoot);
  const resolved = resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`Path escapes repository: ${value}`);
  return resolved;
}

export async function loadMobileManifest(targetRoot: string, manifestRelativePath = '.ai-dev-workflow/mobile-verification.json') {
  const path = targetPath(targetRoot, manifestRelativePath);
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return { path, manifest: parseMobileManifest(parsed) };
}

function globRegex(pattern: string): RegExp {
  let source = '';
  const normalized = pattern.replaceAll('\\', '/');
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function discoverMaestroFlows(targetRoot: string, config: MaestroConfig): Promise<string[]> {
  const include = (config.include?.length ? config.include : ['**/*.yaml']).map(globRegex);
  const exclude = (config.exclude ?? []).map(globRegex);
  const discovered = new Set<string>();
  for (const root of config.roots) {
    const absoluteRoot = targetPath(targetRoot, root);
    const files = await filesUnder(absoluteRoot);
    for (const file of files) {
      const relativePath = relative(targetRoot, file).replaceAll('\\', '/');
      const localPath = relative(absoluteRoot, file).replaceAll('\\', '/');
      if (!include.some((pattern) => pattern.test(localPath) || pattern.test(relativePath))) continue;
      if (exclude.some((pattern) => pattern.test(localPath) || pattern.test(relativePath))) continue;
      discovered.add(relativePath);
    }
  }
  return [...discovered].sort();
}

function displayCommand(spec: MobileCommand, extraArgs: string[] = []): string {
  return [spec.command, ...(spec.args ?? []), ...extraArgs].join(' ');
}

function dryResult(spec: MobileCommand, extraArgs: string[] = []): MobileCommandResult {
  return { command: displayCommand(spec, extraArgs), exitCode: 0, output: 'would run', status: 'DRY_RUN' };
}

function commandCwd(spec: MobileCommand, cwd: string): string {
  return spec.cwd ? targetPath(cwd, spec.cwd) : cwd;
}

async function runCommand(spec: MobileCommand, cwd: string, extraArgs: string[] = []): Promise<MobileCommandResult> {
  const result = await runProcess(spec.command, [...(spec.args ?? []), ...extraArgs], commandCwd(spec, cwd), spec.timeoutMs);
  return { ...result, command: displayCommand(spec, extraArgs), status: result.exitCode === 0 ? 'PASS' : 'FAIL' };
}

async function commandAvailable(command: string, cwd: string): Promise<boolean> {
  const result = await runProcess('which', [command], cwd);
  return result.exitCode === 0;
}

function serialFor(role: EmulatorRole): string | undefined {
  return role.serial ?? (role.port ? `emulator-${role.port}` : undefined);
}

async function waitForBoot(serial: string, cwd: string, timeoutMs: number): Promise<MobileCommandResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await runProcess('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], cwd);
    if (state.exitCode === 0 && state.output.trim() === '1') {
      return { command: `adb -s ${serial} shell getprop sys.boot_completed`, exitCode: 0, output: state.output, status: 'PASS' };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  return { command: `adb -s ${serial} shell getprop sys.boot_completed`, exitCode: 124, output: `Timed out waiting for ${serial}`, status: 'BLOCKED' };
}

async function ensureDevice(role: EmulatorRole, cwd: string, timeoutMs: number): Promise<{ serial?: string; result: MobileCommandResult }> {
  let serial = serialFor(role);
  if (!serial && role.start && role.avd) {
    serial = `emulator-${role.port ?? 5554}`;
    const child = spawn('emulator', ['-avd', role.avd, '-port', String(role.port ?? 5554), '-no-boot-anim', '-no-snapshot-load'], {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
  if (!serial) return { result: { command: 'adb devices', exitCode: 2, output: 'Device role requires serial or a startable AVD', status: 'BLOCKED' } };
  if (role.start && role.avd && !role.serial) {
    return { serial, result: await waitForBoot(serial, cwd, timeoutMs) };
  }
  const state = await runProcess('adb', ['-s', serial, 'get-state'], cwd);
  return {
    serial,
    result: {
      command: `adb -s ${serial} get-state`,
      exitCode: state.exitCode,
      output: state.output,
      status: state.exitCode === 0 && state.output.trim() === 'device' ? 'PASS' : 'BLOCKED',
    },
  };
}

async function installAndLaunch(targetRoot: string, manifest: MobileVerificationManifest, serial: string, artifact: string): Promise<MobileCommandResult[]> {
  const install = await runCommand({ command: 'adb', args: ['-s', serial, 'install', '-r'] }, targetRoot, [artifact]);
  if (install.exitCode) return [install];
  const launchArgs = manifest.launchActivity
    ? ['-s', serial, 'shell', 'am', 'start', '-n', `${manifest.appId}/${manifest.launchActivity}`]
    : ['-s', serial, 'shell', 'monkey', '-p', manifest.appId, '1'];
  return [install, await runCommand({ command: 'adb', args: launchArgs }, targetRoot)];
}

async function runFlow(targetRoot: string, config: MaestroConfig, serial: string, flow: string, outputRoot: string): Promise<MobileFlowResult> {
  const extraArgs = [config.deviceFlag ?? '--device', serial];
  if (config.testOutputDir) extraArgs.push('--test-output-dir', targetPath(targetRoot, config.testOutputDir));
  const result = await runCommand(config.command, targetRoot, [...extraArgs, flow]);
  return { flow, status: result.status, command: result.command, output: result.output };
}

function finalStatus(report: Omit<MobileVerificationReport, 'status'>): MobileVerificationStatus {
  if (report.dryRun) return 'DRY_RUN';
  if (report.checks.some((result) => result.status === 'FAIL')) return 'FAIL';
  if (report.build?.status === 'FAIL' || report.build?.status === 'BLOCKED') return report.build.status;
  if (report.devices.some((device) => device.status === 'BLOCKED')) return 'BLOCKED';
  if (report.flows.some((flow) => flow.status === 'FAIL')) return 'FAIL';
  if (report.flows.some((flow) => flow.status === 'BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

export async function runMobileVerification(options: MobileVerificationOptions): Promise<{ report: MobileVerificationReport; reportPath: string }> {
  const repository = selectRepository(options.registry, options.application);
  const { path: manifestPath, manifest } = await loadMobileManifest(repository.path, options.manifestPath);
  const startedAt = new Date().toISOString();
  const report: Omit<MobileVerificationReport, 'status'> = {
    schemaVersion: 1,
    repository: repository.path,
    manifest: manifestPath,
    startedAt,
    dryRun: !!options.dryRun,
    checks: [],
    devices: [],
    flows: [],
    manualWorkflows: (manifest.manualWorkflows ?? []).map((workflow) => ({ flow: workflow.id, status: 'MANUAL_REQUIRED', output: `${workflow.title}: ${workflow.reason}` })),
  };
  if (!options.dryRun) {
    const git = await runProcess('git', ['status', '--porcelain'], repository.path);
    if (git.output.trim()) throw new Error(`Target repository is dirty: ${repository.path}`);
  }
  const requiredTools = new Set(['adb', manifest.maestro.command.command, manifest.build.command, ...manifest.checks.map((checkSpec) => checkSpec.command.command)]);
  if (!options.dryRun) {
    for (const tool of requiredTools) {
      const toolCwd = manifest.build.command === tool && manifest.build.cwd ? targetPath(repository.path, manifest.build.cwd) : repository.path;
      if (!(await commandAvailable(tool, toolCwd))) throw new Error(`Required tool unavailable: ${tool}`);
    }
  }
  for (const checkSpec of manifest.checks) {
    report.checks.push(options.dryRun ? dryResult(checkSpec.command) : await runCommand(checkSpec.command, repository.path));
  }
  const checksPassed = report.checks.every((checkResult) => checkResult.status === 'PASS' || checkResult.status === 'DRY_RUN');
  if (!checksPassed) {
    report.build = { command: displayCommand(manifest.build), exitCode: 125, output: 'Skipped because a static check failed', status: 'BLOCKED' };
  } else {
    report.build = options.dryRun ? dryResult(manifest.build) : await runCommand(manifest.build, repository.path);
    if (!options.dryRun && report.build.status === 'PASS') {
      const artifact = targetPath(repository.path, manifest.build.artifact);
      if (!(await access(artifact, constants.F_OK).then(() => true).catch(() => false))) {
        report.build = { ...report.build, exitCode: 2, output: `Build artifact not found: ${manifest.build.artifact}`, status: 'FAIL' };
      }
    }
  }
  const artifact = targetPath(repository.path, manifest.build.artifact);
  if (options.dryRun) {
    report.devices.push({ role: 'primary', serial: serialFor(manifest.devices.primary), status: 'DRY_RUN' });
    if (manifest.devices.secondary) report.devices.push({ role: 'secondary', serial: serialFor(manifest.devices.secondary), status: 'DRY_RUN' });
    report.flows = (await discoverMaestroFlows(repository.path, manifest.maestro)).map((flow) => ({ flow, status: 'DRY_RUN' }));
  } else if (report.build.status === 'PASS') {
    const roles: Array<[string, EmulatorRole | undefined]> = [['primary', manifest.devices.primary], ['secondary', manifest.devices.secondary]];
    const readyDevices: Array<{ role: string; serial: string }> = [];
    for (const [name, roleConfig] of roles) {
      if (!roleConfig) continue;
      const device = await ensureDevice(roleConfig, repository.path, manifest.devices.bootTimeoutMs ?? 120000);
      report.devices.push({ role: name, serial: device.serial, status: device.result.status, reason: device.result.status === 'BLOCKED' ? device.result.output : undefined });
      if (device.serial && device.result.status === 'PASS') readyDevices.push({ role: name, serial: device.serial });
      else if (roleConfig.required !== false) break;
    }
    if (readyDevices.some((device) => device.role === 'primary')) {
      for (const device of readyDevices) {
        const installation = await installAndLaunch(repository.path, manifest, device.serial, artifact);
        if (device.role === 'primary' && installation.some((result) => result.status !== 'PASS')) {
          report.devices.find((entry) => entry.role === device.role)!.status = 'BLOCKED';
          continue;
        }
      }
      const primary = readyDevices.find((device) => device.role === 'primary');
      if (primary) {
        const flows = await discoverMaestroFlows(repository.path, manifest.maestro);
        const outputRoot = manifest.maestro.testOutputDir ? targetPath(repository.path, manifest.maestro.testOutputDir) : join(options.root, '.agent-runs', 'mobile-test-output');
        await mkdir(outputRoot, { recursive: true });
        for (const flow of flows) report.flows.push(await runFlow(repository.path, manifest.maestro, primary.serial, flow, outputRoot));
      }
    }
  }
  report.endedAt = new Date().toISOString();
  const complete: MobileVerificationReport = { ...report, status: finalStatus(report) };
  const reportDir = join(options.root, '.agent-runs');
  await mkdir(reportDir, { recursive: true });
  const filename = `mobile-verify-${startedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
  const reportPath = join(reportDir, filename);
  complete.reportPath = reportPath;
  await writeFile(reportPath, `${JSON.stringify(complete, null, 2)}\n`);
  return { report: complete, reportPath };
}
