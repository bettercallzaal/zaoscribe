// Cascade extraction via OpenRouter (Anthropic Haiku 4.5 -> Opus 4.7).
// Haiku handles ~70% of transcripts; Opus escalation on low confidence,
// pronouns, relative dates, or malformed JSON.
//
// Per doc 671/673-E: tool_choice forces the model to ONLY emit the tool call.
// OpenRouter forwards this to Anthropic's tool_use feature for these models.

import type OpenAI from 'openai';
import { getOpenRouter, EXTRACT_TOOL, EXTRACTOR_PERSONA, HAIKU_MODEL, OPUS_MODEL } from './llm/openrouter.ts';
import type { ExtractedItem, Owner } from './types.ts';
import { OWNERS } from './types.ts';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_DATE_TOKENS = /\b(today|tomorrow|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|end of)\b/i;

function readToolInput(resp: OpenAI.Chat.ChatCompletion): { items: ExtractedItem[] } | null {
  const msg = resp.choices?.[0]?.message;
  if (!msg) return null;
  const calls = msg.tool_calls ?? [];
  for (const call of calls) {
    if (call.type !== 'function') continue;
    if (call.function?.name !== 'extract_action_items') continue;
    try {
      return JSON.parse(call.function.arguments) as { items: ExtractedItem[] };
    } catch {
      return null;
    }
  }
  return null;
}

function validateItem(it: unknown): it is ExtractedItem {
  if (typeof it !== 'object' || it === null) return false;
  const o = it as Record<string, unknown>;
  if (typeof o.title !== 'string' || !o.title.trim()) return false;
  if (typeof o.owner !== 'string' || !(OWNERS as readonly string[]).includes(o.owner)) return false;
  if (typeof o.due !== 'string') return false;
  if (typeof o.notes !== 'string') return false;
  if (typeof o.confidence !== 'number' || o.confidence < 0 || o.confidence > 1) return false;
  return true;
}

function needsEscalation(items: ExtractedItem[]): { yes: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (items.length === 0) return { yes: false, reasons };
  for (const it of items) {
    if (it.confidence < 0.75) { reasons.push('low_confidence'); break; }
  }
  for (const it of items) {
    if (it.due && !ISO_DATE_RE.test(it.due)) { reasons.push('malformed_due'); break; }
    if (RELATIVE_DATE_TOKENS.test(it.title) || RELATIVE_DATE_TOKENS.test(it.notes)) { reasons.push('relative_date_text'); break; }
    if (/\b(they|them|he|she|him|her)\b/i.test(it.title)) { reasons.push('pronoun_in_title'); break; }
  }
  return { yes: reasons.length > 0, reasons };
}

async function callModel(model: string, transcript: string, escalationHint?: string): Promise<ExtractedItem[]> {
  const system = EXTRACTOR_PERSONA + (escalationHint ? `\n\n${escalationHint}` : '');
  const resp = await getOpenRouter().chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Transcript:\n\n${transcript}` },
    ],
    tools: [EXTRACT_TOOL],
    // Force this exact tool. OpenRouter forwards to Anthropic's tool_choice.
    tool_choice: { type: 'function', function: { name: 'extract_action_items' } },
  });
  const out = readToolInput(resp);
  if (!out) return [];
  const valid = (out.items ?? []).filter(validateItem);
  return valid;
}

export interface ExtractionResult {
  items: ExtractedItem[];
  modelChain: string[];        // ['haiku'] or ['haiku', 'opus']
  escalationReasons: string[]; // why Opus was called
}

export async function extractActionItems(transcript: string): Promise<ExtractionResult> {
  if (!transcript.trim()) return { items: [], modelChain: [], escalationReasons: [] };

  // Tier 1 - Haiku via OpenRouter
  let items: ExtractedItem[] = [];
  try {
    items = await callModel(HAIKU_MODEL, transcript);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] extract: Haiku failed: ${(err as Error).message} - escalating`);
    const opusItems = await callModel(OPUS_MODEL, transcript);
    return { items: opusItems, modelChain: [HAIKU_MODEL, OPUS_MODEL], escalationReasons: ['haiku_error'] };
  }

  const { yes, reasons } = needsEscalation(items);
  if (!yes) {
    return { items, modelChain: [HAIKU_MODEL], escalationReasons: [] };
  }

  // Tier 2 - Opus via OpenRouter, with hint about WHY we re-asked.
  const hint = `The cheaper model returned items flagged for: ${reasons.join(', ')}. Be especially careful with relative dates (resolve to YYYY-MM-DD), pronouns (resolve to a specific Owner), and confidence scoring (under 0.7 for vague intent).`;
  try {
    const opusItems = await callModel(OPUS_MODEL, transcript, hint);
    return { items: opusItems, modelChain: [HAIKU_MODEL, OPUS_MODEL], escalationReasons: reasons };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] extract: Opus failed after Haiku flag: ${(err as Error).message} - keeping Haiku output`);
    return { items, modelChain: [HAIKU_MODEL], escalationReasons: reasons.concat('opus_error') };
  }
}
