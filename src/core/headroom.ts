import type { RepositoryConfig } from './types.ts';

// Headroom (https://github.com/headroomlabs-ai/headroom) is a local context-compression proxy. When the
// registry configures it, every provider session must reach it: the run refuses to start if the proxy is
// not ready, and an attempt whose session added no request to the proxy's counter is blocked. There is no
// silent fallback to the provider's direct endpoint.

const probeTimeoutMs = 5000;

export type HeadroomSession = { proxyUrl: string; before: number };
export type HeadroomEvidence = { proxyUrl: string; requests: number };

// /p/<name> attributes the session's savings to the application in headroom's per-project stats.
export function headroomProxyUrl(repository: RepositoryConfig): string | undefined {
  if (!repository.headroom) return undefined;
  const base = repository.headroom.url.replace(/\/+$/, '');
  return `${base}/p/${encodeURIComponent(repository.id)}`;
}

async function probe(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(probeTimeoutMs) });
  } catch (error) {
    throw new Error(`Headroom proxy unreachable at ${url}: ${(error as Error).message}. Start it with \`headroom proxy\``);
  }
}

export async function assertHeadroomReady(repository: RepositoryConfig): Promise<void> {
  if (!repository.headroom) return;
  const url = `${repository.headroom.url.replace(/\/+$/, '')}/readyz`;
  const response = await probe(url);
  if (response.status !== 200) throw new Error(`Headroom proxy not ready at ${url}: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
}

export async function headroomRequestCount(repository: RepositoryConfig): Promise<number> {
  const url = `${repository.headroom!.url.replace(/\/+$/, '')}/stats`;
  const response = await probe(url);
  if (response.status !== 200) throw new Error(`Headroom stats unavailable at ${url}: HTTP ${response.status}`);
  // requests.total counts only successful upstream calls; a session whose calls the upstream rejected still
  // went through the proxy, so failed and rate-limited requests count as evidence too.
  const requests = (await response.json() as { requests?: Record<string, unknown> }).requests;
  if (typeof requests?.total !== 'number') throw new Error(`Headroom stats at ${url} carry no requests.total`);
  return ['total', 'failed', 'rate_limited'].reduce((sum, key) => sum + (typeof requests[key] === 'number' ? requests[key] as number : 0), 0);
}

export async function startHeadroomSession(repository: RepositoryConfig): Promise<HeadroomSession | undefined> {
  const proxyUrl = headroomProxyUrl(repository);
  if (!proxyUrl) return undefined;
  return { proxyUrl, before: await headroomRequestCount(repository) };
}

// Evidence that the session went through the proxy, or the reason it did not.
export async function finishHeadroomSession(repository: RepositoryConfig, session: HeadroomSession): Promise<{ evidence: HeadroomEvidence; bypassed?: string }> {
  const requests = (await headroomRequestCount(repository)) - session.before;
  const evidence = { proxyUrl: session.proxyUrl, requests };
  if (requests > 0) return { evidence };
  return { evidence, bypassed: `Provider session sent no request through headroom at ${session.proxyUrl}; refusing to accept work done outside the proxy` };
}
