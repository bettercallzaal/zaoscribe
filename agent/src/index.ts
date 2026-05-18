// ZAOscribe entry point.
//
// 1. Validates env (config.ts throws if anything missing)
// 2. Logs in to Discord
// 3. Registers interactionCreate (slash) + voiceStateUpdate (auto-join) listeners
// 4. Starts the 24h audio cleanup cron
// 5. Refuses to operate in any guild other than CONFIG.discord.guildId
//
// Spec: ZAOOS research/agents/674-zaoscribe-discord-best-plan/

import { Client, Events, GatewayIntentBits, Partials, type Interaction } from 'discord.js';
import { CONFIG, maskedConfigSummary } from './config.ts';
import { dispatch } from './commands/index.ts';
import { registerAutoJoin } from './auto-join.ts';
import { startCleanupCron } from './cleanup.ts';
import { handleConfirmButton } from './confirm-flow.ts';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[zaoscribe] booting - ${maskedConfigSummary()}`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    // eslint-disable-next-line no-console
    console.log(`[zaoscribe] online as @${c.user.tag} (id=${c.user.id})`);
  });

  // Refuse to operate in any guild other than the configured one.
  client.on(Events.GuildCreate, async (guild) => {
    if (guild.id !== CONFIG.discord.guildId) {
      // eslint-disable-next-line no-console
      console.warn(`[zaoscribe] guild-guard: leaving unrelated guild ${guild.id} (${guild.name})`);
      try { await guild.leave(); } catch { /* ignore */ }
    }
  });

  // Slash commands + button interactions.
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isButton()) {
        await handleConfirmButton(interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.guildId && interaction.guildId !== CONFIG.discord.guildId) {
        await interaction.reply({ content: 'Wrong guild.', ephemeral: true });
        return;
      }
      await dispatch(interaction);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[zaoscribe] interaction: ${(err as Error).message}`);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `Error: ${(err as Error).message.slice(0, 200)}`, ephemeral: true }).catch(() => { /* ignore */ });
      }
    }
  });

  // Auto-join coworking VC listener (Decision J - hybrid trigger).
  registerAutoJoin(client);

  // 24h audio cleanup cron (Decision D).
  startCleanupCron();

  // Reconnect / shutdown handling.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      // eslint-disable-next-line no-console
      console.log(`[zaoscribe] ${sig} received, shutting down`);
      client.destroy().catch(() => { /* ignore */ });
      process.exit(0);
    });
  }

  await client.login(CONFIG.discord.token);
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(`[zaoscribe] FATAL: ${err.message}`);
  process.exit(1);
});
