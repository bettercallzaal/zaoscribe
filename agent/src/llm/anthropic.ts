// Anthropic SDK client + tool schema for extraction.
// Per doc 671 + doc 673/674: tool_choice forces the model to ONLY emit the
// tool call. No prose preamble, no fictional permission dialogs.

import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../config.ts';

let cached: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  cached ??= new Anthropic({ apiKey: CONFIG.anthropic.apiKey });
  return cached;
}

// Strict schema mirrors types.ts ExtractedItem.
export const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_action_items',
  description:
    'Emit zero or more action items extracted from the transcript. Items must be concrete (verb + object), not idle chatter. Owner MUST be one of Zaal, Iman, Both, ThyRev, Samantha, or Open. Due dates MUST be YYYY-MM-DD format or empty string. Confidence reflects how certain you are this is a real commitment vs filler talk.',
  input_schema: {
    type: 'object' as const,
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
        },
      },
    },
    required: ['items'],
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
