// /scribe optout - flip your per-user opt-out. Self-only.

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { isOptedOut, setOptout } from '../storage.ts';

export async function handleOptout(ix: ChatInputCommandInteraction): Promise<void> {
  const on = ix.options.getBoolean('on');
  if (on === null) {
    const current = await isOptedOut(ix.user.id);
    await ix.reply({ content: `Your opt-out is currently ${current ? 'ON' : 'OFF'}. Use \`/scribe optout on:true\` or \`/scribe optout on:false\`.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await setOptout(ix.user.id, on);
  await ix.reply({ content: on ? 'Opted out - your audio will NOT be captured.' : 'Opted back in.', flags: MessageFlags.Ephemeral });
}
