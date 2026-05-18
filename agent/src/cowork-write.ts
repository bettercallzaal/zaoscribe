// Octokit SHA-dance write to songchaindao-dot/cowork-zaodevz/data/actions.json.
// Mirrors cowork-zaodevz/agent/src/actions-store.ts:mutateActions pattern.
// 3x retry on 409/422 conflicts (concurrent edits from the cowork bot).

import { Octokit } from '@octokit/rest';
import { CONFIG } from './config.ts';
import type { ActionsFile, ActionItem, Owner, Priority } from './types.ts';

let cached: Octokit | null = null;
function octokit(): Octokit {
  cached ??= new Octokit({ auth: CONFIG.github.coworkToken });
  return cached;
}

async function fetchActions(): Promise<{ data: ActionsFile; sha: string }> {
  const res = await octokit().repos.getContent({
    owner: CONFIG.github.coworkOwner,
    repo: CONFIG.github.coworkRepo,
    path: CONFIG.github.coworkPath,
    ref: CONFIG.github.coworkBranch,
  });
  if (Array.isArray(res.data) || res.data.type !== 'file') {
    throw new Error(`expected file at ${CONFIG.github.coworkPath}`);
  }
  const content = Buffer.from(res.data.content, 'base64').toString('utf8');
  const data = JSON.parse(content) as ActionsFile;
  return { data, sha: res.data.sha };
}

async function commitActions(data: ActionsFile, sha: string, message: string): Promise<string> {
  data.updatedAt = new Date().toISOString();
  const res = await octokit().repos.createOrUpdateFileContents({
    owner: CONFIG.github.coworkOwner,
    repo: CONFIG.github.coworkRepo,
    path: CONFIG.github.coworkPath,
    branch: CONFIG.github.coworkBranch,
    message,
    sha,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
  });
  const newSha = res.data.content?.sha;
  if (!newSha) throw new Error('commit returned no sha');
  return newSha;
}

function nextItemId(items: ActionItem[]): string {
  const max = items.reduce((m, i) => {
    const n = Number(i.id);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1);
}

export interface CreateItemInput {
  title: string;
  owner: Owner;
  createdBy: string;
  category?: string;
  priority?: Priority;
  notes?: string;
  due?: string;
}

async function mutate<T>(
  mutator: (data: ActionsFile) => Promise<{ data: ActionsFile; commitMessage: string; result: T } | null>,
  maxAttempts = 3,
): Promise<T | null> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data, sha } = await fetchActions();
      const out = await mutator(structuredClone(data));
      if (!out) return null;
      await commitActions(out.data, sha, out.commitMessage);
      return out.result;
    } catch (err) {
      lastErr = err as Error;
      const status = (err as { status?: number }).status;
      if (status !== 409 && status !== 422) throw err;
      const backoffMs = 200 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(`cowork mutation failed after ${maxAttempts} attempts: ${lastErr?.message}`);
}

// Create one item; returns the new ID.
export async function createCoworkItem(input: CreateItemInput): Promise<string | null> {
  return mutate<string>(async (data) => {
    const now = new Date().toISOString();
    const item: ActionItem = {
      id: nextItemId(data.items),
      title: input.title.trim(),
      createdBy: input.createdBy,
      owner: input.owner,
      status: 'TODO',
      category: input.category ?? 'Other',
      priority: input.priority ?? 'P2',
      important: false,
      urgent: false,
      completedAt: '',
      completedBy: '',
      phase: 'Define',
      due: input.due ?? '',
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    };
    data.items.push(item);
    return {
      data,
      commitMessage: `zaoscribe: add #${item.id} (${item.owner}) ${item.title}`,
      result: item.id,
    };
  });
}

// Batch create - one commit per item to avoid massive diffs, but parallel-safe.
export async function createCoworkItems(inputs: CreateItemInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    try {
      const id = await createCoworkItem(input);
      if (id) ids.push(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] cowork-write: createCoworkItem failed for "${input.title}": ${(err as Error).message}`);
    }
  }
  return ids;
}

// Best-effort delete by ID (used by /scribe delete <captureId>).
export async function deleteCoworkItem(id: string, reason: string): Promise<boolean> {
  try {
    const result = await mutate<boolean>(async (data) => {
      const idx = data.items.findIndex((i) => i.id === id);
      if (idx < 0) return null;
      data.items.splice(idx, 1);
      return {
        data,
        commitMessage: `zaoscribe: delete #${id} (${reason})`,
        result: true,
      };
    });
    return !!result;
  } catch {
    return false;
  }
}
