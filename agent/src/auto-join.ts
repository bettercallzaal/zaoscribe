// voiceStateUpdate listener. When a roster member joins the dedicated coworking
// VC AND starts speaking, auto-start the capture. Leaves automatically when the
// last roster member departs.

import type { Client, VoiceState, VoiceBasedChannel } from 'discord.js';
import { CONFIG } from './config.ts';
import { discordIdToOwner } from './identity.ts';
import { isOptedOut } from './storage.ts';
import { startCapture, endCapture, getActiveCapture } from './voice.ts';
import { processAndArchive } from './pipeline.ts';

async function isRosterMember(state: VoiceState): Promise<boolean> {
  const member = state.member;
  if (!member || member.user.bot) return false;
  if (await isOptedOut(member.id)) return false;
  const owner = await discordIdToOwner(member);
  return owner !== 'Open';
}

async function countRosterInChannel(channel: VoiceBasedChannel): Promise<number> {
  let n = 0;
  for (const [, m] of channel.members) {
    if (m.user.bot) continue;
    if (await isOptedOut(m.id)) continue;
    const owner = await discordIdToOwner(m);
    if (owner !== 'Open') n += 1;
  }
  return n;
}

export function registerAutoJoin(client: Client): void {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      if (newState.guild.id !== CONFIG.discord.guildId) return;

      // Did anyone JOIN the coworking VC?
      if (newState.channelId === CONFIG.discord.coworkingVcId && oldState.channelId !== CONFIG.discord.coworkingVcId) {
        if (!(await isRosterMember(newState))) return;
        const channel = newState.channel;
        if (!channel) return;
        const existing = getActiveCapture(newState.guild.id);
        if (existing) return; // already capturing
        await startCapture(channel, 'auto-join');
        // eslint-disable-next-line no-console
        console.log(`[zaoscribe] auto-join: started capture in ${channel.name} (joined: ${newState.member?.displayName})`);
        return;
      }

      // Did the last roster member LEAVE the coworking VC?
      if (oldState.channelId === CONFIG.discord.coworkingVcId && newState.channelId !== CONFIG.discord.coworkingVcId) {
        const oldChannel = oldState.channel;
        if (!oldChannel) return;
        const count = await countRosterInChannel(oldChannel);
        if (count > 0) return;
        const active = getActiveCapture(oldState.guild.id);
        if (!active) return;
        if (active.channelId !== CONFIG.discord.coworkingVcId) return; // different capture
        const ended = await endCapture(oldState.guild, 'auto-leave');
        if (!ended) return;
        // eslint-disable-next-line no-console
        console.log(`[zaoscribe] auto-join: room empty, processing capture ${ended.captureId}`);
        // Process in background - don't block the event handler.
        processAndArchive(client, ended, oldChannel).catch((err: Error) => {
          // eslint-disable-next-line no-console
          console.error(`[zaoscribe] auto-join: processAndArchive failed for ${ended.captureId}: ${err.message}`);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[zaoscribe] auto-join: listener error: ${(err as Error).message}`);
    }
  });
}
