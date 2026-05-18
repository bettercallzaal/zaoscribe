// Discord voice channel join + per-speaker subscribe loop.
// Per @discordjs/voice v0.18+ - connection.receiver.subscribe(userId) returns
// a stream of decoded opus packets that ends on speaker silence.

import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  getVoiceConnection,
} from '@discordjs/voice';
import type { VoiceBasedChannel, Guild } from 'discord.js';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.ts';
import { ensureAudioDir, ensureCaptureDir, createOpusStream, opusPathFor } from './audio-store.ts';
import { discordIdToOwner } from './identity.ts';
import { isOptedOut } from './storage.ts';
import { setRecording } from './presence.ts';
import type { PerSpeakerSegment } from './types.ts';

interface ActiveCapture {
  captureId: string;
  guildId: string;
  channelId: string;
  startedAt: number;
  triggerType: 'auto-join' | 'slash-start' | 'upload';
  triggeredByUserId?: string;
  connection: VoiceConnection;
  segments: PerSpeakerSegment[];
  activeStreams: Set<string>; // userIds currently piping
}

// One active capture per guild (we only support one guild anyway, but model it cleanly).
const captures = new Map<string, ActiveCapture>();

export function getActiveCapture(guildId: string): ActiveCapture | undefined {
  return captures.get(guildId);
}

export async function startCapture(
  channel: VoiceBasedChannel,
  triggerType: ActiveCapture['triggerType'],
  triggeredByUserId?: string,
): Promise<ActiveCapture> {
  // Don't double-start
  const existing = captures.get(channel.guild.id);
  if (existing) return existing;

  await ensureAudioDir();
  const captureId = `cap-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
  await ensureCaptureDir(captureId);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,  // need to RECEIVE audio
    selfMute: true,   // we never speak
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    connection.destroy();
    throw new Error(`voice ready timeout: ${(err as Error).message}`);
  }

  const capture: ActiveCapture = {
    captureId,
    guildId: channel.guild.id,
    channelId: channel.id,
    startedAt: Date.now(),
    triggerType,
    triggeredByUserId,
    connection,
    segments: [],
    activeStreams: new Set(),
  };
  captures.set(channel.guild.id, capture);

  // Switch nickname to [REC] indicator
  await setRecording(channel.guild, true);

  // Auto-cleanup on disconnect.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // recovered - do nothing
    } catch {
      // Seems destroyed for real. Stop the capture cleanly.
      await endCapture(channel.guild, 'disconnected').catch(() => {});
    }
  });

  // Wire up the per-speaker subscribe loop.
  const receiver = connection.receiver;
  receiver.speaking.on('start', async (userId) => {
    if (capture.activeStreams.has(userId)) return; // already piping
    try {
      const member = await channel.guild.members.fetch(userId).catch(() => null);
      if (!member || member.user.bot) return;          // skip bots
      if (await isOptedOut(userId)) return;             // skip opted-out
      const owner = await discordIdToOwner(member);

      const ts = Date.now();
      const audioPath = opusPathFor(`${captureId}__${userId}`, ts);

      const stream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
      });
      const file = createOpusStream(audioPath);
      capture.activeStreams.add(userId);

      pipeline(stream, file)
        .then(() => {
          capture.segments.push({
            userId,
            owner,
            startTime: ts,
            audioPath,
          });
        })
        .catch((err: Error) => {
          // eslint-disable-next-line no-console
          console.warn(`[zaoscribe] voice: stream pipeline failed for ${userId}: ${err.message}`);
        })
        .finally(() => {
          capture.activeStreams.delete(userId);
        });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] voice: subscribe failed for ${userId}: ${(err as Error).message}`);
    }
  });

  return capture;
}

// Wait briefly for any in-flight pipelines to drain.
async function drainStreams(capture: ActiveCapture, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (capture.activeStreams.size > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function endCapture(
  guild: Guild,
  reason: 'slash-stop' | 'disconnected' | 'auto-leave',
): Promise<ActiveCapture | null> {
  const capture = captures.get(guild.id);
  if (!capture) return null;
  captures.delete(guild.id);

  await drainStreams(capture);

  // Restore nickname BEFORE destroying connection (UX).
  await setRecording(guild, false);

  try {
    capture.connection.destroy();
  } catch {
    // already gone
  }

  // Final connection might already be destroyed - try cleanup.
  try {
    getVoiceConnection(guild.id)?.destroy();
  } catch {
    // already gone
  }

  // eslint-disable-next-line no-console
  console.log(`[zaoscribe] voice: ended capture ${capture.captureId} (${reason}) - ${capture.segments.length} segments`);
  return capture;
}
