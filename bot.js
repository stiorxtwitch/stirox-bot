const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// ========================
// CONFIGURATION VIA ENV
// ========================
const config = {
  token: process.env.TOKEN,
  prefix: process.env.PREFIX || '!',
  botName: process.env.BOT_NAME || 'MonBot',
  embedColor: process.env.EMBED_COLOR || '#5865F2',
};

// ========================
// OWNER ONLY (stiroxbereal)
// ========================
const OWNER_ID = '771440807919878164';

function isOwner(userId) {
  return userId === OWNER_ID;
}

function checkOwner(message) {
  if (!isOwner(message.author.id)) {
    message.reply('❌ Seul **stiroxbereal** peut utiliser les commandes de ce bot.');
    return false;
  }
  return true;
}

if (!config.token) {
  console.error('❌ ERREUR : Le token Discord n\'est pas défini dans les variables d\'environnement !');
  process.exit(1);
}

// ========================
// SURVEILLANCE VOCALE (état en mémoire)
// ========================
// spectatevoc : { guildId: { channelId, threshold } }
// spectatevocuser : { userId: { guildId, threshold, muted } }
const vocSurveillance = {};
const vocUserSurveillance = {};

// ========================
// KEEPALIVE SERVER (Render)
// ========================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('✅ Bot Discord en ligne !'));
app.get('/health', (req, res) => res.json({ status: 'alive', bot: config.botName, uptime: process.uptime() }));

// ========================
// ENDPOINT : ALERTE DÉCIBEL (appelé par la page web)
// ========================
app.post('/alert', async (req, res) => {
  const { userId, guildId, channelId, db, type } = req.body;
  // type = 'channel' (spectatevoc) ou 'user' (spectatevocuser)

  if (!userId || !guildId || db === undefined) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Membre introuvable' });

    // --- Surveillance d'une vocale entière ---
    if (type === 'channel') {
      const surveillance = vocSurveillance[guildId];
      if (!surveillance) return res.status(200).json({ status: 'ignored', reason: 'Pas de surveillance active' });

      if (channelId !== surveillance.channelId) return res.status(200).json({ status: 'ignored', reason: 'Mauvais salon' });
      if (db < surveillance.threshold) return res.status(200).json({ status: 'ignored', reason: 'Sous le seuil' });

      // Kick vocal
      if (member.voice?.channel) {
        await member.voice.disconnect(`Dépassement du seuil de décibels (${db}dB) dans la vocale surveillée`);
        console.log(`🔇 ${member.user.tag} exclu de la vocale (${db}dB > ${surveillance.threshold}dB)`);

        // Notifier le owner si possible
        const ownerUser = await client.users.fetch(OWNER_ID).catch(() => null);
        if (ownerUser) {
          const embed = new EmbedBuilder()
            .setTitle('🔊 Alerte Décibel — Kick Vocal')
            .addFields(
              { name: 'Utilisateur', value: `${member.user.tag} (${userId})`, inline: true },
              { name: 'Décibels', value: `${db} dB`, inline: true },
              { name: 'Seuil', value: `${surveillance.threshold} dB`, inline: true },
              { name: 'Salon', value: `<#${channelId}>`, inline: true },
            )
            .setColor('#FF4757')
            .setTimestamp();
          await ownerUser.send({ embeds: [embed] }).catch(() => {});
        }
        return res.json({ status: 'kicked', userId, db });
      }
      return res.json({ status: 'not_in_voice' });
    }

    // --- Surveillance d'un utilisateur spécifique ---
    if (type === 'user') {
      const surveillance = vocUserSurveillance[userId];
      if (!surveillance || surveillance.guildId !== guildId) return res.status(200).json({ status: 'ignored' });

      if (db >= surveillance.threshold && !surveillance.muted) {
        // Mute
        await member.voice.setMute(true, `Dépassement du seuil de décibels (${db}dB)`).catch(() => {});
        vocUserSurveillance[userId].muted = true;
        console.log(`🔇 ${member.user.tag} muté (${db}dB > ${surveillance.threshold}dB)`);
        return res.json({ status: 'muted', userId, db });
      }

      if (db < surveillance.threshold && surveillance.muted) {
        // Unmute
        await member.voice.setMute(false, `Sous le seuil de décibels (${db}dB)`).catch(() => {});
        vocUserSurveillance[userId].muted = false;
        console.log(`🔊 ${member.user.tag} démuté (${db}dB < ${surveillance.threshold}dB)`);
        return res.json({ status: 'unmuted', userId, db });
      }

      return res.json({ status: 'no_change', muted: surveillance.muted, db });
    }

    return res.status(400).json({ error: 'Type invalide' });

  } catch (err) {
    console.error('Erreur /alert:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Retourner l'état des surveillances actives (utilisé par la page web)
app.get('/surveillance', (req, res) => {
  res.json({ vocSurveillance, vocUserSurveillance });
});

app.listen(3000, () => {
  console.log('🌐 Serveur keepalive actif sur le port 3000');

  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    setInterval(() => {
      fetch(`${RENDER_URL}/health`)
        .then(() => console.log('♻️ Self-ping OK'))
        .catch(err => console.error('⚠️ Self-ping échoué:', err.message));
    }, 14 * 60 * 1000);
  } else {
    console.warn('⚠️ RENDER_EXTERNAL_URL non défini — self-ping désactivé.');
  }
});

// ========================
// CLIENT DISCORD
// ========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
client.cooldowns = new Collection();

// ========================
// DONNÉES PERSISTANTES
// ========================
const dataFile = './data.json';
function loadData() {
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ warns: {}, mutes: {}, configs: {}, embedDrafts: {} }));
  return JSON.parse(fs.readFileSync(dataFile));
}
function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// ========================
// READY EVENT
// ========================
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} est en ligne !`);
  console.log(`📡 Connecté à ${client.guilds.cache.size} serveur(s)`);
  console.log(`🔒 Accès restreint à l'utilisateur ID: ${OWNER_ID} (stiroxbereal)`);

  const statuses = [
    { name: `${config.prefix}help | ${config.botName}`, type: 0 },
    { name: `Surveiller le serveur 🔒`, type: 3 },
    { name: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} membres`, type: 3 },
  ];
  let i = 0;
  setInterval(() => {
    client.user.setActivity(statuses[i % statuses.length].name, { type: statuses[i % statuses.length].type });
    i++;
  }, 15000);
});

// ========================
// WELCOME EVENT
// ========================
client.on('guildMemberAdd', async (member) => {
  const data = loadData();
  const guildConfig = data.configs[member.guild.id];
  if (!guildConfig?.welcomeChannel) return;

  const channel = member.guild.channels.cache.get(guildConfig.welcomeChannel);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`👋 Bienvenue sur ${member.guild.name} !`)
    .setDescription(
      (guildConfig.welcomeMessage || `Bienvenue **{user}** ! Tu es le membre **#{count}** du serveur.`)
        .replace('{user}', member.toString())
        .replace('{username}', member.user.username)
        .replace('{count}', member.guild.memberCount)
        .replace('{server}', member.guild.name)
    )
    .setColor(guildConfig.welcomeColor || config.embedColor)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setImage(guildConfig.welcomeBanner || null)
    .setFooter({ text: `${member.guild.name} • Bienvenue !`, iconURL: member.guild.iconURL() })
    .setTimestamp();

  await channel.send({ content: `<@${member.id}>`, embeds: [embed] });

  if (guildConfig.autorole) {
    const role = member.guild.roles.cache.get(guildConfig.autorole);
    if (role) member.roles.add(role).catch(() => {});
  }
});

