# ZAOscribe

Discord audio capture bot for the ZAO core team. Joins voice channels, transcribes per-speaker audio via Whisper.cpp, extracts action items via Anthropic cascade (Haiku 4.5 -> Opus 4.7), and writes them to the shared cowork-zaodevz action tracker.

Spec: [ZAOOS doc 674](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/674-zaoscribe-discord-best-plan/README.md). Supersedes doc 673 (Telegram architecture, abandoned).

## Status

Phases 1-7 implementation complete. Awaiting Discord credentials + VPS deploy. See [SETUP.md](./SETUP.md) for the operator checklist.

## How it works

```
[user in #zao-coworking VC speaks]
  -> @discordjs/voice subscribes per-speaker stream
  -> .opus per utterance saved to /tmp/zaoscribe-audio/
  -> ffmpeg normalises to 16kHz mono PCM WAV
  -> whisper.cpp ggml-medium.bin transcribes (multilingual)
  -> Anthropic cascade extracts action items
       (Haiku 4.5 first; Opus 4.7 escalation on low-confidence)
  -> >= 0.8 confidence auto-writes to
       songchaindao-dot/cowork-zaodevz/data/actions.json
       (Octokit SHA-dance, 3x retry)
  -> < 0.8 confidence DMs the owner with confirm button
  -> Transcript .md committed to
       bettercallzaal/zaoscribe/data/transcripts/<YYYY-MM>/<captureId>.md
  -> Reply in original channel with summary + item IDs
  -> 24h cron sweeps /tmp/zaoscribe-audio/ -> delete raw .opus + .wav
```

## Slash commands

| Command | Behaviour |
|---------|-----------|
| `/scribe start` | Bot joins your current VC, starts capture |
| `/scribe stop` | Bot finishes current speaker, processes all audio, leaves VC |
| `/scribe link <name>` | Self-only: map your Discord ID to a roster name (overrides auto-match) |
| `/scribe upload` | Process an attached voice message (async, no live VC needed) |
| `/scribe last` | Show last 5 captures + their extracted item IDs |
| `/scribe transcript <id>` | Reply with GitHub link to the transcript |
| `/scribe status` | Current recording state, active VC, speakers, elapsed |
| `/scribe delete <id>` | Self-only: remove that captureId's audio + transcript + best-effort remove items |
| `/scribe optout` | Per-user opt-out from all future recordings |

## Hybrid trigger

- In the dedicated `#zao-coworking` voice channel: bot **auto-joins** the moment any allowed user speaks. Auto-leaves when last allowed user departs.
- In any other VC: bot waits for explicit `/scribe start`.

## Auto-match identity

Discord display name (case-insensitive) -> roster name in `OWNERS = ['Zaal','Iman','ThyRev','Samantha','Both','Open']`. If your Discord display name is "iman" or "Iman Afrikah" -> auto-maps to `Iman`. Run `/scribe link <name>` once if the auto-match misses.

## Cost ceiling

| Volume | $/mo |
|--------|------|
| 10 captures/day x 90s | ~$1 |
| 30/day x 90s | ~$3.50 |
| 100/day x 5min (heavy real meetings) | ~$20 |

All within budget. Hardware: Hostinger KVM 2 (existing) + 1.5 GB disk for Whisper model.

## Tech

- discord.js v14 + @discordjs/voice v0.18 (per-speaker subscribe)
- Whisper.cpp ggml-medium.bin (1.5 GB, multilingual local)
- Anthropic SDK + cascade: Haiku 4.5 -> Opus 4.7, `tool_choice: {type: 'tool', name: 'extract_action_items'}`
- @octokit/rest v21 (SHA-dance on cowork-zaodevz/data/actions.json)
- node-cron (24h audio sweep)
- TypeScript 5.6, ES2022, node 22+

## Repo layout

```
zaoscribe/
├── README.md, CLAUDE.md, SETUP.md
├── .env.example, .gitignore
├── agent/
│   ├── package.json, tsconfig.json
│   └── src/
│       ├── index.ts                    # discord.js entry
│       ├── config.ts                   # env validation
│       ├── types.ts                    # Owner, ExtractedItem, etc.
│       ├── identity.ts                 # auto-match + /scribe link
│       ├── storage.ts                  # JSON storage (links, optouts, last-captures)
│       ├── voice.ts                    # join VC + receiver.subscribe loop
│       ├── audio-store.ts              # /tmp/zaoscribe-audio/ file management
│       ├── presence.ts                 # nickname [REC] toggle
│       ├── auto-join.ts                # coworking-VC auto-join listener
│       ├── transcribe.ts               # ffmpeg + whisper.cpp wrapper
│       ├── llm/
│       │   └── anthropic.ts            # Anthropic client + tool def
│       ├── extract.ts                  # cascade Haiku -> Opus
│       ├── cowork-write.ts             # Octokit SHA-dance to cowork actions.json
│       ├── transcript-write.ts         # Octokit commit transcript .md to own repo
│       ├── confirm-flow.ts             # inline-button DM for low-confidence
│       ├── cleanup.ts                  # 24h audio sweep cron
│       ├── reconnect.ts                # WS retry + exponential backoff
│       ├── fallback-transcribe.ts      # OpenAI Whisper API fallback
│       └── commands/
│           ├── start.ts, stop.ts, link.ts, upload.ts,
│           ├── last.ts, transcript.ts, status.ts,
│           ├── delete.ts, optout.ts
├── data/
│   └── transcripts/                    # markdown frontmatter + body, git-tracked
├── scripts/
│   ├── install-whisper.sh              # compile whisper.cpp + download model
│   └── register-commands.ts            # one-shot push slash commands to Discord
└── infra/
    └── zaoscribe.service               # systemd user unit
```

## Privacy

- Bot nickname becomes `@ZAOscribeBot [REC]` while recording; reverts on stop
- Entry announcement in the VC channel
- Per-guild scope (refuses other servers)
- Per-user `/scribe optout` blacklist
- Music-bot audio filtered (`member.user.bot === true`)
- 24h raw audio retention, transcripts kept indefinitely
- GDPR-style `/scribe delete <captureId>` removes user's audio + transcript + best-effort the items
