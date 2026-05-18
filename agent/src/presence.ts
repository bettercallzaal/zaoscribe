// Toggle bot nickname between '[REC] @ZAOscribeBot' and default while recording.
// Visible to all members of the VC + channel - the consent indicator.

import type { Guild } from 'discord.js';

const REC_PREFIX = '[REC] ';
let originalNick: string | null = null;

export async function setRecording(guild: Guild, on: boolean): Promise<void> {
  const me = guild.members.me;
  if (!me) return;
  try {
    if (on) {
      if (originalNick === null) originalNick = me.nickname ?? me.user.username;
      const newNick = `${REC_PREFIX}${originalNick}`.slice(0, 32);
      if (me.nickname !== newNick) await me.setNickname(newNick, 'recording in voice channel');
    } else {
      const restored = originalNick ?? me.user.username;
      if (me.nickname !== restored) await me.setNickname(restored.slice(0, 32), 'recording ended');
      originalNick = null;
    }
  } catch (err) {
    // Missing perms or rate-limit - non-fatal, just log.
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] presence: setNickname failed: ${(err as Error).message}`);
  }
}