// ========================
// LEAVE EVENT
// ========================
client.on('guildMemberRemove', async (member) => {
  const data = loadData();
  const guildConfig = data.configs[member.guild.id];
  if (!guildConfig?.leaveChannel) return;

  const channel = member.guild.channels.cache.get(guildConfig.leaveChannel);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`👋 Au revoir !`)
    .setDescription(`**${member.user.username}** a quitté le serveur. Il reste **${member.guild.memberCount}** membres.`)
    .setColor('#FF4757')
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

// ========================
// MESSAGE EVENT
// ========================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const data = loadData();
  const guildConfig = data.configs[message.guild.id] || {};

  // Anti-liens
  if (guildConfig.antiLinks && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    const linkRegex = /(https?:\/\/|discord\.gg\/|www\.)/gi;
    if (linkRegex.test(message.content)) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `🚫 <@${message.author.id}>, les liens sont interdits ici !` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  // Anti-invitations Discord
  if (guildConfig.antiInvites && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    const inviteRegex = /discord\.(gg|io|me|li)\/.+/gi;
    if (inviteRegex.test(message.content)) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `🚫 <@${message.author.id}>, les invitations Discord sont interdites !` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  const prefix = guildConfig.prefix || config.prefix;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  if (!checkOwner(message)) return;

  switch (commandName) {

    // ===== SPECTATE VOC (kick si dépasse le seuil) =====
    case 'spectatevoc': {
      const channelId = args[0];
      const threshold = parseInt(args[1]) || 80; // seuil en dB, défaut 80

      if (!channelId) {
        return message.reply('❌ Usage : `!spectatevoc <ID_SALON_VOCAL> [seuil_dB]`\nExemple : `!spectatevoc 123456789 75`');
      }

      const voiceChannel = message.guild.channels.cache.get(channelId);
      if (!voiceChannel || voiceChannel.type !== 2) {
        return message.reply('❌ Salon vocal introuvable. Vérifie l\'ID (type : salon vocal).');
      }

      // Activer ou désactiver
      if (vocSurveillance[message.guild.id]?.channelId === channelId) {
        delete vocSurveillance[message.guild.id];
        const embed = new EmbedBuilder()
          .setTitle('🔕 Surveillance vocale désactivée')
          .setDescription(`La surveillance du salon **${voiceChannel.name}** a été arrêtée.`)
          .setColor('#747D8C')
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      vocSurveillance[message.guild.id] = { channelId, threshold };

      const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:3000`;

      const embed = new EmbedBuilder()
        .setTitle('👁️ Surveillance vocale activée')
        .setDescription(`Le salon **${voiceChannel.name}** est maintenant surveillé.\nTout utilisateur dépassant **${threshold} dB** sera expulsé de la vocale.`)
        .addFields(
          { name: 'Salon', value: `<#${channelId}> (${channelId})`, inline: true },
          { name: 'Seuil', value: `${threshold} dB`, inline: true },
          { name: '🌐 Page de surveillance', value: `Ouvre la page web et configure :\n**Bot URL :** \`${RENDER_URL}\`\n**Guild ID :** \`${message.guild.id}\`\n**Channel ID :** \`${channelId}\`\n**Seuil :** \`${threshold} dB\`\n**Mode :** \`channel\`` },
        )
        .setColor('#F9CA24')
        .setFooter({ text: 'Relance la commande pour désactiver' })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // ===== SPECTATE VOC USER (mute/unmute selon le seuil) =====
    case 'spectatevocuser': {
      const targetUser = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
      const threshold = parseInt(args[1]) || 80;

      if (!targetUser) {
        return message.reply('❌ Usage : `!spectatevocuser <@user ou ID> [seuil_dB]`\nExemple : `!spectatevocuser @Jean 70`');
      }

      // Activer ou désactiver
      if (vocUserSurveillance[targetUser.id]) {
        delete vocUserSurveillance[targetUser.id];
        const embed = new EmbedBuilder()
          .setTitle('🔕 Surveillance utilisateur désactivée')
          .setDescription(`La surveillance de **${targetUser.tag}** a été arrêtée.`)
          .setColor('#747D8C')
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      vocUserSurveillance[targetUser.id] = {
        guildId: message.guild.id,
        threshold,
        muted: false,
      };

      const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:3000`;

      const embed = new EmbedBuilder()
        .setTitle('👁️ Surveillance utilisateur activée')
        .setDescription(`**${targetUser.tag}** est maintenant surveillé.\n- Au-dessus de **${threshold} dB** → muté\n- En dessous → démuté automatiquement`)
        .addFields(
          { name: 'Utilisateur', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
          { name: 'Seuil', value: `${threshold} dB`, inline: true },
          { name: '🌐 Page de surveillance', value: `Ouvre la page web et configure :\n**Bot URL :** \`${RENDER_URL}\`\n**Guild ID :** \`${message.guild.id}\`\n**User ID :** \`${targetUser.id}\`\n**Seuil :** \`${threshold} dB\`\n**Mode :** \`user\`` },
        )
        .setColor('#5352ED')
        .setFooter({ text: 'Relance la commande pour désactiver' })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // ===== AIDE =====
    case 'help': {
      const cat = args[0]?.toLowerCase();

      if (cat === 'moderation' || cat === 'mod') {
        const embed = new EmbedBuilder()
          .setTitle('🛡️ Commandes de Modération')
          .setColor(config.embedColor)
          .addFields(
            { name: '`!ban <@user> [raison]`', value: 'Bannir un utilisateur', inline: true },
            { name: '`!unban <id>`', value: 'Débannir un utilisateur', inline: true },
            { name: '`!kick <@user> [raison]`', value: 'Expulser un utilisateur', inline: true },
            { name: '`!mute <@user> [durée] [raison]`', value: 'Rendre muet (ex: 10m, 1h)', inline: true },
            { name: '`!unmute <@user>`', value: 'Retirer le mute', inline: true },
            { name: '`!warn <@user> [raison]`', value: 'Avertir un utilisateur', inline: true },
            { name: '`!warns <@user>`', value: 'Voir les avertissements', inline: true },
            { name: '`!clearwarns <@user>`', value: 'Supprimer les avertissements', inline: true },
            { name: '`!clear <nombre>`', value: 'Supprimer des messages', inline: true },
            { name: '`!slowmode <secondes>`', value: 'Définir le slowmode', inline: true },
            { name: '`!lock`', value: 'Verrouiller le salon', inline: true },
            { name: '`!unlock`', value: 'Déverrouiller le salon', inline: true },
            { name: '`!nick <@user> <pseudo>`', value: 'Changer le pseudo', inline: true },
            { name: '`!role <@user> <@role>`', value: 'Donner/retirer un rôle', inline: true },
            { name: '`!muteusersalon <@user> [#salon]`', value: 'Couper les messages d\'un user dans un salon', inline: true },
            { name: '`!unmuteusersalon <@user> [#salon]`', value: 'Rétablir les messages d\'un user dans un salon', inline: true },
            { name: '`!transcript [#salon]`', value: 'Transcript d\'un salon en .txt (DM)', inline: true },
            { name: '`!security`', value: '🔒 Lockdown total anti-raid', inline: true },
            { name: '`!unsecurity`', value: '🔓 Lever le lockdown', inline: true },
            { name: '`!spectatevoc <ID> [dB]`', value: '🎤 Surveiller une vocale (kick si dépasse le seuil)', inline: true },
            { name: '`!spectatevocuser <@user> [dB]`', value: '🎤 Surveiller un user (mute/unmute auto)', inline: true },
          )
          .setFooter({ text: `${config.botName} • Modération` });
        return message.reply({ embeds: [embed] });
      }

      if (cat === 'embed') {
        const embed = new EmbedBuilder()
          .setTitle('🎨 Commandes Embed')
          .setColor(config.embedColor)
          .addFields(
            { name: '`!embed create`', value: 'Créer un embed interactif', inline: true },
            { name: '`!embed send <#salon>`', value: 'Envoyer l\'embed dans un salon', inline: true },
            { name: '`!embed edit <messageID>`', value: 'Modifier un embed existant', inline: true },
            { name: '`!say <texte>`', value: 'Faire parler le bot', inline: true },
            { name: '`!announce <#salon> <texte>`', value: 'Faire une annonce', inline: true },
          )
          .setFooter({ text: `${config.botName} • Embeds` });
        return message.reply({ embeds: [embed] });
      }

      if (cat === 'config') {
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Commandes de Configuration')
          .setColor(config.embedColor)
          .addFields(
            { name: '`!setwelcome <#salon>`', value: 'Salon de bienvenue', inline: true },
            { name: '`!setleave <#salon>`', value: 'Salon de départ', inline: true },
            { name: '`!setlogs <#salon>`', value: 'Salon des logs', inline: true },
            { name: '`!setwelcomemsg <message>`', value: 'Message de bienvenue', inline: true },
            { name: '`!setauthorole <@role>`', value: 'Rôle automatique', inline: true },
            { name: '`!antilinks [on/off]`', value: 'Anti-liens', inline: true },
            { name: '`!antiinvites [on/off]`', value: 'Anti-invitations', inline: true },
            { name: '`!setprefix <prefix>`', value: 'Changer le préfixe', inline: true },
            { name: '`!botname <nom>`', value: 'Renommer le bot', inline: true },
            { name: '`!botavatar <url>`', value: 'Changer l\'avatar du bot', inline: true },
          )
          .setFooter({ text: `${config.botName} • Configuration` });
        return message.reply({ embeds: [embed] });
      }

      if (cat === 'info') {
        const embed = new EmbedBuilder()
          .setTitle('ℹ️ Commandes d\'Information')
          .setColor(config.embedColor)
          .addFields(
            { name: '`!userinfo [@user]`', value: 'Info sur un utilisateur', inline: true },
            { name: '`!serverinfo`', value: 'Info sur le serveur', inline: true },
            { name: '`!botinfo`', value: 'Info sur le bot', inline: true },
            { name: '`!avatar [@user]`', value: 'Avatar d\'un utilisateur', inline: true },
            { name: '`!roles`', value: 'Liste des rôles', inline: true },
            { name: '`!ping`', value: 'Latence du bot', inline: true },
          )
          .setFooter({ text: `${config.botName} • Informations` });
        return message.reply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📖 Aide — ${config.botName}`)
        .setDescription(`Préfixe actuel : \`${prefix}\`\n\nChoisissez une catégorie ci-dessous ou utilisez \`${prefix}help <catégorie>\``)
        .setColor(config.embedColor)
        .addFields(
          { name: '🛡️ Modération', value: `\`${prefix}help mod\``, inline: true },
          { name: '🎨 Embeds', value: `\`${prefix}help embed\``, inline: true },
          { name: '⚙️ Configuration', value: `\`${prefix}help config\``, inline: true },
          { name: 'ℹ️ Informations', value: `\`${prefix}help info\``, inline: true },
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: `${config.botName} • Fait avec ❤️` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('help_mod').setLabel('Modération').setStyle(ButtonStyle.Danger).setEmoji('🛡️'),
        new ButtonBuilder().setCustomId('help_embed').setLabel('Embeds').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId('help_config').setLabel('Config').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
        new ButtonBuilder().setCustomId('help_info').setLabel('Info').setStyle(ButtonStyle.Success).setEmoji('ℹ️'),
      );

      return message.reply({ embeds: [embed], components: [row] });
    }

    case 'ping': {
      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong !')
        .addFields(
          { name: 'Latence Bot', value: `\`${Date.now() - message.createdTimestamp}ms\``, inline: true },
          { name: 'Latence API', value: `\`${Math.round(client.ws.ping)}ms\``, inline: true },
        )
        .setColor(config.embedColor)
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    case 'ban': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
        return message.reply('❌ Tu n\'as pas la permission de bannir.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      if (!target.bannable) return message.reply('❌ Je ne peux pas bannir cet utilisateur.');
      const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
      await target.ban({ reason, deleteMessageSeconds: 604800 });
      const embed = new EmbedBuilder()
        .setTitle('🔨 Utilisateur banni')
        .addFields(
          { name: 'Utilisateur', value: `${target.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true },
          { name: 'Raison', value: reason },
        )
        .setColor('#FF4757')
        .setThumbnail(target.user.displayAvatarURL())
        .setTimestamp();
      await logAction(message.guild, embed, data);
      return message.reply({ embeds: [embed] });
    }

    case 'unban': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
        return message.reply('❌ Permission refusée.');
      const userId = args[0];
      if (!userId) return message.reply('❌ Fournis un ID utilisateur.');
      await message.guild.bans.remove(userId).catch(() => message.reply('❌ Utilisateur introuvable dans les bans.'));
      const embed = new EmbedBuilder()
        .setTitle('✅ Utilisateur débanni')
        .addFields({ name: 'ID', value: userId, inline: true }, { name: 'Modérateur', value: message.author.tag, inline: true })
        .setColor('#2ED573')
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    case 'kick': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      if (!target.kickable) return message.reply('❌ Je ne peux pas expulser cet utilisateur.');
      const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
      await target.kick(reason);
      const embed = new EmbedBuilder()
        .setTitle('👢 Utilisateur expulsé')
        .addFields(
          { name: 'Utilisateur', value: target.user.tag, inline: true },
          { name: 'Modérateur', value: message.author.tag, inline: true },
          { name: 'Raison', value: reason },
        )
        .setColor('#FFA502')
        .setThumbnail(target.user.displayAvatarURL())
        .setTimestamp();
      await logAction(message.guild, embed, data);
      return message.reply({ embeds: [embed] });
    }

    case 'mute': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      let duration = args[1];
      let ms = parseDuration(duration);
      if (!ms) { ms = 10 * 60 * 1000; duration = '10m'; }
      const reason = args.slice(2).join(' ') || 'Aucune raison fournie';
      await target.timeout(ms, reason);
      const embed = new EmbedBuilder()
        .setTitle('🔇 Utilisateur muet')
        .addFields(
          { name: 'Utilisateur', value: target.user.tag, inline: true },
          { name: 'Durée', value: duration, inline: true },
          { name: 'Modérateur', value: message.author.tag, inline: true },
          { name: 'Raison', value: reason },
        )
        .setColor('#747D8C')
        .setTimestamp();
      await logAction(message.guild, embed, data);
      return message.reply({ embeds: [embed] });
    }

    case 'unmute': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      await target.timeout(null);
      return message.reply(`✅ **${target.user.username}** n'est plus muet.`);
    }

    case 'muteusersalon': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased()) return message.reply('❌ Salon textuel requis.');
      try {
        await targetChannel.permissionOverwrites.edit(target, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false });
        const embed = new EmbedBuilder().setTitle('🔇 Mute Salon').setDescription(`**${target.user.username}** ne peut plus envoyer de messages dans ${targetChannel}.`).addFields({ name: 'Utilisateur', value: target.user.tag, inline: true }, { name: 'Salon', value: targetChannel.toString(), inline: true }, { name: 'Modérateur', value: message.author.tag, inline: true }).setColor('#747D8C').setThumbnail(target.user.displayAvatarURL()).setTimestamp();
        await logAction(message.guild, embed, data);
        return message.reply({ embeds: [embed] });
      } catch (err) { return message.reply('❌ Impossible de modifier les permissions.'); }
    }

    case 'unmuteusersalon': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased()) return message.reply('❌ Salon textuel requis.');
      try {
        await targetChannel.permissionOverwrites.edit(target, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null });
        const embed = new EmbedBuilder().setTitle('🔊 Unmute Salon').setDescription(`**${target.user.username}** peut de nouveau envoyer des messages dans ${targetChannel}.`).addFields({ name: 'Utilisateur', value: target.user.tag, inline: true }, { name: 'Salon', value: targetChannel.toString(), inline: true }, { name: 'Modérateur', value: message.author.tag, inline: true }).setColor('#2ED573').setThumbnail(target.user.displayAvatarURL()).setTimestamp();
        await logAction(message.guild, embed, data);
        return message.reply({ embeds: [embed] });
      } catch (err) { return message.reply('❌ Impossible de modifier les permissions.'); }
    }

    case 'warn': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
      if (!data.warns[message.guild.id]) data.warns[message.guild.id] = {};
      if (!data.warns[message.guild.id][target.id]) data.warns[message.guild.id][target.id] = [];
      data.warns[message.guild.id][target.id].push({ reason, moderator: message.author.tag, date: new Date().toISOString() });
      saveData(data);
      const warnCount = data.warns[message.guild.id][target.id].length;
      const embed = new EmbedBuilder().setTitle('⚠️ Avertissement').addFields({ name: 'Utilisateur', value: target.user.tag, inline: true }, { name: 'Avertissements', value: `${warnCount}`, inline: true }, { name: 'Modérateur', value: message.author.tag, inline: true }, { name: 'Raison', value: reason }).setColor('#ECCC68').setTimestamp();
      await logAction(message.guild, embed, data);
      if (warnCount >= 5) await target.ban({ reason: 'Auto-ban: 5 avertissements' }).catch(() => {});
      else if (warnCount >= 3) await target.timeout(3600000, 'Auto-mute: 3 avertissements').catch(() => {});
      return message.reply({ embeds: [embed] });
    }

    case 'warns': {
      const target = message.mentions.members.first() || message.member;
      const guildWarns = data.warns[message.guild.id]?.[target.id] || [];
      const embed = new EmbedBuilder().setTitle(`📋 Avertissements de ${target.user.username}`).setDescription(guildWarns.length === 0 ? 'Aucun avertissement' : guildWarns.map((w, i) => `**${i + 1}.** ${w.reason} — par ${w.moderator}`).join('\n')).setColor(config.embedColor).setFooter({ text: `Total: ${guildWarns.length} avertissement(s)` });
      return message.reply({ embeds: [embed] });
    }

    case 'clearwarns': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      if (data.warns[message.guild.id]) data.warns[message.guild.id][target.id] = [];
      saveData(data);
      return message.reply(`✅ Avertissements de **${target.user.username}** supprimés.`);
    }

    case 'clear':
    case 'purge': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) return message.reply('❌ Entre un nombre entre 1 et 100.');
      await message.channel.bulkDelete(amount + 1, true).catch(() => message.reply('❌ Certains messages sont trop anciens.'));
      message.channel.send(`🗑️ **${amount}** message(s) supprimé(s).`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
      break;
    }

    case 'slowmode': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      const seconds = parseInt(args[0]) || 0;
      await message.channel.setRateLimitPerUser(seconds);
      return message.reply(`✅ Slowmode défini à **${seconds} seconde(s)**.`);
    }

    case 'lock': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.reply('🔒 Salon verrouillé.');
    }

    case 'unlock': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      return message.reply('🔓 Salon déverrouillé.');
    }

    case 'nick': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageNicknames))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      const newNick = args.slice(1).join(' ');
      if (!newNick) return message.reply('❌ Fournis un pseudo.');
      await target.setNickname(newNick).catch(() => message.reply('❌ Impossible de changer le pseudo.'));
      return message.reply(`✅ Pseudo de **${target.user.username}** changé en **${newNick}**.`);
    }

    case 'role': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      const role = message.mentions.roles.first();
      if (!target || !role) return message.reply('❌ Mentionne un utilisateur et un rôle.');
      if (target.roles.cache.has(role.id)) {
        await target.roles.remove(role);
        return message.reply(`✅ Rôle **${role.name}** retiré de **${target.user.username}**.`);
      } else {
        await target.roles.add(role);
        return message.reply(`✅ Rôle **${role.name}** donné à **${target.user.username}**.`);
      }
    }

    case 'userinfo': {
      const target = message.mentions.members.first() || message.member;
      const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'Aucun';
      const embed = new EmbedBuilder().setTitle(`👤 ${target.user.username}`).setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 256 })).setColor(target.displayHexColor || config.embedColor).addFields({ name: 'Tag', value: target.user.tag, inline: true }, { name: 'ID', value: target.id, inline: true }, { name: 'Bot', value: target.user.bot ? 'Oui' : 'Non', inline: true }, { name: 'Compte créé', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true }, { name: 'A rejoint le serveur', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true }, { name: 'Couleur', value: target.displayHexColor || 'N/A', inline: true }, { name: `Rôles (${target.roles.cache.size - 1})`, value: roles.length > 1024 ? roles.substring(0, 1020) + '...' : roles }).setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    case 'serverinfo': {
      const g = message.guild;
      const embed = new EmbedBuilder().setTitle(`🏠 ${g.name}`).setThumbnail(g.iconURL({ dynamic: true, size: 256 })).setColor(config.embedColor).addFields({ name: 'ID', value: g.id, inline: true }, { name: 'Propriétaire', value: `<@${g.ownerId}>`, inline: true }, { name: 'Membres', value: `${g.memberCount}`, inline: true }, { name: 'Salons', value: `${g.channels.cache.size}`, inline: true }, { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true }, { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0}`, inline: true }, { name: 'Niveau boost', value: `${g.premiumTier}`, inline: true }, { name: 'Créé le', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }, { name: 'Région', value: g.preferredLocale || 'N/A', inline: true }).setImage(g.bannerURL({ size: 1024 }) || null).setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    case 'botinfo': {
      const uptime = formatUptime(client.uptime);
      const embed = new EmbedBuilder().setTitle(`🤖 ${config.botName}`).setThumbnail(client.user.displayAvatarURL()).setColor(config.embedColor).addFields({ name: 'Nom', value: client.user.tag, inline: true }, { name: 'ID', value: client.user.id, inline: true }, { name: 'Uptime', value: uptime, inline: true }, { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true }, { name: 'Membres', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`, inline: true }, { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true }, { name: 'Préfixe', value: prefix, inline: true }, { name: 'Discord.js', value: require('discord.js').version, inline: true }, { name: 'Node.js', value: process.version, inline: true }).setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    case 'avatar': {
      const target = message.mentions.users.first() || message.author;
      const embed = new EmbedBuilder().setTitle(`🖼️ Avatar de ${target.username}`).setImage(target.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(config.embedColor).addFields({ name: 'PNG', value: `[Lien](${target.displayAvatarURL({ format: 'png', size: 1024 })})`, inline: true }, { name: 'JPG', value: `[Lien](${target.displayAvatarURL({ format: 'jpg', size: 1024 })})`, inline: true }, { name: 'WebP', value: `[Lien](${target.displayAvatarURL({ format: 'webp', size: 1024 })})`, inline: true });
      return message.reply({ embeds: [embed] });
    }

    case 'roles': {
      const roles = message.guild.roles.cache.filter(r => r.id !== message.guild.id).sort((a, b) => b.position - a.position).map(r => r.toString()).join(', ');
      const embed = new EmbedBuilder().setTitle(`🎭 Rôles de ${message.guild.name}`).setDescription(roles.length > 4000 ? roles.substring(0, 4000) + '...' : roles || 'Aucun rôle').setColor(config.embedColor).setFooter({ text: `Total: ${message.guild.roles.cache.size - 1} rôle(s)` });
      return message.reply({ embeds: [embed] });
    }

    case 'say': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const text = args.join(' ');
      if (!text) return message.reply('❌ Fournis un texte.');
      await message.delete().catch(() => {});
      return message.channel.send(text);
    }

    case 'announce': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      const text = args.slice(1).join(' ');
      if (!text) return message.reply('❌ Fournis un texte.');
      const embed = new EmbedBuilder().setTitle('📢 Annonce').setDescription(text).setColor(config.embedColor).setFooter({ text: `Annonce par ${message.author.username}`, iconURL: message.author.displayAvatarURL() }).setTimestamp();
      await channel.send({ content: '@everyone', embeds: [embed] });
      return message.reply(`✅ Annonce envoyée dans ${channel}.`);
    }

    case 'embed': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const subCmd = args[0]?.toLowerCase();
      if (!subCmd || subCmd === 'create') {
        if (!data.embedDrafts) data.embedDrafts = {};
        data.embedDrafts[message.author.id] = { title: 'Mon Embed', description: 'Description de l\'embed', color: config.embedColor, footer: '', image: '', thumbnail: '', fields: [] };
        saveData(data);
        return sendEmbedBuilder(message, data.embedDrafts[message.author.id]);
      }
      if (subCmd === 'send') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('❌ Mentionne un salon.');
        const draft = data.embedDrafts?.[message.author.id];
        if (!draft) return message.reply('❌ Aucun embed en cours.');
        const embed = buildEmbed(draft);
        await channel.send({ embeds: [embed] });
        return message.reply(`✅ Embed envoyé dans ${channel} !`);
      }
      break;
    }

    case 'setwelcome': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].welcomeChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon de bienvenue défini : ${channel}`);
    }

    case 'setleave': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].leaveChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon de départ défini : ${channel}`);
    }

    case 'setlogs': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].logsChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon des logs défini : ${channel}`);
    }

    case 'setwelcomemsg': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const msg = args.join(' ');
      if (!msg) return message.reply('❌ Fournis un message.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].welcomeMessage = msg;
      saveData(data);
      return message.reply(`✅ Message de bienvenue défini.`);
    }

    case 'setauthorole': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Mentionne un rôle.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].autorole = role.id;
      saveData(data);
      return message.reply(`✅ Rôle automatique défini : ${role}`);
    }

    case 'antilinks': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      const state = args[0]?.toLowerCase() === 'on';
      data.configs[message.guild.id].antiLinks = state;
      saveData(data);
      return message.reply(`✅ Anti-liens : **${state ? 'Activé' : 'Désactivé'}**`);
    }

    case 'antiinvites': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      const state = args[0]?.toLowerCase() === 'on';
      data.configs[message.guild.id].antiInvites = state;
      saveData(data);
      return message.reply(`✅ Anti-invitations : **${state ? 'Activé' : 'Désactivé'}**`);
    }

    case 'setprefix': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const newPrefix = args[0];
      if (!newPrefix) return message.reply('❌ Fournis un préfixe.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].prefix = newPrefix;
      saveData(data);
      return message.reply(`✅ Préfixe changé en \`${newPrefix}\``);
    }

    case 'botname': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const newName = args.join(' ');
      if (!newName) return message.reply('❌ Fournis un nom.');
      await client.user.setUsername(newName).catch(() => message.reply('❌ Impossible (limite Discord: 2x/heure)'));
      config.botName = newName;
      return message.reply(`✅ Nom du bot changé en **${newName}**`);
    }

    case 'botavatar': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const url = args[0] || message.attachments.first()?.url;
      if (!url) return message.reply('❌ Fournis une URL d\'image.');
      await client.user.setAvatar(url).catch(() => message.reply('❌ Impossible (limite Discord: 2x/heure)'));
      return message.reply(`✅ Avatar du bot mis à jour !`);
    }

    case 'giveaway': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Permission refusée.');
      const duration = args[0];
      const winners = parseInt(args[1]) || 1;
      const prize = args.slice(2).join(' ');
      if (!duration || !prize) return message.reply('❌ Usage: `!giveaway <durée> <gagnants> <lot>`');
      const ms = parseDuration(duration);
      if (!ms) return message.reply('❌ Durée invalide.');
      const endTime = Math.floor((Date.now() + ms) / 1000);
      const embed = new EmbedBuilder().setTitle('🎉 GIVEAWAY 🎉').setDescription(`**Lot:** ${prize}\n\n📅 Fin: <t:${endTime}:R>\n👥 Gagnant(s): ${winners}\n\n**Réagis avec 🎉 pour participer !**`).setColor('#F9CA24').setFooter({ text: `Organisé par ${message.author.username}` }).setTimestamp(Date.now() + ms);
      const msg = await message.channel.send({ embeds: [embed] });
      await msg.react('🎉');
      setTimeout(async () => {
        const refreshed = await msg.fetch();
        const reaction = refreshed.reactions.cache.get('🎉');
        const users = await reaction.users.fetch();
        const participants = users.filter(u => !u.bot);
        if (participants.size === 0) return msg.reply('❌ Pas de participants.');
        const winnersList = participants.random(Math.min(winners, participants.size));
        const winnersText = Array.isArray(winnersList) ? winnersList.map(u => u.toString()).join(', ') : winnersList.toString();
        const endEmbed = new EmbedBuilder().setTitle('🎉 GIVEAWAY TERMINÉ').setDescription(`**Lot:** ${prize}\n\n🏆 **Gagnant(s):** ${winnersText}`).setColor('#27AE60').setTimestamp();
        await msg.edit({ embeds: [endEmbed] });
        await msg.reply(`🎉 Félicitations ${winnersText} ! Vous avez gagné **${prize}** !`);
      }, ms);
      break;
    }

    case 'poll': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Permission refusée.');
      const question = args.join(' ');
      if (!question) return message.reply('❌ Fournis une question.');
      const embed = new EmbedBuilder().setTitle('📊 Sondage').setDescription(question).setColor(config.embedColor).setFooter({ text: `Sondage par ${message.author.username}` }).setTimestamp();
      const msg = await message.channel.send({ embeds: [embed] });
      await msg.react('👍'); await msg.react('👎'); await msg.react('🤷');
      await message.delete().catch(() => {});
      break;
    }

    case 'transcript': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Permission refusée.');
      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased()) return message.reply('❌ Salon textuel requis.');
      const loadingMsg = await message.reply(`⏳ Génération du transcript...`);
      try {
        let allMessages = []; let lastId = null;
        for (let i = 0; i < 5; i++) {
          const options = { limit: 100 };
          if (lastId) options.before = lastId;
          const batch = await targetChannel.messages.fetch(options);
          if (batch.size === 0) break;
          allMessages = allMessages.concat([...batch.values()]);
          lastId = batch.last().id;
        }
        allMessages.reverse();
        if (allMessages.length === 0) { await loadingMsg.delete().catch(() => {}); return message.reply('❌ Aucun message.'); }
        const separator = '═'.repeat(50);
        const lines = [separator, `  📄 TRANSCRIPT — #${targetChannel.name}`, `  🏠 Serveur   : ${message.guild.name}`, `  📅 Date      : ${new Date().toLocaleString('fr-FR')}`, `  💬 Messages  : ${allMessages.length}`, separator, ''];
        for (const msg of allMessages) {
          const date = msg.createdAt.toLocaleString('fr-FR');
          let content = msg.content || '[Embed/Fichier]';
          lines.push(`[${date}] ${msg.author.tag}${msg.author.bot ? ' [BOT]' : ''}`);
          lines.push(`           ${content}`); lines.push('');
        }
        lines.push(separator);
        const buffer = Buffer.from(lines.join('\n'), 'utf-8');
        const fileName = `transcript-${targetChannel.name}-${Date.now()}.txt`;
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        const confirmEmbed = new EmbedBuilder().setTitle('📄 Transcript généré').addFields({ name: 'Salon', value: targetChannel.toString(), inline: true }, { name: 'Messages', value: `${allMessages.length}`, inline: true }).setColor('#2ED573').setTimestamp();
        await loadingMsg.delete().catch(() => {});
        try {
          await message.author.send({ content: `📄 Transcript de **#${targetChannel.name}** :`, embeds: [confirmEmbed], files: [attachment] });
          return message.reply({ content: `✅ Transcript envoyé en DM !`, embeds: [confirmEmbed] });
        } catch { await message.channel.send({ embeds: [confirmEmbed], files: [attachment] }); }
      } catch (err) { console.error(err); await loadingMsg.delete().catch(() => {}); return message.reply('❌ Erreur lors de la génération.'); }
      break;
    }

    case 'security': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const loadingMsg = await message.reply('🔒 Lockdown anti-raid en cours...');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      const savedRolePerms = {};
      for (const [roleId, role] of message.guild.roles.cache) {
        if (role.managed) continue;
        savedRolePerms[roleId] = role.permissions.bitfield.toString();
        try { await role.setPermissions(role.permissions.remove(PermissionsBitField.Flags.SendMessages)); } catch {}
      }
      const lockedChannels = [];
      for (const [, channel] of message.guild.channels.cache) {
        if (!channel.isTextBased()) continue;
        try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false }); lockedChannels.push(channel.id); } catch {}
      }
      data.configs[message.guild.id].lockdownActive = true;
      data.configs[message.guild.id].lockdownChannels = lockedChannels;
      data.configs[message.guild.id].savedRolePerms = savedRolePerms;
      saveData(data);
      const embed = new EmbedBuilder().setTitle('🔒 LOCKDOWN ACTIVÉ').setDescription('**Le serveur est en mode lockdown.**\nUtilise `!unsecurity` pour lever le lockdown.').addFields({ name: 'Salons verrouillés', value: `${lockedChannels.length}`, inline: true }, { name: 'Déclenché par', value: message.author.tag, inline: true }).setColor('#FF4757').setTimestamp();
      await logAction(message.guild, embed, data);
      await loadingMsg.delete().catch(() => {});
      return message.reply({ embeds: [embed] });
    }

    case 'unsecurity': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Permission refusée.');
      const guildCfg = data.configs[message.guild.id];
      if (!guildCfg?.lockdownActive) return message.reply('ℹ️ Aucun lockdown actif.');
      const loadingMsg = await message.reply('🔓 Rétablissement en cours...');
      const savedRolePerms = guildCfg.savedRolePerms || {};
      for (const [roleId, permBit] of Object.entries(savedRolePerms)) {
        const role = message.guild.roles.cache.get(roleId);
        if (!role || role.managed) continue;
        try { await role.setPermissions(BigInt(permBit)); } catch {}
      }
      let restored = 0;
      for (const [, channel] of message.guild.channels.cache) {
        if (!channel.isTextBased()) continue;
        try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null }); restored++; } catch {}
      }
      data.configs[message.guild.id].lockdownActive = false;
      data.configs[message.guild.id].lockdownChannels = [];
      data.configs[message.guild.id].savedRolePerms = {};
      saveData(data);
      const embed = new EmbedBuilder().setTitle('🔓 LOCKDOWN LEVÉ').setDescription('**Le serveur est de nouveau accessible.**').addFields({ name: 'Salons restaurés', value: `${restored}`, inline: true }, { name: 'Rétabli par', value: message.author.tag, inline: true }).setColor('#2ED573').setTimestamp();
      await logAction(message.guild, embed, data);
      await loadingMsg.delete().catch(() => {});
      return message.reply({ embeds: [embed] });
    }

    default:
      break;
  }
});

