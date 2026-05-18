// Shared domain types. ActionItem + Owner mirror cowork-zaodevz/agent/src/types.ts
// VERBATIM so we can round-trip through the shared data/actions.json safely.

export type Owner = 'Zaal' | 'Iman' | 'Both' | 'ThyRev' | 'Samantha' | 'Open';
export type ActionStatus = 'TODO' | 'WIP' | 'BLOCKED' | 'DONE';
export type Priority = 'P1' | 'P2' | 'P3';
export type Phase = 'Define' | 'Measure' | 'Analyze' | 'Improve' | 'Control';

export const OWNERS: readonly Owner[] = ['Zaal', 'Iman', 'Both', 'ThyRev', 'Samantha', 'Open'];

export interface ActionItem {
  id: string;
  title: string;
  createdBy: string;
  owner: Owner;
  status: ActionStatus;
  category: string;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  completedAt: string;
  completedBy: string;
  phase: Phase;
  due: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActionsFile {
  updatedAt: string;
  items: ActionItem[];
}

// LLM extraction shape - what the cascade emits per item.
export interface ExtractedItem {
  title: string;
  owner: Owner;
  due: string;         // YYYY-MM-DD or ''
  notes: string;
  confidence: number;  // 0..1
}

// One capture session = one Discord VC visit OR one upload.
export interface Capture {
  captureId: string;
  startedAt: string;
  endedAt: string;
  guildId: string;
  channelId: string;
  triggerType: 'auto-join' | 'slash-start' | 'upload';
  speakerIds: string[];     // Discord user IDs
  speakerOwners: Record<string, Owner>;  // userId -> resolved Owner
  transcript: string;       // concatenated, speaker-labeled
  language: string;         // ISO code from Whisper
  durationSec: number;
  extractedItemIds: string[];   // cowork action IDs created
  queuedItemCount: number;      // confidence < threshold count
  transcriptGithubUrl: string;
}

export interface PerSpeakerSegment {
  userId: string;
  owner: Owner;
  startTime: number;       // ms epoch
  audioPath: string;       // /tmp/zaoscribe-audio/<userId>-<ts>.opus
  text?: string;           // populated after transcribe
}
