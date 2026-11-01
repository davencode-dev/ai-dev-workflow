import { spawn } from 'node:child_process';

export type ProcessResult = { exitCode: number; output: string; timedOut?: boolean };

const killGraceMs = 5000;

export async function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    let forceKill: NodeJS.Timeout | undefined;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs) : undefined;
    const settle = (result: ProcessResult) => { clearTimeout(timer); clearTimeout(forceKill); resolve(result); };
    child.on('close', (code) => {
      if (timedOut) settle({ exitCode: 124, output: `${output}\nTimed out after ${timeoutMs}ms: ${[command, ...args].join(' ')}\n`, timedOut });
      else settle({ exitCode: code ?? 1, output });
    });
    child.on('error', (error) => settle({ exitCode: 127, output: `${error.message}\n` }));
  });
}

// Splits a configured command line into argv without a shell: whitespace separates, single and double
// quotes group, backslash escapes the next character outside single quotes. There is no shell, so operators
// such as `&&` or `|` arrive as literal arguments.
export function splitCommand(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && index + 1 < line.length) current += line[++index];
      else current += char;
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (char === '\\' && index + 1 < line.length) { current += line[++index]; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += char; started = true; }
  }
  if (quote) throw new Error(`Unterminated quote in command: ${line}`);
  if (started) args.push(current);
  if (!args.length) throw new Error('Command is empty');
  return args;
}
