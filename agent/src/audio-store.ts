// /tmp/zaoscribe-audio/ file management.
// Each speaker utterance saved as <userId>-<ts>.opus (Discord stream raw).
// transcribe.ts converts to .wav before whisper.cpp.

import { promises as fs } from 'node:fs';
import { createWriteStream, WriteStream } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.ts';

export async function ensureAudioDir(): Promise<void> {
  await fs.mkdir(CONFIG.audio.dir, { recursive: true });
}

export function opusPathFor(userId: string, ts: number): string {
  return join(CONFIG.audio.dir, `${userId}-${ts}.opus`);
}

export function wavPathFor(opusPath: string): string {
  return opusPath.replace(/\.opus$/, '.wav');
}

export function captureDirFor(captureId: string): string {
  return join(CONFIG.audio.dir, captureId);
}

export async function ensureCaptureDir(captureId: string): Promise<string> {
  const dir = captureDirFor(captureId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function createOpusStream(path: string): WriteStream {
  return createWriteStream(path);
}

export async function safeRm(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // already gone, fine
  }
}

export async function safeRmrf(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // already gone
  }
}

export async function listCaptureFiles(captureId: string): Promise<string[]> {
  const dir = captureDirFor(captureId);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.opus')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export async function listAllCapturesOlderThan(hours: number): Promise<string[]> {
  const cutoff = Date.now() - hours * 3600_000;
  try {
    const entries = await fs.readdir(CONFIG.audio.dir, { withFileTypes: true });
    const old: string[] = [];
    for (const e of entries) {
      const p = join(CONFIG.audio.dir, e.name);
      try {
        const st = await fs.stat(p);
        if (st.mtime.getTime() < cutoff) old.push(p);
      } catch {
        // skip
      }
    }
    return old;
  } catch {
    return [];
  }
}
