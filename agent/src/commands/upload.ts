// /scribe upload - process an attached voice clip async (no live VC needed).
// Discord enforces a 25 MB max for slash command attachments (server boost-dependent).

import { type ChatInputCommandInteraction, type Attachment, MessageFlags } from 'discord.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from '../config.ts';
import { ensureAudioDir, ensureCaptureDir, opusPathFor } from '../audio-store.ts';
import { discordIdToOwner } from '../identity.ts';
import { processAndArchive } from '../pipeline.ts';
import type { PerSpeakerSegment } from '../types.ts';

async function downloadAttachment(att: Attachment, dest: string): Promise<void> {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

export async function handleUpload(ix: ChatInputCommandInteraction): Promise<void> {
  if (!ix.inGuild() || !ix.guild) {
    await ix.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const att = ix.options.getAttachment('file', true);
  if (!att.contentType?.startsWith('audio/') && !/\.(opus|ogg|oga|wav|mp3|m4a|webm)$/i.test(att.name ?? '')) {
    await ix.reply({ content: 'Attachment must be an audio file (opus/ogg/wav/mp3/m4a/webm).', flags: MessageFlags.Ephemeral });
    return;
  }
  const member = await ix.guild.members.fetch(ix.user.id);
  const owner = await discordIdToOwner(member);
  if (owner === 'Open') {
    await ix.reply({ content: 'You are not on the cowork roster.', flags: MessageFlags.Ephemeral });
    return;
  }
  await ix.deferReply();

  await ensureAudioDir();
  const captureId = `cap-upload-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
  await ensureCaptureDir(captureId);

  // Save under the capture's dir with a uniformly named .opus (we let transcribe.ts convert).
  const fileExt = (att.name ?? '').split('.').pop() ?? 'opus';
  const localPath = join(CONFIG.audio.dir, captureId, `upload-${ix.user.id}-${Date.now()}.${fileExt}`);
  try {
    await downloadAttachment(att, localPath);
  } catch (err) {
    await ix.editReply(`Failed to download attachment: ${(err as Error).message}`);
    return;
  }

  const seg: PerSpeakerSegment = {
    userId: ix.user.id,
    owner,
    startTime: Date.now(),
    audioPath: localPath,
  };
  await ix.editReply(`Processing upload (capture ${captureId})...`);

  processAndArchive(
    ix.client,
    {
      captureId,
      guildId: ix.guild.id,
      channelId: ix.channelId,
      startedAt: seg.startTime,
      triggerType: 'upload',
      segments: [seg],
    },
    ix.channel ?? null,
  ).catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[zaoscribe] /upload: pipeline failed for ${captureId}: ${err.message}`);
    ix.followUp(`Pipeline failed for ${captureId}: ${err.message}`).catch(() => { /* ignore */ });
  });
}
