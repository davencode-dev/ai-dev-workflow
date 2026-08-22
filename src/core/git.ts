import { runProcess } from './process.ts';

export class Git {
  async status(path: string) { const r = await runProcess('git', ['status', '--porcelain'], path); return r.output.trim(); }
  async changedFiles(path: string) {
    const r = await runProcess('git', ['status', '--porcelain'], path);
    return r.output.trim() ? r.output.trim().split('\n').map((line) => line.slice(2).trimStart().replace(/^.* -> /, '')) : [];
  }
  async commit(path: string, message: string) {
    let result = await runProcess('git', ['add', '-A'], path); if (result.exitCode) throw new Error(result.output);
    result = await runProcess('git', ['commit', '-m', message], path); if (result.exitCode) throw new Error(result.output);
    const hash = await runProcess('git', ['rev-parse', 'HEAD'], path); return { hash: hash.output.trim(), message };
  }
  async commitFiles(path: string, files: string[], message: string) {
    if (!files.length) throw new Error('No task-document files changed');
    let result = await runProcess('git', ['add', '--', ...files], path); if (result.exitCode) throw new Error(result.output);
    result = await runProcess('git', ['commit', '-m', message], path); if (result.exitCode) throw new Error(result.output);
    const hash = await runProcess('git', ['rev-parse', 'HEAD'], path); return { hash: hash.output.trim(), message };
  }
  async discardChanges(path: string) {
    await runProcess('git', ['reset', '--hard', 'HEAD'], path);
    await runProcess('git', ['clean', '-fd'], path);
  }
}
