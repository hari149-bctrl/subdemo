require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./config/db');
const { handleCommentEvent } = require('./services/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize
connectDB();

// Middleware
app.use(bodyParser.json());

// Routes
app.get('/', (req, res) => res.send('🤖 Instagram Auto-DM Bot Active'));

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    console.log('🔐 Webhook verified');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.warn('⚠️ Invalid verification token');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    if (req.body.object === 'instagram' && req.body.entry) {
      for (const entry of req.body.entry) {
        if (entry.changes?.[0]?.field === 'comments') {
          await handleCommentEvent(entry.changes[0].value);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('💣 Webhook error:', error);
    res.status(500).send('SERVER_ERROR');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Webhook URL: https://yourdomain.com/webhook`);
});