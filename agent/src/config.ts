// Env validation. Throws at module load if a required var is missing.

import { config as loadEnv } from 'dotenv';
loadEnv();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. See .env.example.`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const CONFIG = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    coworkingVcId: required('DISCORD_COWORKING_VC_ID'),
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  github: {
    coworkToken: required('COWORK_GITHUB_TOKEN'),
    zaoscribeToken: required('ZAOSCRIBE_GITHUB_TOKEN'),
    coworkOwner: 'songchaindao-dot',
    coworkRepo: 'cowork-zaodevz',
    coworkPath: 'data/actions.json',
    coworkBranch: 'main',
    zaoscribeOwner: 'bettercallzaal',
    zaoscribeRepo: 'zaoscribe',
    zaoscribeTranscriptDir: 'data/transcripts',
    zaoscribeBranch: 'main',
  },
  openai: {
    // Optional fallback for Whisper API
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },
  audio: {
    dir: optional('AUDIO_DIR', '/tmp/zaoscribe-audio'),
    retentionHours: Number(optional('AUDIO_RETENTION_HOURS', '24')),
  },
  whisper: {
    modelPath: optional('WHISPER_MODEL_PATH', '/opt/whisper.cpp/models/ggml-medium.bin'),
    bin: optional('WHISPER_BIN', '/opt/whisper.cpp/build/bin/whisper-cli'),
  },
  behaviour: {
    confidenceAutoWrite: Number(optional('CONFIDENCE_AUTO_WRITE', '0.8')),
  },
  log: {
    level: optional('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  },
  storage: {
    // ~/.zaoscribe/ - persistent state outside /tmp
    home: optional('ZAOSCRIBE_HOME', `${process.env.HOME ?? '/root'}/.zaoscribe`),
  },
};

export function maskedConfigSummary(): string {
  return [
    `discord.guildId=${CONFIG.discord.guildId}`,
    `discord.coworkingVcId=${CONFIG.discord.coworkingVcId}`,
    `audio.dir=${CONFIG.audio.dir}`,
    `audio.retentionHours=${CONFIG.audio.retentionHours}`,
    `whisper.model=${CONFIG.whisper.modelPath}`,
    `confidenceAutoWrite=${CONFIG.behaviour.confidenceAutoWrite}`,
    `log=${CONFIG.log.level}`,
    `openai.fallback=${CONFIG.openai.apiKey ? 'enabled' : 'disabled'}`,
  ].join(' ');
}
