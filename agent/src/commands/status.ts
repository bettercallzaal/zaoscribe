// /scribe status - current recording state, speakers, elapsed.

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getActiveCapture } from '../voice.ts';

export async function handleStatus(ix: ChatInputCommandInteraction): Promise<void> {
  if (!ix.inGuild() || !ix.guild) {
    await ix.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const a = getActiveCapture(ix.guild.id);
  if (!a) {
    await ix.reply({ content: 'Idle. No active capture in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const elapsedSec = Math.round((Date.now() - a.startedAt) / 1000);
  const speakers = new Set(a.segments.map((s) => s.owner));
  const lines = [
    `Capture ${a.captureId} - elapsed ${elapsedSec}s`,
    `Channel: <#${a.channelId}>`,
    `Trigger: ${a.triggerType}`,
    `Segments captured so far: ${a.segments.length}`,
    `Distinct speakers seen: ${speakers.size > 0 ? Array.from(speakers).join(', ') : '(none yet)'}`,
  ];
  await ix.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}
