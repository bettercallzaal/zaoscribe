// Transcription pipeline:
//   .opus -> ffmpeg normalise (16kHz mono PCM WAV) -> whisper.cpp -> text + language.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { CONFIG } from './config.ts';
import { wavPathFor } from './audio-store.ts';
import { fallbackTranscribe } from './fallback-transcribe.ts';
import type { PerSpeakerSegment } from './types.ts';

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';

async function run(cmd: string, args: string[], timeoutMs = 180_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      reject(new Error(`timeout ${timeoutMs / 1000}s: ${cmd}`));
    }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(`spawn failed: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (code !== 0) return reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 400)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function ffmpegToWav(opusPath: string, wavPath: string): Promise<void> {
  await run(FFMPEG_BIN, [
    '-y',
    '-i', opusPath,
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    '-loglevel', 'error',
    wavPath,
  ], 60_000);
}

interface WhisperOut {
  text: string;
  language: string;
}

async function whisperCpp(wavPath: string): Promise<WhisperOut> {
  // whisper-cli outputs to <wavPath>.txt by default + prints to stdout. We use --output-txt.
  const { stdout } = await run(CONFIG.whisper.bin, [
    '-m', CONFIG.whisper.modelPath,
    '-f', wavPath,
    '-l', 'auto',
    '--no-prints',
    '--output-txt',
    '--language', 'auto',
  ], 180_000);

  // Parse "detected language: en (p = 0.99)" hint from stderr/stdout if present.
  const langMatch = stdout.match(/auto-detected language:\s*(\w+)/i);
  const language = langMatch?.[1] ?? 'en';

  // Read the .txt file whisper.cpp wrote.
  const txtPath = `${wavPath}.txt`;
  let text = '';
  try {
    text = (await fs.readFile(txtPath, 'utf8')).trim();
  } catch {
    // Fall back to stdout if --output-txt didn't kick in.
    text = stdout
      .split('\n')
      .filter((l) => !l.startsWith('[') && !l.startsWith('whisper_') && l.trim())
      .join('\n')
      .trim();
  }
  return { text, language };
}

export async function transcribeSegment(seg: PerSpeakerSegment): Promise<{ text: string; language: string }> {
  const wavPath = wavPathFor(seg.audioPath);
  try {
    await ffmpegToWav(seg.audioPath, wavPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] transcribe: ffmpeg failed on ${seg.audioPath}: ${(err as Error).message}`);
    return { text: '', language: 'en' };
  }
  try {
    return await whisperCpp(wavPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] transcribe: whisper.cpp failed on ${wavPath}: ${(err as Error).message} - trying fallback API`);
    if (!CONFIG.openai.apiKey) {
      // no fallback configured
      return { text: '', language: 'en' };
    }
    try {
      const out = await fallbackTranscribe(wavPath);
      return out;
    } catch (err2) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] transcribe: openai fallback also failed: ${(err2 as Error).message}`);
      return { text: '', language: 'en' };
    }
  }
}

export interface BuiltTranscript {
  text: string;          // speaker-labeled, chronological
  language: string;      // most-common detected language
  segmentCount: number;
}

// Build a speaker-labeled chronological transcript from a list of segments.
// Each segment has its own startTime + text + speaker owner.
export async function buildTranscriptFromSegments(segs: PerSpeakerSegment[]): Promise<BuiltTranscript> {
  // Order by startTime, transcribe in parallel.
  const sorted = [...segs].sort((a, b) => a.startTime - b.startTime);
  const results = await Promise.all(sorted.map((s) => transcribeSegment(s)));

  const langCounts = new Map<string, number>();
  const lines: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const { text, language } = results[i];
    if (text.trim()) {
      lines.push(`[${seg.owner}] ${text.trim()}`);
      langCounts.set(language, (langCounts.get(language) ?? 0) + 1);
    }
  }

  const language = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'en';
  return { text: lines.join('\n'), language, segmentCount: sorted.length };
}
