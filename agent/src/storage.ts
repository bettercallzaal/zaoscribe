// Persistent JSON state at ~/.zaoscribe/<file>.json.
// Used for: explicit identity links, optout list, last-capture record.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.ts';
import type { Capture, Owner } from './types.ts';

const FILES = {
  links: 'links.json',         // discord_id -> Owner
  optouts: 'optouts.json',     // discord_id[]
  lastCaptures: 'last.json',   // ring buffer of Capture summaries
} as const;

async function ensureHome(): Promise<void> {
  await fs.mkdir(CONFIG.storage.home, { recursive: true });
}

async function readJson<T>(name: keyof typeof FILES, fallback: T): Promise<T> {
  try {
    await ensureHome();
    const raw = await fs.readFile(join(CONFIG.storage.home, FILES[name]), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: keyof typeof FILES, data: unknown): Promise<void> {
  await ensureHome();
  await fs.writeFile(join(CONFIG.storage.home, FILES[name]), JSON.stringify(data, null, 2), 'utf8');
}

// --- Identity links ---

export async function getLinkedOwner(discordId: string): Promise<Owner | null> {
  const links = await readJson<Record<string, Owner>>('links', {});
  return links[discordId] ?? null;
}

export async function setLinkedOwner(discordId: string, owner: Owner): Promise<void> {
  const links = await readJson<Record<string, Owner>>('links', {});
  links[discordId] = owner;
  await writeJson('links', links);
}

export async function clearLinkedOwner(discordId: string): Promise<void> {
  const links = await readJson<Record<string, Owner>>('links', {});
  delete links[discordId];
  await writeJson('links', links);
}

// --- Optouts ---

export async function isOptedOut(discordId: string): Promise<boolean> {
  const list = await readJson<string[]>('optouts', []);
  return list.includes(discordId);
}

export async function setOptout(discordId: string, opted: boolean): Promise<void> {
  const list = await readJson<string[]>('optouts', []);
  const set = new Set(list);
  if (opted) set.add(discordId);
  else set.delete(discordId);
  await writeJson('optouts', Array.from(set));
}

// --- Last captures (ring buffer) ---

const MAX_LAST = 25;

export async function recordCapture(c: Capture): Promise<void> {
  const list = await readJson<Capture[]>('lastCaptures', []);
  list.unshift(c);
  await writeJson('lastCaptures', list.slice(0, MAX_LAST));
}

export async function getLastCaptures(n: number = 5): Promise<Capture[]> {
  const list = await readJson<Capture[]>('lastCaptures', []);
  return list.slice(0, n);
}

export async function getCaptureById(captureId: string): Promise<Capture | null> {
  const list = await readJson<Capture[]>('lastCaptures', []);
  return list.find((c) => c.captureId === captureId) ?? null;
}
