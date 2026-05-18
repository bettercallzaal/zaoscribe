# ZAOscribe - Setup Checklist

End-to-end checklist to take ZAOscribe from a fresh repo to a working Discord bot. All code is built; this is the operator runbook for the things only you can do.

Spec: [ZAOOS doc 674](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/674-zaoscribe-discord-best-plan/README.md).

---

## Section 1 - Discord setup (do once, ~5 min)

### 1.1 Create the Discord application + bot

1. Go to https://discord.com/developers/applications
2. New Application -> name it "ZAOscribe"
3. **General Information** tab:
   - Copy **Application ID** -> save as `DISCORD_CLIENT_ID`
4. **Bot** tab:
   - Click "Reset Token", confirm, copy the new token -> save as `DISCORD_TOKEN`
   - Under "Privileged Gateway Intents": enable **MESSAGE CONTENT INTENT**, **SERVER MEMBERS INTENT**, **PRESENCE INTENT** (the first two are needed; presence is harmless)
5. **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - `View Channels`
     - `Send Messages`
     - `Read Message History`
     - `Embed Links`
     - `Attach Files`
     - `Use External Emojis`
     - `Connect` (to voice channels)
     - `Speak` (so the bot can be in voice, even though it stays muted)
     - `Use Voice Activity`
     - `Change Nickname` (for the `[REC]` indicator)
     - `Manage Messages` (for cleaning up its own stale messages)
6. Copy the generated URL, open in browser, select your ZAO Discord server, **Authorize**

### 1.2 Get the Discord IDs

In Discord, enable **Developer Mode** (User Settings -> Advanced -> Developer Mode ON).

1. Right-click your server name -> **Copy Server ID** -> save as `DISCORD_GUILD_ID`
2. Create (or pick) a dedicated voice channel for cowork captures. Suggested name: `#zao-coworking` or `voice-cowork`
3. Right-click that voice channel -> **Copy Channel ID** -> save as `DISCORD_COWORKING_VC_ID`

---

## Section 2 - GitHub PATs (do once, ~3 min)

Two fine-grained PATs. NARROW SCOPING IS CRITICAL - the bot only writes 2 file paths.

### 2.1 Cowork actions PAT (writes to cowork-zaodevz)

1. https://github.com/settings/personal-access-tokens/new
2. Token name: `zaoscribe-cowork-write`
3. Expiration: 1 year (set a reminder; rotate annually)
4. Resource owner: `songchaindao-dot`
5. Repository access: **Only select repositories** -> `cowork-zaodevz`
6. Repository permissions:
   - **Contents**: Read and write
7. Generate, copy -> save as `COWORK_GITHUB_TOKEN`

### 2.2 Zaoscribe transcripts PAT (writes to bettercallzaal/zaoscribe)

1. https://github.com/settings/personal-access-tokens/new
2. Token name: `zaoscribe-transcripts-write`
3. Expiration: 1 year
4. Resource owner: `bettercallzaal`
5. Repository access: **Only select repositories** -> `zaoscribe`
6. Repository permissions:
   - **Contents**: Read and write
7. Generate, copy -> save as `ZAOSCRIBE_GITHUB_TOKEN`

---

## Section 3 - OpenRouter API key

ZAOscribe uses OpenRouter (OpenAI-compatible API) as the gateway for extraction. Single key, Anthropic Haiku/Opus models under the hood (and easy fallback to other providers later via a one-line config change).

1. https://openrouter.ai/keys
2. Sign in (Google/GitHub/email)
3. Top up some credits at https://openrouter.ai/credits (start with $10; ZAOscribe burns ~$1/month at 10 captures/day)
4. Click **Create Key**, name it `zaoscribe`
5. Optional but recommended: set a per-key spend cap so a runaway can't drain your wallet. Suggestion: $5/month soft cap, $20/month hard cap.
6. Copy the key (starts with `sk-or-v1-...`) -> save as `OPENROUTER_API_KEY`

