// /scribe start - bot joins your current VC, starts capture.

import { type ChatInputCommandInteraction, MessageFlags, ChannelType } from 'discord.js';
import { discordIdToOwner } from '../identity.ts';
import { startCapture, getActiveCapture } from '../voice.ts';

export async function handleStart(ix: ChatInputCommandInteraction): Promise<void> {
  if (!ix.inGuild() || !ix.guild) {
    await ix.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const member = await ix.guild.members.fetch(ix.user.id);
  const owner = await discordIdToOwner(member);
  if (owner === 'Open') {
    await ix.reply({ content: `You are not on the cowork roster. Ask Zaal to add you (Discord display name should match one of: Zaal, Iman, ThyRev, Samantha).`, flags: MessageFlags.Ephemeral });
    return;
  }
  const vc = member.voice.channel;
  if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
    await ix.reply({ content: 'Join a voice channel first, then run /scribe start.', flags: MessageFlags.Ephemeral });
    return;
  }
  const existing = getActiveCapture(ix.guild.id);
  if (existing) {
    await ix.reply({ content: `Already capturing in <#${existing.channelId}> (capture ${existing.captureId}).`, flags: MessageFlags.Ephemeral });
    return;
  }
  await ix.deferReply();
  try {
    const cap = await startCapture(vc, 'slash-start', ix.user.id);
    await ix.editReply(`[REC] capturing <#${vc.id}> (capture ${cap.captureId}). Audio kept 24h, transcripts in git. \`/scribe stop\` to end.`);
  } catch (err) {
    await ix.editReply(`Failed to join VC: ${(err as Error).message}`);
  }
}
