// Resolve Discord member -> ZAO Owner enum.
// Decision K (doc 674): auto-match by username/displayName, /scribe link as override.

import type { GuildMember } from 'discord.js';
import { OWNERS, type Owner } from './types.ts';
import { getLinkedOwner } from './storage.ts';

const OWNERS_LOWER = OWNERS.map((o) => ({ owner: o, lower: o.toLowerCase() }));

export async function discordIdToOwner(member: GuildMember): Promise<Owner> {
  // 1. Explicit /scribe link mapping wins.
  const linked = await getLinkedOwner(member.id);
  if (linked) return linked;

  // Bots get no owner mapping (they shouldn't be subscribed-to anyway).
  if (member.user.bot) return 'Open';

  const dn = (member.displayName ?? '').toLowerCase().trim();
  const un = (member.user.username ?? '').toLowerCase().trim();

  // 2. Exact display name match.
  for (const { owner, lower } of OWNERS_LOWER) {
    if (dn === lower) return owner;
  }
  // 3. Display name starts-with (e.g. "iman a" -> Iman).
  for (const { owner, lower } of OWNERS_LOWER) {
    if (dn.startsWith(`${lower} `) || dn.startsWith(`${lower}_`)) return owner;
  }
  // 4. Exact username match.
  for (const { owner, lower } of OWNERS_LOWER) {
    if (un === lower) return owner;
  }
  // 5. Username starts-with.
  for (const { owner, lower } of OWNERS_LOWER) {
    if (un.startsWith(lower)) return owner;
  }

  // Fallback - log + Open. User can /scribe link to fix.
  // eslint-disable-next-line no-console
  console.warn(`[zaoscribe] identity: no owner match for ${member.id} (dn="${member.displayName}", un="${member.user.username}") -> Open`);
  return 'Open';
}

// Validate an owner string (e.g. from /scribe link <name>).
export function canonicalizeOwnerName(raw: string): Owner | null {
  const lower = raw.trim().toLowerCase();
  const match = OWNERS_LOWER.find((o) => o.lower === lower);
  return match ? match.owner : null;
}