The cascade defaults to `anthropic/claude-haiku-4-5` first, escalates to `anthropic/claude-opus-4-7` on low-confidence transcripts. Change models in `agent/src/llm/openrouter.ts` if you ever want to switch providers.

---

## Section 4 - OpenAI Whisper API fallback (optional but recommended)

Used only when local Whisper.cpp errors on a clip. ~$0.006/min when it kicks in.

1. https://platform.openai.com/api-keys
2. Create new secret key, name it `zaoscribe-whisper-fallback`
3. Save as `OPENAI_API_KEY`

Skip this section if you want to keep the bot fully local; the pipeline degrades gracefully when fallback is absent (just returns an empty transcript on the rare failure).

---

## Section 5 - VPS deployment

The bot deploys to your existing VPS (Hostinger KVM 2, `187.77.3.104`) as a systemd user unit, alongside `zaocoworking-bot.service`.

### 5.1 First-time install (~10 min including the ~1.5 GB Whisper model download)

```bash
# 1. SSH in
ssh root@187.77.3.104

# 2. Clone the repo
git clone https://github.com/bettercallzaal/zaoscribe.git /root/zaoscribe
cd /root/zaoscribe

# 3. Install Whisper.cpp + the multilingual model (~5 min, downloads 1.5 GB)
chmod +x scripts/install-whisper.sh
./scripts/install-whisper.sh

# 4. Set up env
cp .env.example .env
chmod 600 .env
vi .env
# Paste in all 7 required vars from sections 1-4 above
# (DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DISCORD_COWORKING_VC_ID,
#  OPENROUTER_API_KEY, COWORK_GITHUB_TOKEN, ZAOSCRIBE_GITHUB_TOKEN)
# Optional: OPENAI_API_KEY  (Whisper fallback)

# 5. Install node deps
cd /root/zaoscribe/agent
npm install

# 6. Push slash commands to Discord (one-shot)
npm run register

# 7. Install systemd unit
mkdir -p ~/.config/systemd/user
cp /root/zaoscribe/infra/zaoscribe.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now zaoscribe.service

# 8. Verify
systemctl --user is-active zaoscribe.service
# expect: active

journalctl --user -u zaoscribe.service -n 30 --no-pager
# expect: "[zaoscribe] online as @ZAOscribeBot#xxxx"
```

### 5.2 Subsequent deploys (after merged PRs)

```bash
ssh root@187.77.3.104
cd /root/zaoscribe
git pull origin main
cd agent && npm install
systemctl --user restart zaoscribe.service
journalctl --user -u zaoscribe.service -n 20 --no-pager
```

---

## Section 6 - Roster pre-warm (do once before first capture)

The bot's identity mapping is automatic for users whose Discord display name matches a roster owner (Zaal, Iman, ThyRev, Samantha). If anyone's display name doesn't match cleanly:

1. They join the server
2. They run `/scribe link Iman` (or their name) - one-time, self-service
3. Done

If you want to PRE-fill the map (so no one has to run /scribe link), edit `~/.zaoscribe/links.json` on the VPS:

```json
{
  "DISCORD_USER_ID_FOR_ZAAL": "Zaal",
  "DISCORD_USER_ID_FOR_IMAN": "Iman",
  "DISCORD_USER_ID_FOR_THYREV": "ThyRev",
  "DISCORD_USER_ID_FOR_SAMANTHA": "Samantha"
}
```

Grab each user's Discord ID by right-clicking their name with Developer Mode on -> Copy User ID.

---

## Section 7 - First-time test plan (~5 min, after deploy)

In Discord:

