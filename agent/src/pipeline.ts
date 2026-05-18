// Post-capture pipeline: transcribe -> extract -> write items -> commit
// transcript -> reply in the originating channel.

import type { Client, GuildTextBasedChannel, VoiceBasedChannel, TextBasedChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { buildTranscriptFromSegments } from './transcribe.ts';
import { extractActionItems } from './extract.ts';
import { createCoworkItems } from './cowork-write.ts';
import { commitTranscript, transcriptGithubUrl } from './transcript-write.ts';
import { queueConfirm } from './confirm-flow.ts';
import { recordCapture } from './storage.ts';
import { CONFIG } from './config.ts';
import type { Capture, ExtractedItem, Owner } from './types.ts';

interface ActiveCaptureSummary {
  captureId: string;
  guildId: string;
  channelId: string;
  startedAt: number;
  triggerType: 'auto-join' | 'slash-start' | 'upload';
  segments: { userId: string; owner: Owner; startTime: number; audioPath: string }[];
}

function findTextChannelForReply(
  voiceChannel: VoiceBasedChannel | null,
): GuildTextBasedChannel | null {
  if (!voiceChannel) return null;
  // Prefer the VC's own text-chat (Discord stage/voice channels have one).
  if (voiceChannel.type === ChannelType.GuildVoice) {
    return voiceChannel as unknown as GuildTextBasedChannel;
  }
  return null;
}

function summariseReply(c: Capture): string {
  const itemList = c.extractedItemIds.length
    ? c.extractedItemIds.map((id) => `  #${id}`).join('\n')
    : '  (no items extracted)';
  const queued = c.queuedItemCount > 0 ? `\nFlagged ${c.queuedItemCount} low-confidence item(s) - DM sent to owner(s) to confirm.` : '';
  return [
    `Capture ${c.captureId} complete.`,
    `Duration: ${c.durationSec}s. Speakers: ${c.speakerIds.length}. Language: ${c.language}.`,
    `Added ${c.extractedItemIds.length} item(s) to cowork:`,
    itemList,
    queued,
    `Transcript: ${c.transcriptGithubUrl}`,
  ].filter(Boolean).join('\n');
}

export async function processAndArchive(
  client: Client,
  capture: ActiveCaptureSummary,
  replyChannel: VoiceBasedChannel | GuildTextBasedChannel | TextBasedChannel | null,
): Promise<Capture> {
  const endedAtMs = Date.now();
  const durationSec = Math.round((endedAtMs - capture.startedAt) / 1000);

  // Step A - Transcribe.
  const { text: transcript, language } = await buildTranscriptFromSegments(capture.segments);

  // Step B - Extract.
  const { items, modelChain, escalationReasons } = await extractActionItems(transcript);
  // eslint-disable-next-line no-console
  console.log(`[zaoscribe] pipeline: ${capture.captureId} extracted=${items.length} models=${modelChain.join('->')} escal=${escalationReasons.join(',') || 'none'}`);

  // Step C - Confidence gate; auto-write high, queue low.
  const autoWrite: ExtractedItem[] = [];
  const queue: ExtractedItem[] = [];
  for (const it of items) {
    if (it.confidence >= CONFIG.behaviour.confidenceAutoWrite) autoWrite.push(it);
    else queue.push(it);
  }

  // Step D - Create cowork items for auto-write list.
  const speakerLabel = capture.segments.length > 0 ? capture.segments[0].owner : 'zaoscribe';
  const ids = await createCoworkItems(
    autoWrite.map((it) => ({
      title: it.title,
      owner: it.owner,
      createdBy: `zaoscribe (${speakerLabel}) ${capture.captureId}`,
      due: it.due,
      notes: `[zaoscribe ${capture.captureId}] ${it.notes}`.trim(),
    })),
  );

  // Step E - Build Capture record.
  const speakerOwners: Record<string, Owner> = {};
  for (const s of capture.segments) speakerOwners[s.userId] = s.owner;
  const c: Capture = {
    captureId: capture.captureId,
    startedAt: new Date(capture.startedAt).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    guildId: capture.guildId,
    channelId: capture.channelId,
    triggerType: capture.triggerType,
    speakerIds: Array.from(new Set(capture.segments.map((s) => s.userId))),
    speakerOwners,
    transcript,
    language,
    durationSec,
    extractedItemIds: ids,
    queuedItemCount: queue.length,
    transcriptGithubUrl: '',
  };

  // Step F - Commit transcript .md to own repo.
  try {
    c.transcriptGithubUrl = await commitTranscript(c);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] pipeline: transcript commit failed: ${(err as Error).message}`);
    c.transcriptGithubUrl = '(commit failed - see VPS logs)';
  }

  // Step G - DM low-confidence items to their owners.
  for (const it of queue) {
    const ownerUserId = capture.segments.find((s) => s.owner === it.owner)?.userId;
    if (!ownerUserId) continue;
    await queueConfirm(client, capture.captureId, ownerUserId, it).catch((err: Error) => {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] pipeline: queueConfirm failed: ${err.message}`);
    });
  }

  // Step H - Record in ring buffer.
  await recordCapture(c);

  // Step I - Reply in the originating channel (if it's a text-capable channel).
  if (replyChannel && 'send' in replyChannel) {
    try {
      await (replyChannel as GuildTextBasedChannel).send(summariseReply(c));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] pipeline: reply send failed: ${(err as Error).message}`);
    }
  }

  return c;
}

export { findTextChannelForReply };
