// /scribe stop - bot finishes current speakers, leaves VC, processes pipeline.

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { endCapture, getActiveCapture } from '../voice.ts';
import { processAndArchive } from '../pipeline.ts';

export async function handleStop(ix: ChatInputCommandInteraction): Promise<void> {
  if (!ix.inGuild() || !ix.guild) {
    await ix.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const active = getActiveCapture(ix.guild.id);
  if (!active) {
    await ix.reply({ content: 'No active capture in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await ix.deferReply();
  const cached = ix.guild.channels.cache.get(active.channelId);
  // Type-narrow: pipeline only sends to text- or voice-based channels.
  const fallbackChannel = cached && (cached.isTextBased() || cached.isVoiceBased()) ? cached : null;
  const ended = await endCapture(ix.guild, 'slash-stop');
  if (!ended) {
    await ix.editReply('Nothing to stop.');
    return;
  }
  await ix.editReply(`Stopping capture ${ended.captureId} - transcribing + extracting now. I will reply here when done.`);
  // Run pipeline async, reply in the channel where the user invoked stop.
  processAndArchive(ix.client, ended, ix.channel ?? fallbackChannel)
    .catch((err: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[zaoscribe] /stop: pipeline failed for ${ended.captureId}: ${err.message}`);
      ix.followUp(`Pipeline failed for ${ended.captureId}: ${err.message}`).catch(() => { /* ignore */ });
    });
}