// ========================
// BUTTON INTERACTIONS
// ========================
client.on('interactionCreate', async (interaction) => {
  if (!isOwner(interaction.user.id)) {
    if (interaction.isRepliable()) return interaction.reply({ content: '❌ Seul **stiroxbereal** peut interagir avec ce bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isButton()) {
    const data = loadData();
    if (interaction.customId === 'help_mod') {
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🛡️ Modération').setColor('#FF4757').addFields({ name: '`!ban/kick/mute/warn`', value: 'Modération standard', inline: true }, { name: '`!clear/lock/unlock`', value: 'Gestion messages/salon', inline: true }, { name: '`!spectatevoc <ID> [dB]`', value: '🎤 Kick vocal si dépasse le seuil', inline: true }, { name: '`!spectatevocuser <@user> [dB]`', value: '🎤 Mute/unmute auto selon le seuil', inline: true }, { name: '`!security / !unsecurity`', value: 'Lockdown anti-raid', inline: true })], flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId === 'help_embed') {
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎨 Embeds').setColor('#5352ED').addFields({ name: '`!embed create`', value: 'Créer un embed', inline: true }, { name: '`!embed send <#salon>`', value: 'Envoyer', inline: true }, { name: '`!say <texte>`', value: 'Parler', inline: true }, { name: '`!announce <#salon> <texte>`', value: 'Annonce', inline: true })], flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId === 'help_config') {
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚙️ Configuration').setColor('#747D8C').addFields({ name: '`!setwelcome/setleave/setlogs`', value: 'Salons', inline: true }, { name: '`!antilinks/antiinvites on/off`', value: 'Filtres', inline: true }, { name: '`!botname/botavatar`', value: 'Apparence bot', inline: true })], flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId === 'help_info') {
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('ℹ️ Informations').setColor('#2ED573').addFields({ name: '`!userinfo/serverinfo/botinfo`', value: 'Infos', inline: true }, { name: '`!avatar/roles/ping`', value: 'Utilitaires', inline: true })], flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId.startsWith('embed_')) await handleEmbedBuilder(interaction, data);
  }

  if (interaction.isModalSubmit()) await handleModalSubmit(interaction);
  if (interaction.isStringSelectMenu()) await handleSelectMenu(interaction);
});

// ========================
// EMBED BUILDER
// ========================
async function sendEmbedBuilder(message, draft) {
  const preview = buildEmbed(draft);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_title').setLabel('Titre').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId('embed_description').setLabel('Description').setStyle(ButtonStyle.Primary).setEmoji('📝'),
    new ButtonBuilder().setCustomId('embed_color').setLabel('Couleur').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
    new ButtonBuilder().setCustomId('embed_footer').setLabel('Footer').setStyle(ButtonStyle.Primary).setEmoji('📋'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_image').setLabel('Image').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
    new ButtonBuilder().setCustomId('embed_thumbnail').setLabel('Miniature').setStyle(ButtonStyle.Secondary).setEmoji('📸'),
    new ButtonBuilder().setCustomId('embed_author').setLabel('Auteur').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
    new ButtonBuilder().setCustomId('embed_addfield').setLabel('Ajouter champ').setStyle(ButtonStyle.Success).setEmoji('➕'),
  );
  await message.reply({ content: '🎨 **Éditeur d\'Embed** — Clique sur les boutons pour modifier :', embeds: [preview], components: [row1, row2] });
}

function buildEmbed(draft) {
  const embed = new EmbedBuilder().setTitle(draft.title || null).setDescription(draft.description || null).setColor(draft.color || '#5865F2');
  if (draft.footer) embed.setFooter({ text: draft.footer });
  if (draft.image) embed.setImage(draft.image);
  if (draft.thumbnail) embed.setThumbnail(draft.thumbnail);
  if (draft.author) embed.setAuthor({ name: draft.author });
  if (draft.timestamp) embed.setTimestamp();
  if (draft.fields?.length) draft.fields.forEach(f => embed.addFields({ name: f.name, value: f.value, inline: f.inline || false }));
  return embed;
}

async function handleEmbedBuilder(interaction, data) {
  const userId = interaction.user.id;
  if (!data.embedDrafts?.[userId]) return interaction.reply({ content: '❌ Aucun embed en cours.', flags: MessageFlags.Ephemeral });
  const action = interaction.customId.replace('embed_', '');
  const modals = { title: { label: 'Titre', placeholder: 'Mon super titre', max: 256 }, description: { label: 'Description', placeholder: 'Description...', max: 4000, style: TextInputStyle.Paragraph }, color: { label: 'Couleur (HEX)', placeholder: '#5865F2', max: 7 }, footer: { label: 'Footer', placeholder: 'Mon footer', max: 2048 }, image: { label: 'URL image', placeholder: 'https://...', max: 500 }, thumbnail: { label: 'URL miniature', placeholder: 'https://...', max: 500 }, author: { label: 'Auteur', placeholder: 'Auteur', max: 256 }, addfield: { label: 'Nom du champ', placeholder: 'Titre', max: 256 } };
  const modalConfig = modals[action];
  if (!modalConfig) return;
  const modal = new ModalBuilder().setCustomId(`embedmodal_${action}`).setTitle(`Modifier: ${action}`);
  const input = new TextInputBuilder().setCustomId('input_value').setLabel(modalConfig.label).setStyle(modalConfig.style || TextInputStyle.Short).setPlaceholder(modalConfig.placeholder).setMaxLength(modalConfig.max).setRequired(true);
  if (action === 'addfield') {
    const valueInput = new TextInputBuilder().setCustomId('field_value').setLabel('Contenu').setStyle(TextInputStyle.Paragraph).setMaxLength(1024).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input), new ActionRowBuilder().addComponents(valueInput));
  } else { modal.addComponents(new ActionRowBuilder().addComponents(input)); }
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  const data = loadData();
  const userId = interaction.user.id;
  if (interaction.customId.startsWith('embedmodal_')) {
    const action = interaction.customId.replace('embedmodal_', '');
    const value = interaction.fields.getTextInputValue('input_value');
    if (!data.embedDrafts) data.embedDrafts = {};
    if (!data.embedDrafts[userId]) data.embedDrafts[userId] = {};
    if (action === 'addfield') { const fieldValue = interaction.fields.getTextInputValue('field_value'); if (!data.embedDrafts[userId].fields) data.embedDrafts[userId].fields = []; data.embedDrafts[userId].fields.push({ name: value, value: fieldValue, inline: false }); }
    else if (action === 'color') { data.embedDrafts[userId].color = value.startsWith('#') ? value : '#' + value; }
    else { data.embedDrafts[userId][action] = value; }
    saveData(data);
    const preview = buildEmbed(data.embedDrafts[userId]);
    await interaction.reply({ content: `✅ **${action}** mis à jour !`, embeds: [preview], flags: MessageFlags.Ephemeral });
  }
}

