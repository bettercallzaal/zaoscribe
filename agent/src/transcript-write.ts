// Commit transcript .md to bettercallzaal/zaoscribe/data/transcripts/YYYY-MM/.
// One file per capture. Frontmatter has captureId + extracted item IDs.

import { Octokit } from '@octokit/rest';
import { CONFIG } from './config.ts';
import type { Capture } from './types.ts';

let cached: Octokit | null = null;
function octokit(): Octokit {
  if (!CONFIG.github.zaoscribeToken) {
    throw new Error('ZAOSCRIBE_GITHUB_TOKEN not set - transcript writes disabled. Add it to .env + restart.');
  }
  cached ??= new Octokit({ auth: CONFIG.github.zaoscribeToken });
  return cached;
}

function monthBucket(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function relativePathFor(c: Capture): string {
  return `${CONFIG.github.zaoscribeTranscriptDir}/${monthBucket(c.startedAt)}/${c.captureId}.md`;
}

export function transcriptGithubUrl(c: Capture): string {
  return `https://github.com/${CONFIG.github.zaoscribeOwner}/${CONFIG.github.zaoscribeRepo}/blob/${CONFIG.github.zaoscribeBranch}/${relativePathFor(c)}`;
}

function frontmatter(c: Capture): string {
  return `---
captureId: ${c.captureId}
startedAt: ${c.startedAt}
endedAt: ${c.endedAt}
guildId: ${c.guildId}
channelId: ${c.channelId}
triggerType: ${c.triggerType}
speakers:
${c.speakerIds.map((id) => `  - id: ${id}\n    owner: ${c.speakerOwners[id] ?? 'Open'}`).join('\n')}
durationSec: ${c.durationSec}
language: ${c.language}
extractedItemIds: [${c.extractedItemIds.join(', ')}]
queuedItemCount: ${c.queuedItemCount}
---`;
}

export async function commitTranscript(c: Capture): Promise<string> {
  const path = relativePathFor(c);
  const body = `${frontmatter(c)}\n\n${c.transcript}\n`;
  await octokit().repos.createOrUpdateFileContents({
    owner: CONFIG.github.zaoscribeOwner,
    repo: CONFIG.github.zaoscribeRepo,
    path,
    branch: CONFIG.github.zaoscribeBranch,
    message: `zaoscribe: capture ${c.captureId}`,
    content: Buffer.from(body).toString('base64'),
  });
  return transcriptGithubUrl(c);
}

// Best-effort delete (for /scribe delete <captureId> GDPR-style).
export async function deleteTranscript(c: Capture): Promise<boolean> {
  const path = relativePathFor(c);
  try {
    const res = await octokit().repos.getContent({
      owner: CONFIG.github.zaoscribeOwner,
      repo: CONFIG.github.zaoscribeRepo,
      path,
      ref: CONFIG.github.zaoscribeBranch,
    });
    if (Array.isArray(res.data) || res.data.type !== 'file') return false;
    await octokit().repos.deleteFile({
      owner: CONFIG.github.zaoscribeOwner,
      repo: CONFIG.github.zaoscribeRepo,
      path,
      branch: CONFIG.github.zaoscribeBranch,
      message: `zaoscribe: delete transcript ${c.captureId} (GDPR)`,
      sha: res.data.sha,
    });
    return true;
  } catch {
    return false;
  }
}
