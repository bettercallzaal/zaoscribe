// Slash command dispatcher.

import type { ChatInputCommandInteraction } from 'discord.js';
import { handleStart } from './start.ts';
import { handleStop } from './stop.ts';
import { handleLink } from './link.ts';
import { handleLast } from './last.ts';
import { handleTranscript } from './transcript.ts';
import { handleStatus } from './status.ts';
import { handleOptout } from './optout.ts';
import { handleDelete } from './delete.ts';
import { handleUpload } from './upload.ts';

export async function dispatch(ix: ChatInputCommandInteraction): Promise<boolean> {
  if (ix.commandName !== 'scribe') return false;
  const sub = ix.options.getSubcommand();
  switch (sub) {
    case 'start':       await handleStart(ix); return true;
    case 'stop':        await handleStop(ix); return true;
    case 'link':        await handleLink(ix); return true;
    case 'last':        await handleLast(ix); return true;
    case 'transcript':  await handleTranscript(ix); return true;
    case 'status':      await handleStatus(ix); return true;
    case 'optout':      await handleOptout(ix); return true;
    case 'delete':      await handleDelete(ix); return true;
    case 'upload':      await handleUpload(ix); return true;
    default:
      await ix.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
      return true;
  }
}
