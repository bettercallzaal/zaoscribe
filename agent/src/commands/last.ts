// /scribe last - show the last 5 captures with their extracted item IDs.

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getLastCaptures } from '../storage.ts';

export async function handleLast(ix: ChatInputCommandInteraction): Promise<void> {
  const captures = await getLastCaptures(5);
  if (captures.length === 0) {
    await ix.reply({ content: 'No captures yet.', flags: MessageFlags.Ephemeral });
    return;
  }
  const lines: string[] = ['Last captures:'];
  for (const c of captures) {
    const ids = c.extractedItemIds.length ? c.extractedItemIds.map((id) => `#${id}`).join(', ') : '(none)';
    lines.push(`  ${c.captureId} - ${new Date(c.startedAt).toISOString().slice(0, 16)} - ${c.durationSec}s - ${c.speakerIds.length} speakers - items: ${ids}`);
  }
  await ix.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}
