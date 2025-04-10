require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const connectDB = require('./config/db');
const logger = require('./config/logger');
const { handleCommentEvent } = require('./services/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
connectDB();

// Middleware
app.use(bodyParser.json({ verify: verifyRequestSignature }));

function verifyRequestSignature(req, res, buf, encoding) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !process.env.APP_SECRET) return;
  
  const expected = crypto
    .createHmac('sha256', process.env.APP_SECRET)
    .update(buf)
    .digest('hex');
    
  if (`sha256=${expected}` !== signature) {
    throw new Error('Invalid signature');
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'operational',
    version: '1.0.0',
    endpoints: ['/webhook']
  });
});

app.get('/webhook', (req, res) => {
  const token = req.query['hub.verify_token'];
  if (token === process.env.VERIFY_TOKEN) {
    logger.info('Webhook verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  logger.warn('Invalid verification token');
  res.sendStatus(403);
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
    res.status(200).send('EVENT_PROCESSED');
  } catch (error) {
    logger.error('Webhook processing error', { error: error.message });
    res.status(500).send('PROCESSING_ERROR');
  }
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack
  });
  res.status(500).send('SERVER_ERROR');
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', { error: err.message });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message });
  process.exit(1);
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development'
  });
});