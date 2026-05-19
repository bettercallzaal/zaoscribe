// Low-confidence items get a DM with two inline buttons (CONFIRM / SKIP).
// Confirm -> creates the cowork item. Skip -> drops it.
//
// One pending row per (userId, queueId) on disk so a crash doesn't lose the
// queue. The queue lives at ~/.zaoscribe/pending-confirms.json.

import {
  type Client,
  type ButtonInteraction,
  type Interaction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type User,
  MessageFlags,
} from 'discord.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.ts';
import { createActionItem } from './actions-write.ts';
import type { ExtractedItem } from './types.ts';

interface PendingConfirm {
  queueId: string;
  captureId: string;
  userId: string;            // who to DM
  item: ExtractedItem;
  createdAt: string;
}

const PENDING_PATH = join(CONFIG.storage.home, 'pending-confirms.json');

async function readPending(): Promise<Record<string, PendingConfirm>> {
  try {
    return JSON.parse(await fs.readFile(PENDING_PATH, 'utf8')) as Record<string, PendingConfirm>;
  } catch {
    return {};
  }
}

async function writePending(map: Record<string, PendingConfirm>): Promise<void> {
  await fs.mkdir(CONFIG.storage.home, { recursive: true });
  await fs.writeFile(PENDING_PATH, JSON.stringify(map, null, 2), 'utf8');
}

function describeItem(it: ExtractedItem): string {
  const due = it.due ? ` (due ${it.due})` : '';
  return `${it.title}${due} - owner ${it.owner}`;
}

// Send a DM to the user with CONFIRM / SKIP buttons.
// Returns the queueId for tracking.
export async function queueConfirm(
  client: Client,
  captureId: string,
  userId: string,
  item: ExtractedItem,
): Promise<string | null> {
  const queueId = `${captureId}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const user = await client.users.fetch(userId);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`zsc:confirm:${queueId}`).setLabel('Add to cowork').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`zsc:skip:${queueId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await user.send({
      content: `Low-confidence item from capture ${captureId}:\n\n  ${describeItem(item)}\n  confidence=${item.confidence.toFixed(2)}\n  notes: ${item.notes || '(none)'}`,
      components: [row],
    });
  } catch (err) {
    // User DMs closed / bot blocked. Log + drop.
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] confirm: DM to ${userId} failed: ${(err as Error).message}`);
    return null;
  }
  const map = await readPending();
  map[queueId] = { queueId, captureId, userId, item, createdAt: new Date().toISOString() };
  await writePending(map);
  return queueId;
}

// Returns true if the interaction matched + was handled.
export async function handleConfirmButton(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const ix = interaction as ButtonInteraction;
  if (!ix.customId.startsWith('zsc:')) return false;

  const [, action, queueId] = ix.customId.split(':');
  if (!queueId) return false;

  const map = await readPending();
  const row = map[queueId];
  if (!row) {
    await ix.reply({ content: 'This confirmation expired or was already handled.', flags: MessageFlags.Ephemeral });
    return true;
  }

  // Only the DM recipient can act.
  if (ix.user.id !== row.userId) {
    await ix.reply({ content: 'Only the original recipient can act on this.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'confirm') {
    try {
      const id = await createActionItem({
        title: row.item.title,
        owner: row.item.owner,
        createdBy: `zaoscribe (${(ix.user as User).username})`,
        notes: `[zaoscribe ${row.captureId}] ${row.item.notes}`.trim(),
        due: row.item.due,
      });
      await ix.update({
        content: id ? `Added action #${id}: ${describeItem(row.item)}` : 'Add failed (GitHub API). Try again later.',
        components: [],
      });
    } catch (err) {
      await ix.update({ content: `Add failed: ${(err as Error).message}`, components: [] });
    }
  } else if (action === 'skip') {
    await ix.update({ content: `Skipped: ${describeItem(row.item)}`, components: [] });
  } else {
    await ix.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
    return true;
  }

  delete map[queueId];
  await writePending(map);
  return true;
}
