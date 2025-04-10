const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Root Route - for browser check
app.get('/', (req, res) => {
  res.send('✅ Webhook server is live and ready!');
});

// Webhook Verification (GET)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('🔗 Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Webhook Receiver (POST)
app.post('/webhook', (req, res) => {
  const body = req.body;

  console.log('📬 Webhook Received:');
  console.dir(body, { depth: null });

  res.status(200).send('EVENT_RECEIVED');
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is listening on http://localhost:${PORT}`);
});
