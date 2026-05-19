# CLAUDE.md - ZAOscribe

## Session Start

Invoke `/worksession` before any work. Each terminal gets its own `ws/` branch.

## What This Is

ZAOscribe is a Discord audio capture bot. It joins voice channels, transcribes per-speaker audio, extracts action items via LLM, and writes them to its OWN action tracker at `bettercallzaal/zaoscribe/data/actions.json`. Spec at ZAOOS `research/agents/674-zaoscribe-discord-best-plan/`.

v0.3+ - self-hosted action tracker (was cross-org write to cowork-zaodevz in v0.1-0.2; dropped to remove org-PAT dependency). Same JSON schema as cowork-zaodevz so a sync layer can bridge the two later if both bots need shared state.

## Stack

- Node 22+, TypeScript 5.6, ES2022, ESM
- discord.js v14.16+ + @discordjs/voice v0.18+ + @discordjs/opus
- openai SDK (pointed at OpenRouter's OpenAI-compatible endpoint)
- @octokit/rest v21
- node-cron
- dotenv
- Whisper.cpp installed on VPS (not a node dep; shell-out)

## Commands

```bash
cd agent
npm install
npm run typecheck    # tsc --noEmit
npm run dev          # tsx watch src/index.ts
npm start            # tsx src/index.ts  (production)
```

## Conventions

- No emojis in code or output. Use text labels (e.g. `[REC]`).
- No em dashes. Use hyphens.
- All env vars validated at module load in `config.ts`. Throw early if missing.
- All Discord API calls wrapped in try/catch with logged context.
- Octokit writes use SHA-dance with 3x retry (mirror `cowork-zaodevz/agent/src/actions-store.ts`).
- All file paths use `node:path` `join()`. Never string-concat.

## Architecture

See `README.md`. Top-level flow:

```
discord.js voiceStateUpdate / interactionCreate
  -> voice.ts capture loop
  -> audio-store.ts per-speaker .opus
  -> transcribe.ts ffmpeg + whisper.cpp
  -> extract.ts cascade Haiku -> Opus
  -> cowork-write.ts Octokit SHA-dance to cowork-zaodevz
  -> transcript-write.ts commit transcript .md to own repo
  -> confirm-flow.ts (for low-confidence items)
  -> presence.ts nickname [REC] toggle off
```

## Safety

- NEVER expose `DISCORD_TOKEN`, `OPENROUTER_API_KEY`, `ZAOSCRIBE_GITHUB_TOKEN`, `OPENAI_API_KEY` (fallback)
- Hard-coded `GUILD_ID` env check at startup - bot refuses to operate in any other guild
- Filter `member.user.bot === true` before subscribing to anyone's audio
- Roster gate before any audio capture (only Zaal/Iman/ThyRev/Samantha)
- Per-user `/scribe optout` blacklist persists across restarts
- 24h cron sweep + systemd `ExecStopPost=rm -rf /tmp/zaoscribe-audio` for crash safety

## Identity Map

`identity.ts:discordIdToOwner(member)` resolves Discord member to ZAO Owner enum:

1. Explicit `/scribe link` mapping (in `~/.zaoscribe/links.json`)
2. Display name case-insensitive match against OWNERS
3. Display name starts-with match (e.g. "iman a" -> Iman)
4. Username case-insensitive match against OWNERS
5. Fallback: `Open` + log warning

Owners: `['Zaal', 'Iman', 'Both', 'ThyRev', 'Samantha', 'Open']` (matches cowork-zaodevz `types.ts`).

## Cost Model

OpenRouter cascade (Anthropic models, +~5% OpenRouter markup) is the main spend:
- anthropic/claude-haiku-4-5: $0.21 / $1.05 per M tok (with OR markup)
- anthropic/claude-opus-4-7:  $15.75 / $78.75 per M tok (with OR markup)
- ~60-70% of transcripts handled by Haiku alone

At 10 captures/day, 90s avg, ~$1-1.05/mo. Local Whisper.cpp = $0.

## Deployment

VPS: Hostinger KVM 2 (187.77.3.104) - existing, shared with @ZAOcoworkingBot.

```bash
ssh root@187.77.3.104
cd /root/zaoscribe
git pull origin main
cd agent && npm install
systemctl --user restart zaoscribe.service
```

See `SETUP.md` for first-time install.

## Linked Docs

- ZAOOS `research/agents/674-zaoscribe-discord-best-plan/` - canonical spec
- ZAOOS `research/agents/673-zao-craig-spec-live-audio-todo/` - SUPERSEDED Telegram version
- ZAOOS `research/agents/671-llm-fictional-permission-hallucination-fixes/` - why we use Anthropic API + tool_choice
- ZAOOS `research/agents/672-zaocoworking-bot-audit-postv213/` - cowork SHA-dance pattern + SEC.1 PAT scoping rule
