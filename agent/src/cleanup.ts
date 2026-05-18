// 24h audio sweep cron. Belt-and-suspenders to systemd ExecStopPost.
// Deletes raw .opus + .wav files older than CONFIG.audio.retentionHours.

import cron from 'node-cron';
import { listAllCapturesOlderThan, safeRmrf, safeRm } from './audio-store.ts';
import { CONFIG } from './config.ts';
import { promises as fs } from 'node:fs';

async function isDirectory(path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function sweep(): Promise<void> {
  const old = await listAllCapturesOlderThan(CONFIG.audio.retentionHours);
  let dirs = 0;
  let files = 0;
  for (const p of old) {
    if (await isDirectory(p)) {
      await safeRmrf(p);
      dirs += 1;
    } else {
      await safeRm(p);
      files += 1;
    }
  }
  if (dirs + files > 0) {
    // eslint-disable-next-line no-console
    console.log(`[zaoscribe] cleanup: swept ${dirs} dir(s) + ${files} file(s) older than ${CONFIG.audio.retentionHours}h`);
  }
}

export function startCleanupCron(): { stop: () => void } {
  // Every hour. Cheap.
  const task = cron.schedule('15 * * * *', () => {
    sweep().catch((err: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[zaoscribe] cleanup: sweep failed: ${err.message}`);
    });
  });
  // Also run once at startup.
  sweep().catch(() => { /* ignore */ });
  // eslint-disable-next-line no-console
  console.log(`[zaoscribe] cleanup: cron started (hourly, retention=${CONFIG.audio.retentionHours}h)`);
  return { stop: () => task.stop() };
}
