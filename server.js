require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./config/db');
const logger = require('./config/logger');
const { handleCommentEvent } = require('./services/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
connectDB();

// Middleware
app.use(bodyParser.json());

// Routes
app.get('/', (req, res) => res.send('Instagram Bot Running'));

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
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
    logger.error('Webhook error', { error: error.message });
    res.status(500).send('SERVER_ERROR');
  }
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});