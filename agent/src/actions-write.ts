// Octokit SHA-dance write to bettercallzaal/zaoscribe/data/actions.json.
// Self-hosted action tracker (v0.3+) - no cross-org PAT, no songchaindao-dot
// dependency. Same JSON schema as cowork-zaodevz so future migration / sync
// stays trivial. 3x retry on 409/422 (race with manual edits).

import { Octokit } from '@octokit/rest';
import { CONFIG } from './config.ts';
import type { ActionsFile, ActionItem, Owner, Priority } from './types.ts';

let cached: Octokit | null = null;
function octokit(): Octokit {
  if (!CONFIG.github.zaoscribeToken) {
    throw new Error('ZAOSCRIBE_GITHUB_TOKEN not set - action writes disabled. Add it to .env + restart.');
  }
  cached ??= new Octokit({ auth: CONFIG.github.zaoscribeToken });
  return cached;
}

async function fetchActions(): Promise<{ data: ActionsFile; sha: string }> {
  try {
    const res = await octokit().repos.getContent({
      owner: CONFIG.github.zaoscribeOwner,
      repo: CONFIG.github.zaoscribeRepo,
      path: CONFIG.github.actionsPath,
      ref: CONFIG.github.zaoscribeBranch,
    });
    if (Array.isArray(res.data) || res.data.type !== 'file') {
      throw new Error(`expected file at ${CONFIG.github.actionsPath}`);
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    const data = JSON.parse(content) as ActionsFile;
    return { data, sha: res.data.sha };
  } catch (err) {
    // If file doesn't exist yet, return an empty document (first-ever write).
    if ((err as { status?: number }).status === 404) {
      return { data: { updatedAt: new Date().toISOString(), items: [] }, sha: '' };
    }
    throw err;
  }
}

async function commitActions(data: ActionsFile, sha: string, message: string): Promise<string> {
  data.updatedAt = new Date().toISOString();
  const res = await octokit().repos.createOrUpdateFileContents({
    owner: CONFIG.github.zaoscribeOwner,
    repo: CONFIG.github.zaoscribeRepo,
    path: CONFIG.github.actionsPath,
    branch: CONFIG.github.zaoscribeBranch,
    message,
    // Omit sha entirely on first-ever write (when fetchActions returned empty).
    ...(sha ? { sha } : {}),
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
  throw new Error(`actions mutation failed after ${maxAttempts} attempts: ${lastErr?.message}`);
}

// Create one item; returns the new ID.
export async function createActionItem(input: CreateItemInput): Promise<string | null> {
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

// Batch create - one commit per item to avoid massive diffs.
export async function createActionItems(inputs: CreateItemInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    try {
      const id = await createActionItem(input);
      if (id) ids.push(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] actions-write: createActionItem failed for "${input.title}": ${(err as Error).message}`);
    }
  }
  return ids;
}

// Best-effort delete by ID (used by /scribe delete <captureId>).
export async function deleteActionItem(id: string, reason: string): Promise<boolean> {
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
