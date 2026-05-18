// /scribe link <name> - explicit map of caller's discord_id -> Owner enum.
// Self-only (you can only link yourself, no impersonation).

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { canonicalizeOwnerName } from '../identity.ts';
import { setLinkedOwner } from '../storage.ts';
import { OWNERS } from '../types.ts';

export async function handleLink(ix: ChatInputCommandInteraction): Promise<void> {
  const raw = ix.options.getString('name', true);
  const owner = canonicalizeOwnerName(raw);
  if (!owner) {
    await ix.reply({
      content: `Unknown name "${raw}". Valid: ${OWNERS.join(', ')}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await setLinkedOwner(ix.user.id, owner);
  await ix.reply({
    content: `Linked your Discord ID (${ix.user.id}) -> ${owner}. Future captures will attribute your audio to ${owner}.`,
    flags: MessageFlags.Ephemeral,
  });
}
