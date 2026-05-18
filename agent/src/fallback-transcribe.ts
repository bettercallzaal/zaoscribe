// OpenAI Whisper API fallback. Used only when local whisper.cpp errors.
// API cost ~$0.006/min. Configurable via OPENAI_API_KEY env.

import { promises as fs } from 'node:fs';
import OpenAI from 'openai';
import { CONFIG } from './config.ts';

let cached: OpenAI | null = null;
function client(): OpenAI {
  if (!CONFIG.openai.apiKey) throw new Error('OPENAI_API_KEY not configured - cannot fallback');
  cached ??= new OpenAI({ apiKey: CONFIG.openai.apiKey });
  return cached;
}

export async function fallbackTranscribe(wavPath: string): Promise<{ text: string; language: string }> {
  const file = await fs.readFile(wavPath);
  // openai SDK accepts a File-like; use the Blob constructor.
  const blob = new Blob([file], { type: 'audio/wav' });
  const resp = await client().audio.transcriptions.create({
    file: new File([blob], 'audio.wav', { type: 'audio/wav' }),
    model: 'whisper-1',
    response_format: 'verbose_json',
  });
  // verbose_json includes language.
  const text = (resp as { text: string }).text ?? '';
  const language = (resp as { language?: string }).language ?? 'en';
  return { text, language };
}
