const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

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
// KEEPALIVE SERVER (Render)
// ========================
const app = express();
app.get('/', (req, res) => res.send('✅ Bot Discord en ligne !'));
app.get('/health', (req, res) => res.json({ status: 'alive', bot: config.botName, uptime: process.uptime() }));
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

  // Toutes les commandes réservées à stiroxbereal
  if (!checkOwner(message)) return;

  switch (commandName) {

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

      // Menu principal
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

    // ===== PING =====
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

    // ===== BAN =====
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

    // ===== UNBAN =====
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

    // ===== KICK =====
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

    // ===== MUTE =====
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

    // ===== UNMUTE =====
    case 'unmute': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      await target.timeout(null);
      return message.reply(`✅ **${target.user.username}** n'est plus muet.`);
    }

    // ===== MUTE USER SALON =====
    case 'muteusersalon': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');

      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur. Usage : `!muteusersalon <@user> [#salon]`');

      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased()) return message.reply('❌ Le salon cible doit être un salon textuel.');

      try {
        await targetChannel.permissionOverwrites.edit(target, {
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          SendMessagesInThreads: false,
        });

        const embed = new EmbedBuilder()
          .setTitle('🔇 Mute Salon')
          .setDescription(`**${target.user.username}** ne peut plus envoyer de messages dans ${targetChannel}.`)
          .addFields(
            { name: 'Utilisateur', value: target.user.tag, inline: true },
            { name: 'Salon', value: targetChannel.toString(), inline: true },
            { name: 'Modérateur', value: message.author.tag, inline: true },
          )
          .setColor('#747D8C')
          .setThumbnail(target.user.displayAvatarURL())
          .setTimestamp();

        await logAction(message.guild, embed, data);
        return message.reply({ embeds: [embed] });
      } catch (err) {
        console.error(err);
        return message.reply('❌ Impossible de modifier les permissions. Vérifie que le bot a la permission **Gérer les salons**.');
      }
    }

    // ===== UNMUTE USER SALON =====
    case 'unmuteusersalon': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');

      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur. Usage : `!unmuteusersalon <@user> [#salon]`');

      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased()) return message.reply('❌ Le salon cible doit être un salon textuel.');

      try {
        await targetChannel.permissionOverwrites.edit(target, {
          SendMessages: null,
          AddReactions: null,
          CreatePublicThreads: null,
          CreatePrivateThreads: null,
          SendMessagesInThreads: null,
        });

        const embed = new EmbedBuilder()
          .setTitle('🔊 Unmute Salon')
          .setDescription(`**${target.user.username}** peut de nouveau envoyer des messages dans ${targetChannel}.`)
          .addFields(
            { name: 'Utilisateur', value: target.user.tag, inline: true },
            { name: 'Salon', value: targetChannel.toString(), inline: true },
            { name: 'Modérateur', value: message.author.tag, inline: true },
          )
          .setColor('#2ED573')
          .setThumbnail(target.user.displayAvatarURL())
          .setTimestamp();

        await logAction(message.guild, embed, data);
        return message.reply({ embeds: [embed] });
      } catch (err) {
        console.error(err);
        return message.reply('❌ Impossible de modifier les permissions. Vérifie que le bot a la permission **Gérer les salons**.');
      }
    }

    // ===== WARN =====
    case 'warn': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      const reason = args.slice(1).join(' ') || 'Aucune raison fournie';

      if (!data.warns[message.guild.id]) data.warns[message.guild.id] = {};
      if (!data.warns[message.guild.id][target.id]) data.warns[message.guild.id][target.id] = [];

      data.warns[message.guild.id][target.id].push({
        reason, moderator: message.author.tag, date: new Date().toISOString()
      });
      saveData(data);

      const warnCount = data.warns[message.guild.id][target.id].length;
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Avertissement')
        .addFields(
          { name: 'Utilisateur', value: target.user.tag, inline: true },
          { name: 'Avertissements', value: `${warnCount}`, inline: true },
          { name: 'Modérateur', value: message.author.tag, inline: true },
          { name: 'Raison', value: reason },
        )
        .setColor('#ECCC68')
        .setTimestamp();
      await logAction(message.guild, embed, data);

      if (warnCount >= 5) await target.ban({ reason: 'Auto-ban: 5 avertissements' }).catch(() => {});
      else if (warnCount >= 3) await target.timeout(3600000, 'Auto-mute: 3 avertissements').catch(() => {});

      return message.reply({ embeds: [embed] });
    }

    // ===== WARNS =====
    case 'warns': {
      const target = message.mentions.members.first() || message.member;
      const guildWarns = data.warns[message.guild.id]?.[target.id] || [];

      const embed = new EmbedBuilder()
        .setTitle(`📋 Avertissements de ${target.user.username}`)
        .setDescription(guildWarns.length === 0 ? 'Aucun avertissement' : guildWarns.map((w, i) => `**${i + 1}.** ${w.reason} — par ${w.moderator}`).join('\n'))
        .setColor(config.embedColor)
        .setFooter({ text: `Total: ${guildWarns.length} avertissement(s)` });
      return message.reply({ embeds: [embed] });
    }

    // ===== CLEARWARNS =====
    case 'clearwarns': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Mentionne un utilisateur.');
      if (data.warns[message.guild.id]) data.warns[message.guild.id][target.id] = [];
      saveData(data);
      return message.reply(`✅ Avertissements de **${target.user.username}** supprimés.`);
    }

    // ===== CLEAR =====
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

    // ===== SLOWMODE =====
    case 'slowmode': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      const seconds = parseInt(args[0]) || 0;
      await message.channel.setRateLimitPerUser(seconds);
      return message.reply(`✅ Slowmode défini à **${seconds} seconde(s)**.`);
    }

    // ===== LOCK =====
    case 'lock': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.reply('🔒 Salon verrouillé.');
    }

    // ===== UNLOCK =====
    case 'unlock': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply('❌ Permission refusée.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      return message.reply('🔓 Salon déverrouillé.');
    }

    // ===== NICK =====
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

    // ===== ROLE =====
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

    // ===== USERINFO =====
    case 'userinfo': {
      const target = message.mentions.members.first() || message.member;
      const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'Aucun';
      const embed = new EmbedBuilder()
        .setTitle(`👤 ${target.user.username}`)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(target.displayHexColor || config.embedColor)
        .addFields(
          { name: 'Tag', value: target.user.tag, inline: true },
          { name: 'ID', value: target.id, inline: true },
          { name: 'Bot', value: target.user.bot ? 'Oui' : 'Non', inline: true },
          { name: 'Compte créé', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'A rejoint le serveur', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: 'Couleur', value: target.displayHexColor || 'N/A', inline: true },
          { name: `Rôles (${target.roles.cache.size - 1})`, value: roles.length > 1024 ? roles.substring(0, 1020) + '...' : roles },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ===== SERVERINFO =====
    case 'serverinfo': {
      const g = message.guild;
      const embed = new EmbedBuilder()
        .setTitle(`🏠 ${g.name}`)
        .setThumbnail(g.iconURL({ dynamic: true, size: 256 }))
        .setColor(config.embedColor)
        .addFields(
          { name: 'ID', value: g.id, inline: true },
          { name: 'Propriétaire', value: `<@${g.ownerId}>`, inline: true },
          { name: 'Membres', value: `${g.memberCount}`, inline: true },
          { name: 'Salons', value: `${g.channels.cache.size}`, inline: true },
          { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
          { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
          { name: 'Niveau boost', value: `${g.premiumTier}`, inline: true },
          { name: 'Créé le', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Région', value: g.preferredLocale || 'N/A', inline: true },
        )
        .setImage(g.bannerURL({ size: 1024 }) || null)
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ===== BOTINFO =====
    case 'botinfo': {
      const uptime = formatUptime(client.uptime);
      const embed = new EmbedBuilder()
        .setTitle(`🤖 ${config.botName}`)
        .setThumbnail(client.user.displayAvatarURL())
        .setColor(config.embedColor)
        .addFields(
          { name: 'Nom', value: client.user.tag, inline: true },
          { name: 'ID', value: client.user.id, inline: true },
          { name: 'Uptime', value: uptime, inline: true },
          { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true },
          { name: 'Membres', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`, inline: true },
          { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
          { name: 'Préfixe', value: prefix, inline: true },
          { name: 'Discord.js', value: require('discord.js').version, inline: true },
          { name: 'Node.js', value: process.version, inline: true },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ===== AVATAR =====
    case 'avatar': {
      const target = message.mentions.users.first() || message.author;
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ Avatar de ${target.username}`)
        .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setColor(config.embedColor)
        .addFields(
          { name: 'PNG', value: `[Lien](${target.displayAvatarURL({ format: 'png', size: 1024 })})`, inline: true },
          { name: 'JPG', value: `[Lien](${target.displayAvatarURL({ format: 'jpg', size: 1024 })})`, inline: true },
          { name: 'WebP', value: `[Lien](${target.displayAvatarURL({ format: 'webp', size: 1024 })})`, inline: true },
        );
      return message.reply({ embeds: [embed] });
    }

    // ===== ROLES =====
    case 'roles': {
      const roles = message.guild.roles.cache
        .filter(r => r.id !== message.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r.toString())
        .join(', ');
      const embed = new EmbedBuilder()
        .setTitle(`🎭 Rôles de ${message.guild.name}`)
        .setDescription(roles.length > 4000 ? roles.substring(0, 4000) + '...' : roles || 'Aucun rôle')
        .setColor(config.embedColor)
        .setFooter({ text: `Total: ${message.guild.roles.cache.size - 1} rôle(s)` });
      return message.reply({ embeds: [embed] });
    }

    // ===== SAY =====
    case 'say': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const text = args.join(' ');
      if (!text) return message.reply('❌ Fournis un texte.');
      await message.delete().catch(() => {});
      return message.channel.send(text);
    }

    // ===== ANNOUNCE =====
    case 'announce': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      const text = args.slice(1).join(' ');
      if (!text) return message.reply('❌ Fournis un texte.');

      const embed = new EmbedBuilder()
        .setTitle('📢 Annonce')
        .setDescription(text)
        .setColor(config.embedColor)
        .setFooter({ text: `Annonce par ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();

      await channel.send({ content: '@everyone', embeds: [embed] });
      return message.reply(`✅ Annonce envoyée dans ${channel}.`);
    }

    // ===== EMBED BUILDER =====
    case 'embed': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');

      const subCmd = args[0]?.toLowerCase();

      if (!subCmd || subCmd === 'create') {
        if (!data.embedDrafts) data.embedDrafts = {};
        data.embedDrafts[message.author.id] = {
          title: 'Mon Embed',
          description: 'Description de l\'embed',
          color: config.embedColor,
          footer: '',
          image: '',
          thumbnail: '',
          fields: [],
        };
        saveData(data);
        return sendEmbedBuilder(message, data.embedDrafts[message.author.id]);
      }

      if (subCmd === 'send') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('❌ Mentionne un salon.');
        const draft = data.embedDrafts?.[message.author.id];
        if (!draft) return message.reply('❌ Aucun embed en cours. Utilise `!embed create`.');
        const embed = buildEmbed(draft);
        await channel.send({ embeds: [embed] });
        return message.reply(`✅ Embed envoyé dans ${channel} !`);
      }

      break;
    }

    // ===== CONFIGURATION =====
    case 'setwelcome': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].welcomeChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon de bienvenue défini : ${channel}`);
    }

    case 'setleave': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].leaveChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon de départ défini : ${channel}`);
    }

    case 'setlogs': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Mentionne un salon.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].logsChannel = channel.id;
      saveData(data);
      return message.reply(`✅ Salon des logs défini : ${channel}`);
    }

    case 'setwelcomemsg': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const msg = args.join(' ');
      if (!msg) return message.reply('❌ Fournis un message. Variables : `{user}`, `{username}`, `{count}`, `{server}`');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].welcomeMessage = msg;
      saveData(data);
      return message.reply(`✅ Message de bienvenue défini.`);
    }

    case 'setauthorole': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Mentionne un rôle.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].autorole = role.id;
      saveData(data);
      return message.reply(`✅ Rôle automatique défini : ${role}`);
    }

    case 'antilinks': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      const state = args[0]?.toLowerCase() === 'on';
      data.configs[message.guild.id].antiLinks = state;
      saveData(data);
      return message.reply(`✅ Anti-liens : **${state ? 'Activé' : 'Désactivé'}**`);
    }

    case 'antiinvites': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      const state = args[0]?.toLowerCase() === 'on';
      data.configs[message.guild.id].antiInvites = state;
      saveData(data);
      return message.reply(`✅ Anti-invitations : **${state ? 'Activé' : 'Désactivé'}**`);
    }

    case 'setprefix': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const newPrefix = args[0];
      if (!newPrefix) return message.reply('❌ Fournis un préfixe.');
      if (!data.configs[message.guild.id]) data.configs[message.guild.id] = {};
      data.configs[message.guild.id].prefix = newPrefix;
      saveData(data);
      return message.reply(`✅ Préfixe changé en \`${newPrefix}\``);
    }

    // ===== RENAME BOT =====
    case 'botname': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const newName = args.join(' ');
      if (!newName) return message.reply('❌ Fournis un nom.');
      await client.user.setUsername(newName).catch(() => message.reply('❌ Impossible (limite Discord: 2x/heure)'));
      config.botName = newName;
      return message.reply(`✅ Nom du bot changé en **${newName}**`);
    }

    // ===== CHANGE AVATAR =====
    case 'botavatar': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return message.reply('❌ Permission refusée.');
      const url = args[0] || message.attachments.first()?.url;
      if (!url) return message.reply('❌ Fournis une URL d\'image ou attache une image.');
      await client.user.setAvatar(url).catch(() => message.reply('❌ Impossible (limite Discord: 2x/heure)'));
      return message.reply(`✅ Avatar du bot mis à jour !`);
    }

    // ===== GIVEAWAY =====
    case 'giveaway': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const duration = args[0];
      const winners = parseInt(args[1]) || 1;
      const prize = args.slice(2).join(' ');
      if (!duration || !prize) return message.reply('❌ Usage: `!giveaway <durée> <gagnants> <lot>` ex: `!giveaway 1h 1 Nitro`');

      const ms = parseDuration(duration);
      if (!ms) return message.reply('❌ Durée invalide. Ex: 10m, 1h, 1d');

      const endTime = Math.floor((Date.now() + ms) / 1000);

      const embed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`**Lot:** ${prize}\n\n📅 Fin: <t:${endTime}:R>\n👥 Gagnant(s): ${winners}\n\n**Réagis avec 🎉 pour participer !**`)
        .setColor('#F9CA24')
        .setFooter({ text: `Organisé par ${message.author.username} • Fin dans ${duration}` })
        .setTimestamp(Date.now() + ms);

      const msg = await message.channel.send({ embeds: [embed] });
      await msg.react('🎉');

      setTimeout(async () => {
        const refreshed = await msg.fetch();
        const reaction = refreshed.reactions.cache.get('🎉');
        const users = await reaction.users.fetch();
        const participants = users.filter(u => !u.bot);

        if (participants.size === 0) {
          return msg.reply('❌ Pas de participants, le giveaway est annulé.');
        }

        const winnersList = participants.random(Math.min(winners, participants.size));
        const winnersText = Array.isArray(winnersList) ? winnersList.map(u => u.toString()).join(', ') : winnersList.toString();

        const endEmbed = new EmbedBuilder()
          .setTitle('🎉 GIVEAWAY TERMINÉ')
          .setDescription(`**Lot:** ${prize}\n\n🏆 **Gagnant(s):** ${winnersText}`)
          .setColor('#27AE60')
          .setTimestamp();

        await msg.edit({ embeds: [endEmbed] });
        await msg.reply(`🎉 Félicitations ${winnersText} ! Vous avez gagné **${prize}** !`);
      }, ms);

      break;
    }

    // ===== POLL =====
    case 'poll': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');
      const question = args.join(' ');
      if (!question) return message.reply('❌ Fournis une question.');

      const embed = new EmbedBuilder()
        .setTitle('📊 Sondage')
        .setDescription(question)
        .setColor(config.embedColor)
        .setFooter({ text: `Sondage par ${message.author.username}` })
        .setTimestamp();

      const msg = await message.channel.send({ embeds: [embed] });
      await msg.react('👍');
      await msg.react('👎');
      await msg.react('🤷');
      await message.delete().catch(() => {});
      break;
    }

    // ===== TRANSCRIPT =====
    case 'transcript': {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply('❌ Permission refusée.');

      const targetChannel = message.mentions.channels.first() || message.channel;
      if (!targetChannel.isTextBased())
        return message.reply('❌ Le salon cible doit être un salon textuel.');

      const loadingMsg = await message.reply(`⏳ Génération du transcript de ${targetChannel} en cours...`);

      try {
        // Fetch jusqu'à 500 messages (limite API Discord = 100 par requête)
        let allMessages = [];
        let lastId = null;

        for (let i = 0; i < 5; i++) {
          const options = { limit: 100 };
          if (lastId) options.before = lastId;

          const batch = await targetChannel.messages.fetch(options);
          if (batch.size === 0) break;

          allMessages = allMessages.concat([...batch.values()]);
          lastId = batch.last().id;
        }

        // Tri chronologique (du plus ancien au plus récent)
        allMessages.reverse();

        if (allMessages.length === 0) {
          await loadingMsg.delete().catch(() => {});
          return message.reply('❌ Aucun message trouvé dans ce salon.');
        }

        // Génération du fichier texte
        const separator = '═'.repeat(50);
        const lines = [
          separator,
          `  📄 TRANSCRIPT — #${targetChannel.name}`,
          `  🏠 Serveur   : ${message.guild.name}`,
          `  📅 Date      : ${new Date().toLocaleString('fr-FR')}`,
          `  💬 Messages  : ${allMessages.length}`,
          `  🔗 ID Salon  : ${targetChannel.id}`,
          separator,
          '',
        ];

        for (const msg of allMessages) {
          const date = msg.createdAt.toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
          const authorTag = msg.author.tag;
          const botTag = msg.author.bot ? ' [BOT]' : '';
          let content = msg.content || '';

          // Pièces jointes
          if (msg.attachments.size > 0) {
            const attachList = [...msg.attachments.values()]
              .map(a => `📎 [Fichier: ${a.name}] → ${a.url}`)
              .join('\n           ');
            content += (content ? '\n           ' : '') + attachList;
          }

          // Embeds
          if (msg.embeds.length > 0) {
            const embedList = msg.embeds
              .map(e => {
                const title = e.title || 'Sans titre';
                const desc = e.description ? ` — ${e.description.substring(0, 80)}${e.description.length > 80 ? '...' : ''}` : '';
                return `📌 [Embed: ${title}${desc}]`;
              })
              .join('\n           ');
            content += (content ? '\n           ' : '') + embedList;
          }

          // Stickers
          if (msg.stickers.size > 0) {
            const stickerList = [...msg.stickers.values()]
              .map(s => `🎭 [Sticker: ${s.name}]`)
              .join('\n           ');
            content += (content ? '\n           ' : '') + stickerList;
          }

          // Réactions
          if (msg.reactions.cache.size > 0) {
            const reactionList = [...msg.reactions.cache.values()]
              .map(r => `${r.emoji.name} ×${r.count}`)
              .join(' ');
            content += (content ? `\n           🔁 Réactions: ${reactionList}` : `🔁 Réactions: ${reactionList}`);
          }

          if (!content) content = '[Message vide ou non pris en charge]';

          // Message épinglé
          const pinned = msg.pinned ? ' 📌' : '';

          lines.push(`[${date}]${pinned} ${authorTag}${botTag}`);
          lines.push(`           ${content}`);
          lines.push('');
        }

        lines.push(separator);
        lines.push(`  Fin du transcript — ${allMessages.length} message(s) exporté(s)`);
        lines.push(`  Généré par ${message.author.tag}`);
        lines.push(separator);

        const transcriptText = lines.join('\n');
        const buffer = Buffer.from(transcriptText, 'utf-8');
        const fileName = `transcript-${targetChannel.name}-${Date.now()}.txt`;
        const attachment = new AttachmentBuilder(buffer, { name: fileName });

        // Embed de confirmation
        const confirmEmbed = new EmbedBuilder()
          .setTitle('📄 Transcript généré')
          .addFields(
            { name: 'Salon', value: targetChannel.toString(), inline: true },
            { name: 'Messages', value: `${allMessages.length}`, inline: true },
            { name: 'Généré par', value: message.author.tag, inline: true },
          )
          .setColor('#2ED573')
          .setFooter({ text: `Fichier : ${fileName}` })
          .setTimestamp();

        // Supprime le message de chargement
        await loadingMsg.delete().catch(() => {});

        // Envoi en DM
        try {
          await message.author.send({
            content: `📄 Transcript de **#${targetChannel.name}** sur **${message.guild.name}** :`,
            embeds: [confirmEmbed],
            files: [attachment],
          });
          return message.reply({ content: `✅ Transcript envoyé en DM ! (**${allMessages.length}** messages exportés)`, embeds: [confirmEmbed] });
        } catch (dmErr) {
          // Fallback : envoi dans le salon courant si DMs fermés
          await message.channel.send({
            content: `📄 Impossible d'envoyer en DM — voici le transcript de **#${targetChannel.name}** :`,
            embeds: [confirmEmbed],
            files: [attachment],
          });
        }

      } catch (err) {
        console.error('Transcript error:', err);
        await loadingMsg.delete().catch(() => {});
        return message.reply('❌ Une erreur est survenue lors de la génération du transcript.');
      }
      break;
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
    if (interaction.isRepliable()) {
      return interaction.reply({ content: '❌ Seul **stiroxbereal** peut interagir avec ce bot.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isButton()) {
    const data = loadData();

    if (interaction.customId === 'help_mod') {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🛡️ Modération')
          .setColor('#FF4757')
          .addFields(
            { name: '`!ban <@user> [raison]`', value: 'Bannir', inline: true },
            { name: '`!kick <@user> [raison]`', value: 'Expulser', inline: true },
            { name: '`!mute <@user> [durée]`', value: 'Muet', inline: true },
            { name: '`!warn <@user> [raison]`', value: 'Avertir', inline: true },
            { name: '`!clear <nombre>`', value: 'Supprimer messages', inline: true },
            { name: '`!lock / !unlock`', value: 'Verrouiller salon', inline: true },
            { name: '`!muteusersalon <@user> [#salon]`', value: 'Mute salon', inline: true },
            { name: '`!unmuteusersalon <@user> [#salon]`', value: 'Unmute salon', inline: true },
            { name: '`!transcript [#salon]`', value: 'Transcript en .txt (DM)', inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'help_embed') {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🎨 Embeds')
          .setColor('#5352ED')
          .addFields(
            { name: '`!embed create`', value: 'Créer un embed', inline: true },
            { name: '`!embed send <#salon>`', value: 'Envoyer', inline: true },
            { name: '`!say <texte>`', value: 'Parler', inline: true },
            { name: '`!announce <#salon> <texte>`', value: 'Annonce', inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'help_config') {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('⚙️ Configuration')
          .setColor('#747D8C')
          .addFields(
            { name: '`!setwelcome <#salon>`', value: 'Bienvenue', inline: true },
            { name: '`!setleave <#salon>`', value: 'Départ', inline: true },
            { name: '`!setlogs <#salon>`', value: 'Logs', inline: true },
            { name: '`!antilinks on/off`', value: 'Anti-liens', inline: true },
            { name: '`!botname <nom>`', value: 'Renommer bot', inline: true },
            { name: '`!botavatar <url>`', value: 'Changer avatar', inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'help_info') {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('ℹ️ Informations')
          .setColor('#2ED573')
          .addFields(
            { name: '`!userinfo [@user]`', value: 'Info utilisateur', inline: true },
            { name: '`!serverinfo`', value: 'Info serveur', inline: true },
            { name: '`!botinfo`', value: 'Info bot', inline: true },
            { name: '`!avatar [@user]`', value: 'Avatar', inline: true },
            { name: '`!ping`', value: 'Latence', inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId.startsWith('embed_')) {
      await handleEmbedBuilder(interaction, data);
    }
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
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

  await message.reply({
    content: '🎨 **Éditeur d\'Embed** — Clique sur les boutons pour modifier :',
    embeds: [preview],
    components: [row1, row2],
  });
}

function buildEmbed(draft) {
  const embed = new EmbedBuilder()
    .setTitle(draft.title || null)
    .setDescription(draft.description || null)
    .setColor(draft.color || '#5865F2');

  if (draft.footer) embed.setFooter({ text: draft.footer });
  if (draft.image) embed.setImage(draft.image);
  if (draft.thumbnail) embed.setThumbnail(draft.thumbnail);
  if (draft.author) embed.setAuthor({ name: draft.author });
  if (draft.timestamp) embed.setTimestamp();
  if (draft.fields?.length) {
    draft.fields.forEach(f => embed.addFields({ name: f.name, value: f.value, inline: f.inline || false }));
  }

  return embed;
}

async function handleEmbedBuilder(interaction, data) {
  const userId = interaction.user.id;
  if (!data.embedDrafts?.[userId]) {
    return interaction.reply({ content: '❌ Aucun embed en cours.', flags: MessageFlags.Ephemeral });
  }

  const action = interaction.customId.replace('embed_', '');

  const modals = {
    title: { label: 'Titre de l\'embed', placeholder: 'Mon super titre', max: 256 },
    description: { label: 'Description', placeholder: 'Description de l\'embed...', max: 4000, style: TextInputStyle.Paragraph },
    color: { label: 'Couleur (HEX)', placeholder: '#5865F2', max: 7 },
    footer: { label: 'Texte du footer', placeholder: 'Mon footer', max: 2048 },
    image: { label: 'URL de l\'image', placeholder: 'https://...', max: 500 },
    thumbnail: { label: 'URL de la miniature', placeholder: 'https://...', max: 500 },
    author: { label: 'Nom de l\'auteur', placeholder: 'Auteur', max: 256 },
    addfield: { label: 'Nom du champ', placeholder: 'Titre du champ', max: 256 },
  };

  const modalConfig = modals[action];
  if (!modalConfig) return;

  const modal = new ModalBuilder()
    .setCustomId(`embedmodal_${action}`)
    .setTitle(`Modifier: ${action}`);

  const input = new TextInputBuilder()
    .setCustomId('input_value')
    .setLabel(modalConfig.label)
    .setStyle(modalConfig.style || TextInputStyle.Short)
    .setPlaceholder(modalConfig.placeholder)
    .setMaxLength(modalConfig.max)
    .setRequired(true);

  if (action === 'addfield') {
    const valueInput = new TextInputBuilder()
      .setCustomId('field_value')
      .setLabel('Contenu du champ')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1024)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input),
      new ActionRowBuilder().addComponents(valueInput),
    );
  } else {
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

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

    if (action === 'addfield') {
      const fieldValue = interaction.fields.getTextInputValue('field_value');
      if (!data.embedDrafts[userId].fields) data.embedDrafts[userId].fields = [];
      data.embedDrafts[userId].fields.push({ name: value, value: fieldValue, inline: false });
    } else if (action === 'color') {
      data.embedDrafts[userId].color = value.startsWith('#') ? value : '#' + value;
    } else {
      data.embedDrafts[userId][action] = value;
    }

    saveData(data);
    const preview = buildEmbed(data.embedDrafts[userId]);

    await interaction.reply({
      content: `✅ **${action}** mis à jour ! Aperçu :`,
      embeds: [preview],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleSelectMenu(interaction) {
  // Pour usage futur
}

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
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
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
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .addFields(
      { name: 'Auteur', value: message.author?.tag || 'Inconnu', inline: true },
      { name: 'Salon', value: message.channel.toString(), inline: true },
      { name: 'Contenu', value: message.content?.substring(0, 1000) || '*Aucun contenu*' },
    )
    .setColor('#FF4757')
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  const data = loadData();
  const guildConfig = data.configs[oldMsg.guild?.id];
  if (!guildConfig?.logsChannel) return;
  const channel = oldMsg.guild.channels.cache.get(guildConfig.logsChannel);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .addFields(
      { name: 'Auteur', value: oldMsg.author?.tag || 'Inconnu', inline: true },
      { name: 'Salon', value: oldMsg.channel.toString(), inline: true },
      { name: 'Avant', value: oldMsg.content?.substring(0, 500) || '*Vide*' },
      { name: 'Après', value: newMsg.content?.substring(0, 500) || '*Vide*' },
    )
    .setColor('#FFA502')
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanAdd', async (ban) => {
  const data = loadData();
  const guildConfig = data.configs[ban.guild.id];
  if (!guildConfig?.logsChannel) return;
  const channel = ban.guild.channels.cache.get(guildConfig.logsChannel);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🔨 Utilisateur banni')
    .addFields(
      { name: 'Utilisateur', value: ban.user.tag, inline: true },
      { name: 'Raison', value: ban.reason || 'Aucune raison', inline: true },
    )
    .setColor('#FF4757')
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

// ========================
// CONNEXION
// ========================
client.login(config.token);
