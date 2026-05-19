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
  openrouter: {
    // v0.3.1: optional at boot so the bot can connect to Discord + capture
    // audio for testing before extraction is wired. Empty = extraction step
    // throws a clear error at call time; the pipeline degrades gracefully.
    apiKey: optional('OPENROUTER_API_KEY', ''),
  },
  github: {
    // v0.3+: one PAT for both actions + transcripts on bettercallzaal/zaoscribe.
    // Dropped the cross-org cowork PAT - keeps setup simpler + no Iman approval
    // dependency. Same JSON schema as cowork-zaodevz so a sync layer can be
    // added later if both bots need to share state.
    // v0.3.1: optional at boot - empty = action/transcript writes throw a
    // clear error at call time, bot still boots + records.
    zaoscribeToken: optional('ZAOSCRIBE_GITHUB_TOKEN', ''),
    zaoscribeOwner: 'bettercallzaal',
    zaoscribeRepo: 'zaoscribe',
    zaoscribeBranch: 'main',
    actionsPath: 'data/actions.json',
    zaoscribeTranscriptDir: 'data/transcripts',
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
    `openrouter=${CONFIG.openrouter.apiKey ? 'enabled' : 'NOT SET (extraction disabled)'}`,
    `github=${CONFIG.github.zaoscribeToken ? 'enabled' : 'NOT SET (writes disabled)'}`,
    `openai.fallback=${CONFIG.openai.apiKey ? 'enabled' : 'disabled'}`,
  ].join(' ');
}
