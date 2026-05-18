// /scribe delete <captureId> - GDPR-style removal.
// Caller must have been a speaker in the capture (or be Zaal).

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getCaptureById } from '../storage.ts';
import { deleteTranscript } from '../transcript-write.ts';
import { deleteCoworkItem } from '../cowork-write.ts';
import { discordIdToOwner } from '../identity.ts';

export async function handleDelete(ix: ChatInputCommandInteraction): Promise<void> {
  if (!ix.inGuild() || !ix.guild) {
    await ix.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const id = ix.options.getString('id', true);
  const c = await getCaptureById(id);
  if (!c) {
    await ix.reply({ content: `No capture found with id "${id}".`, flags: MessageFlags.Ephemeral });
    return;
  }
  // Authorization - must have been a speaker OR be Zaal.
  const member = await ix.guild.members.fetch(ix.user.id);
  const callerOwner = await discordIdToOwner(member);
  const wasSpeaker = c.speakerIds.includes(ix.user.id);
  if (!wasSpeaker && callerOwner !== 'Zaal') {
    await ix.reply({ content: 'You can only delete captures you participated in.', flags: MessageFlags.Ephemeral });
    return;
  }
  await ix.deferReply({ flags: MessageFlags.Ephemeral });
  const transcriptDeleted = await deleteTranscript(c);
  let itemsDeleted = 0;
  for (const itemId of c.extractedItemIds) {
    if (await deleteCoworkItem(itemId, `GDPR delete capture ${id} by ${ix.user.username}`)) itemsDeleted += 1;
  }
  await ix.editReply(`Capture ${id}: transcript ${transcriptDeleted ? 'deleted' : 'not found'}, cowork items removed: ${itemsDeleted}/${c.extractedItemIds.length}. Raw audio was already auto-deleted at 24h.`);
}