1. **Sanity check**: type `/scribe status` -> expect "Idle. No active capture."
2. **Identity**: type `/scribe link Zaal` (or your roster name) -> expect "Linked your Discord ID..."
3. **Live capture**: join your `#zao-coworking` voice channel. Bot should AUTO-JOIN within a couple seconds (you'll see its nickname change to `[REC] @ZAOscribeBot`).
4. **Speak**: say something like _"Let's add an item for Iman: ship v2.14 to VPS by Wednesday"_
5. **Stop**: Leave the voice channel (auto-leave will fire when you're the last roster member). OR type `/scribe stop` in any channel.
6. **Wait ~10 sec**: bot replies in the VC's text-chat with:
   - `Capture cap-... complete. Duration: Xs. Speakers: 1. Language: en.`
   - `Added 1 item(s) to cowork: #N`
   - `Transcript: https://github.com/bettercallzaal/zaoscribe/blob/main/data/transcripts/...`
7. **Verify**: in Telegram, ask @ZAOcoworkingBot `/mine` (as Iman) - the new item should appear.

If any step fails, check:
- `journalctl --user -u zaoscribe.service -n 100 --no-pager` (VPS logs)
- `/scribe status` (current state)
- `/scribe last` (recent captures + their IDs)

---

## Section 8 - Operating routines

### Adding a new team member

1. They join the Discord server
2. Add them to `cowork-zaodevz/data/team.json` (via the cowork bot's `/adduser <tg_id> <Name>` if they're also on Telegram, OR edit team.json directly + commit)
3. They run `/scribe link <Name>` once - that's it

### Adding a new auto-join VC

The bot only auto-joins ONE VC (the one in `DISCORD_COWORKING_VC_ID`). If you want a second auto-join VC, that's a small code change - file an issue.

For now, members can use `/scribe start` in any other VC they want captured.

### Cost monitoring

```bash
# OpenRouter usage dashboard:
#   https://openrouter.ai/activity
# Look for the days when ZAOscribe was active. Cascade keeps ~70% on Haiku.
# Per-key spend caps live at https://openrouter.ai/keys -> Edit on your zaoscribe key.

# OpenAI Whisper fallback usage:
#   https://platform.openai.com/usage
# This should be near zero unless local Whisper has accent issues.
```

### Pruning old transcripts (optional)

After a year of operation, `data/transcripts/` will have ~5-20 MB of markdown files. They're git-tracked and tiny - leave them as institutional memory. If you really want to prune:

```bash
ssh root@187.77.3.104
cd /root/zaoscribe
git rm -rf data/transcripts/2025-*  # or whichever month
git commit -m "prune: archive 2025 transcripts"
git push
```

---

## Section 9 - Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Bot starts then immediately exits | Missing env var | Check `journalctl ... -n 50` for `Missing required env var:` line |
| Bot online but `/scribe` commands don't appear | `npm run register` not run yet | Run it (Section 5.1 step 6); Discord caches for a minute |
| Bot joins VC but no transcript | Whisper.cpp not installed | Re-run `scripts/install-whisper.sh` |
| `data/actions.json` write failed | PAT scope too narrow OR token expired | Regenerate `COWORK_GITHUB_TOKEN` per Section 2.1 |
| Transcript commit failed | `ZAOSCRIBE_GITHUB_TOKEN` problem | Regenerate per Section 2.2 |
| Bot in wrong nickname state (stuck on `[REC]`) | Crash before nickname restore | Manually rename in server settings; will self-correct on next capture cycle |
| Iman doesn't show up as owner | Display name mismatch | Iman runs `/scribe link Iman` once |
| Auto-join not firing | Wrong `DISCORD_COWORKING_VC_ID` | Re-copy from Discord, restart bot |

---

## Section 10 - Linked docs

- ZAOOS [doc 674](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/674-zaoscribe-discord-best-plan/README.md) - canonical spec
- ZAOOS [doc 673](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/673-zao-craig-spec-live-audio-todo/README.md) - SUPERSEDED Telegram architecture (kept for reference)
- ZAOOS [doc 671](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/671-llm-fictional-permission-hallucination-fixes/README.md) - why we use Anthropic API + tool_choice
- ZAOOS [doc 672](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/672-zaocoworking-bot-audit-postv213/README.md) - cowork SHA-dance pattern + PAT scoping rule
- ZAOOS [doc 670](https://github.com/bettercallzaal/ZAOOS/blob/main/research/agents/670-iman-call-may18-craig-pizzadao/README.md) - the Iman call that seeded this whole thing
