require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

let allowedUsers = new Set();

// ===================== EVENTSUB CALLBACK =====================
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
      console.log(`🎁 ${user_name} canjeó: ${reward.title}`);
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

app.post('/api/consume/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const wasAllowed = allowedUsers.has(username);
  allowedUsers.delete(username);
  res.json({ consumed: wasAllowed });
});

app.listen(port, () => {
  console.log(`🟢 Servidor escuchando en http://localhost:${port}`);
});
