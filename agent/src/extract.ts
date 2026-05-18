// Cascade extraction: Haiku 4.5 first, escalate to Opus 4.7 on low confidence
// / pronoun / relative-date / malformed JSON. Per doc 671 + 673-E decision.

import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, EXTRACT_TOOL, EXTRACTOR_PERSONA } from './llm/anthropic.ts';
import type { ExtractedItem, Owner } from './types.ts';
import { OWNERS } from './types.ts';

const HAIKU = 'claude-haiku-4-5-20251001';
const OPUS = 'claude-opus-4-7';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_DATE_TOKENS = /\b(today|tomorrow|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|end of)\b/i;

function readToolInput(resp: Anthropic.Message): { items: ExtractedItem[] } | null {
  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === 'extract_action_items') {
      return block.input as { items: ExtractedItem[] };
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
  const resp = await getAnthropic().messages.create({
    model,
    max_tokens: 2048,
    system,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_action_items' },
    messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }],
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

  // Tier 1 - Haiku
  let items: ExtractedItem[] = [];
  try {
    items = await callModel(HAIKU, transcript);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] extract: Haiku failed: ${(err as Error).message} - escalating`);
    // jump straight to Opus
    const opusItems = await callModel(OPUS, transcript);
    return { items: opusItems, modelChain: [HAIKU, OPUS], escalationReasons: ['haiku_error'] };
  }

  const { yes, reasons } = needsEscalation(items);
  if (!yes) {
    return { items, modelChain: [HAIKU], escalationReasons: [] };
  }

  // Tier 2 - Opus, with hint about WHY we re-asked.
  const hint = `The cheaper model returned items flagged for: ${reasons.join(', ')}. Be especially careful with relative dates (resolve to YYYY-MM-DD), pronouns (resolve to a specific Owner), and confidence scoring (under 0.7 for vague intent).`;
  try {
    const opusItems = await callModel(OPUS, transcript, hint);
    return { items: opusItems, modelChain: [HAIKU, OPUS], escalationReasons: reasons };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[zaoscribe] extract: Opus failed after Haiku flag: ${(err as Error).message} - keeping Haiku output`);
    return { items, modelChain: [HAIKU], escalationReasons: reasons.concat('opus_error') };
  }
}
