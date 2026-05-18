// One-shot push of slash commands to Discord. Run once after `npm install`
// and any time you change command shapes.
//   npm run register

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { CONFIG } from '../src/config.ts';

const cmd = new SlashCommandBuilder()
  .setName('scribe')
  .setDescription('ZAOscribe - audio capture + action extract for the ZAO team')
  .addSubcommand((sc) =>
    sc.setName('start').setDescription('Bot joins your current voice channel and starts capturing'),
  )
  .addSubcommand((sc) =>
    sc.setName('stop').setDescription('Stop the current capture, transcribe, and write items'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('link')
      .setDescription('Map your Discord ID to a roster name (Zaal, Iman, ThyRev, Samantha)')
      .addStringOption((o) => o.setName('name').setDescription('Roster name').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('upload')
      .setDescription('Process an attached voice/audio file')
      .addAttachmentOption((o) => o.setName('file').setDescription('Audio file').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc.setName('last').setDescription('Show the last 5 captures + their cowork item IDs'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('transcript')
      .setDescription('GitHub link to a capture transcript')
      .addStringOption((o) => o.setName('id').setDescription('captureId').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('Show current recording state'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('optout')
      .setDescription('Opt out of all future captures')
      .addBooleanOption((o) => o.setName('on').setDescription('true=opt out; false=opt back in')),
  )
  .addSubcommand((sc) =>
    sc
      .setName('delete')
      .setDescription('GDPR delete: remove a capture you participated in')
      .addStringOption((o) => o.setName('id').setDescription('captureId').setRequired(true)),
  );

async function main(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(CONFIG.discord.token);
  // eslint-disable-next-line no-console
  console.log(`[zaoscribe-register] pushing slash commands to guild ${CONFIG.discord.guildId}`);
  const res = await rest.put(
    Routes.applicationGuildCommands(CONFIG.discord.clientId, CONFIG.discord.guildId),
    { body: [cmd.toJSON()] },
  );
  // eslint-disable-next-line no-console
  console.log(`[zaoscribe-register] done. ${Array.isArray(res) ? res.length : '?'} command(s) registered.`);
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(`[zaoscribe-register] FATAL: ${err.message}`);
  process.exit(1);
});
