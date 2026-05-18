// /scribe transcript <id> - reply with GitHub link to the transcript .md.

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getCaptureById } from '../storage.ts';

export async function handleTranscript(ix: ChatInputCommandInteraction): Promise<void> {
  const id = ix.options.getString('id', true);
  const c = await getCaptureById(id);
  if (!c) {
    await ix.reply({ content: `No capture found with id "${id}". Try /scribe last to see recent.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await ix.reply({ content: `Transcript for ${id}: ${c.transcriptGithubUrl}`, flags: MessageFlags.Ephemeral });
}
