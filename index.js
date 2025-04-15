require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

let userAccessToken = null;
let allowedUsers = new Set();

app.get('/auth/login', (req, res) => {
  const redirectUri = process.env.TWITCH_CALLBACK_URL;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const scope = 'channel:read:redemptions channel:manage:redemptions';
  const authUrl = \`https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=\${clientId}&redirect_uri=\${redirectUri}&scope=\${scope}\`;
  res.redirect(authUrl);
});

app.get('/twitch/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TWITCH_CALLBACK_URL
      }
    });

    userAccessToken = tokenRes.data.access_token;
    console.log('🔓 Token de usuario obtenido con éxito ✅');

    await setupEventSub();
    res.send("✅ Token de Twitch recibido. Ya puedes cerrar esta pestaña.");
  } catch (err) {
    console.error('❌ Error al obtener token de usuario:', err.response?.data || err.message);
    res.send("❌ Error al obtener token de usuario");
  }
});

async function getBroadcasterId() {
  const res = await axios.get('https://api.twitch.tv/helix/users?login=JoanMiii', {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      'Authorization': \`Bearer \${userAccessToken}\`
    }
  });

  console.log("🔍 Usuario obtenido:", res.data);
  return res.data.data[0].id;
}

async function setupEventSub() {
  const broadcasterId = await getBroadcasterId();

  await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: {
      broadcaster_user_id: broadcasterId
    },
    transport: {
      method: 'webhook',
      callback: process.env.TWITCH_CALLBACK_URL,
      secret: 'joanmiii-secret'
    }
  }, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      'Authorization': \`Bearer \${userAccessToken}\`,
      'Content-Type': 'application/json'
    }
  });

  console.log('🔔 Suscripción a recompensas configurada con token de usuario');
}

function verifyTwitchSignature(req) {
  const messageId = req.header('Twitch-Eventsub-Message-Id');
  const timestamp = req.header('Twitch-Eventsub-Message-Timestamp');
  const signature = req.header('Twitch-Eventsub-Message-Signature');
  const message = messageId + timestamp + req.rawBody;
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', 'joanmiii-secret').update(message).digest('hex');
  return expectedSignature === signature;
}

app.post('/twitch/callback', (req, res) => {
  if (!verifyTwitchSignature(req)) {
    console.log('⛔ Firma no válida');
    return res.status(403).send('Forbidden');
  }

  const messageType = req.header('Twitch-Eventsub-Message-Type');

  if (messageType === 'webhook_callback_verification') {
    res.send(req.body.challenge);
  } else if (messageType === 'notification') {
    const { user_name, reward } = req.body.event;
    if (reward.title === process.env.TWITCH_REWARD_NAME) {
      allowedUsers.add(user_name.toLowerCase());
      console.log(\`🎁 \${user_name} canjeó: \${reward.title}\`);
    }
    res.status(200).end();
  } else {
    res.status(200).end();
  }
});

app.get('/api/allowed/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  res.json({ allowed: allowedUsers.has(username) });
});

app.listen(port, () => {
  console.log(\`🟢 Servidor escuchando en http://localhost:\${port}\`);
});
