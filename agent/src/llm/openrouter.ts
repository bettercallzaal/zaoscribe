// OpenRouter client for action extraction.
// Uses the OpenAI SDK pointed at OpenRouter's base URL (OpenAI-compatible).
// Single key, Anthropic Haiku/Opus models, easy provider fallback later.

import OpenAI from 'openai';
import { CONFIG } from '../config.ts';

let cached: OpenAI | null = null;
export function getOpenRouter(): OpenAI {
  if (!CONFIG.openrouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY not set - extraction disabled. Add it to .env + restart.');
  }
  cached ??= new OpenAI({
    apiKey: CONFIG.openrouter.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // OpenRouter recommends these for traffic attribution + leaderboard.
      'HTTP-Referer': 'https://github.com/bettercallzaal/zaoscribe',
      'X-Title': 'ZAOscribe',
    },
  });
  return cached;
}

// Model IDs on OpenRouter (provider/model-slug). Update if Anthropic releases
// newer versions. Cascade defaults: Haiku first (cheap), Opus fallback (smart).
export const HAIKU_MODEL = 'anthropic/claude-haiku-4-5';
export const OPUS_MODEL = 'anthropic/claude-opus-4-7';

// OpenAI-compatible tool definition. OpenRouter forwards tool_choice to the
// underlying provider; for Anthropic models this maps to their tool_use feature.
// Strict schema mirrors types.ts ExtractedItem.
export const EXTRACT_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_action_items',
    description:
      'Emit zero or more action items extracted from the transcript. Items must be concrete (verb + object), not idle chatter. Owner MUST be one of Zaal, Iman, Both, ThyRev, Samantha, or Open. Due dates MUST be YYYY-MM-DD format or empty string. Confidence reflects how certain you are this is a real commitment vs filler talk.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Action verb + object, e.g. "ship v2.14 to VPS"' },
              owner: { type: 'string', enum: ['Zaal', 'Iman', 'Both', 'ThyRev', 'Samantha', 'Open'] },
              due: { type: 'string', description: 'YYYY-MM-DD or empty string' },
              notes: { type: 'string', description: 'context from the transcript' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['title', 'owner', 'due', 'notes', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
};

export const EXTRACTOR_PERSONA = `You are an action-item extraction service for the ZAO core team (Zaal, Iman, ThyRev, Samantha).

INPUT: a multi-speaker transcript of a Discord voice channel. Each line is prefixed with the speaker's Owner name in brackets, e.g. "[Zaal] let's ship v2.14 today".

OUTPUT: call the extract_action_items tool with a list of items. ZERO items is a valid answer if the transcript is pure social chat.

RULES:
- An action item is a concrete commitment: someone is going to do something. Not idle chatter, not opinions, not questions.
- Owner is the person responsible. If "Iman, can you do X" - owner is Iman. If "let's do X together" - owner is Both. If unclear - Open.
- Due dates: only emit if the transcript names a date or relative day. "Wednesday" with today=2026-05-18 -> 2026-05-21. "End of next week" -> last day of that week. Otherwise empty string.
- Confidence: 0.9+ when explicit ("I'll do X by Friday"), 0.7-0.9 when implied ("we should X"), under 0.7 for vague ("maybe we could").
- Brand spellings: WaveWarZ, COC Concertz, The ZAO, BetterCallZaal, ZABAL, ZOE, ZOLs, FISHBOWLZ.
- No emojis. No em dashes (use hyphens).`;