async function handleSelectMenu(interaction) {}

// ========================
// LOGS
// ========================
async function logAction(guild, embed, data) {
  const guildConfig = data.configs[guild.id];
  if (!guildConfig?.logsChannel) return;
  const channel = guild.channels.cache.get(guildConfig.logsChannel);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

// ========================
// UTILITAIRES
// ========================
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return parseInt(match[1]) * units[match[2].toLowerCase()];
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60); const d = Math.floor(h / 24);
  return `${d}j ${h % 24}h ${m % 60}m ${s % 60}s`;
}

// ========================
// EVENTS DE LOG AVANCÉS
// ========================
client.on('messageDelete', async (message) => {
  if (message.author?.bot) return;
  const data = loadData();
  const guildConfig = data.configs[message.guild?.id];
  if (!guildConfig?.logsChannel) return;
  const channel = message.guild.channels.cache.get(guildConfig.logsChannel);
  if (!channel) return;
  const embed = new EmbedBuilder().setTitle('🗑️ Message supprimé').addFields({ name: 'Auteur', value: message.author?.tag || 'Inconnu', inline: true }, { name: 'Salon', value: message.channel.toString(), inline: true }, { name: 'Contenu', value: message.content?.substring(0, 1000) || '*Aucun contenu*' }).setColor('#FF4757').setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  const data = loadData();
  const guildConfig = data.configs[oldMsg.guild?.id];
  if (!guildConfig?.logsChannel) return;
  const channel = oldMsg.guild.channels.cache.get(guildConfig.logsChannel);
  if (!channel) return;
  const embed = new EmbedBuilder().setTitle('✏️ Message modifié').addFields({ name: 'Auteur', value: oldMsg.author?.tag || 'Inconnu', inline: true }, { name: 'Salon', value: oldMsg.channel.toString(), inline: true }, { name: 'Avant', value: oldMsg.content?.substring(0, 500) || '*Vide*' }, { name: 'Après', value: newMsg.content?.substring(0, 500) || '*Vide*' }).setColor('#FFA502').setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanAdd', async (ban) => {
  const data = loadData();
  const guildConfig = data.configs[ban.guild.id];
  if (!guildConfig?.logsChannel) return;
  const channel = ban.guild.channels.cache.get(guildConfig.logsChannel);
  if (!channel) return;
  const embed = new EmbedBuilder().setTitle('🔨 Utilisateur banni').addFields({ name: 'Utilisateur', value: ban.user.tag, inline: true }, { name: 'Raison', value: ban.reason || 'Aucune raison', inline: true }).setColor('#FF4757').setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

// ========================
// CONNEXION
// ========================
client.login(config.token);
