# 🤖 Bot Discord Polyvalent

## 📦 Installation

### 1. Installer les dépendances
```bash
npm install
```

### 2. Configurer le bot
Modifie `config.json` :
```json
{
  "token": "VOTRE_TOKEN_BOT",
  "clientId": "VOTRE_CLIENT_ID",
  "prefix": "!",
  "botName": "MonBot",
  "embedColor": "#5865F2",
  "inviteLink": "https://discord.com/api/oauth2/authorize?client_id=VOTRE_CLIENT_ID&permissions=8&scope=bot"
}
```

### 3. Obtenir le token
1. Va sur https://discord.com/developers/applications
2. Crée une nouvelle application
3. Onglet "Bot" → "Reset Token"
4. Copie le token dans `config.json`
5. Active les **Privileged Gateway Intents** (Server Members, Message Content, Presence)

### 4. Lancer le bot
```bash
npm start
```

---

## 🚀 Déploiement sur Render (Gratuit)

1. Crée un compte sur https://render.com
2. "New" → "Web Service"
3. Connecte ton dépôt GitHub
4. Configure :
   - **Build Command:** `npm install`
   - **Start Command:** `node bot.js`
   - **Environment:** Node
5. Ajoute la variable d'environnement : `DISCORD_TOKEN` = ton token
6. Modifie `config.json` pour lire depuis l'env :

```js
token: process.env.DISCORD_TOKEN || config.token
```

Le serveur keepalive sur le port 3000 maintient le bot actif automatiquement !

---

## 📋 Commandes

### 🛡️ Modération
| Commande | Description |
|----------|-------------|
| `!ban <@user> [raison]` | Bannir |
| `!unban <id>` | Débannir |
| `!kick <@user> [raison]` | Expulser |
| `!mute <@user> <durée> [raison]` | Rendre muet (10m, 1h, 1d) |
| `!unmute <@user>` | Retirer mute |
| `!warn <@user> [raison]` | Avertir |
| `!warns <@user>` | Voir avertissements |
| `!clearwarns <@user>` | Supprimer avertissements |
| `!clear <1-100>` | Supprimer messages |
| `!slowmode <secondes>` | Slowmode |
| `!lock / !unlock` | Verrouiller/déverrouiller |
| `!nick <@user> <pseudo>` | Changer pseudo |
| `!role <@user> <@role>` | Donner/retirer rôle |

### 🎨 Embeds
| Commande | Description |
|----------|-------------|
| `!embed create` | Créer un embed interactif |
| `!embed send <#salon>` | Envoyer l'embed |
| `!say <texte>` | Faire parler le bot |
| `!announce <#salon> <texte>` | Annonce avec @everyone |

### 🎉 Divertissement
| Commande | Description |
|----------|-------------|
| `!giveaway <durée> <gagnants> <lot>` | Créer un giveaway |
| `!poll <question>` | Créer un sondage |

### ℹ️ Informations
| Commande | Description |
|----------|-------------|
| `!userinfo [@user]` | Info utilisateur |
| `!serverinfo` | Info serveur |
| `!botinfo` | Info bot |
| `!avatar [@user]` | Avatar |
| `!roles` | Liste rôles |
| `!ping` | Latence |

### ⚙️ Configuration (Admin)
| Commande | Description |
|----------|-------------|
| `!setwelcome <#salon>` | Salon bienvenue |
| `!setleave <#salon>` | Salon départ |
| `!setlogs <#salon>` | Salon logs |
| `!setwelcomemsg <message>` | Message bienvenue |
| `!setauthorole <@role>` | Rôle automatique |
| `!antilinks on/off` | Anti-liens |
| `!antiinvites on/off` | Anti-invitations |
| `!setprefix <prefix>` | Changer préfixe |
| `!botname <nom>` | Renommer le bot |
| `!botavatar <url>` | Changer l'avatar |

### Variables bienvenue
- `{user}` → Mention de l'utilisateur
- `{username}` → Nom d'utilisateur
- `{count}` → Nombre de membres
- `{server}` → Nom du serveur

---

## 🔒 Permissions nécessaires
Le bot nécessite les permissions suivantes :
- Administrator (recommandé pour toutes les fonctions)
- Ou : Ban Members, Kick Members, Manage Messages, Manage Roles, Manage Channels, Moderate Members

---

## ⚡ Fonctionnalités automatiques
- ✅ Auto-sanctions (mute à 3 warns, ban à 5 warns)
- ✅ Logs automatiques (messages supprimés/modifiés, bans)
- ✅ Statut rotatif
- ✅ Keepalive intégré (Render)
- ✅ Anti-spam liens & invitations Discord
