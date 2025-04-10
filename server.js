require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const winston = require('winston');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'instagram-bot.log' })
  ]
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
})
.then(() => logger.info('📡 Connected to MongoDB Atlas'))
.catch(err => logger.error('❌ MongoDB connection error:', err));

// MongoDB Schema
const messageSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  username: String,
  attempts: { type: Number, default: 0 },
  status: { type: String, enum: ['none', 'pending', 'success', 'failed'], default: 'none' },
  lastAttempt: Date,
  commentId: String,
  postId: String
}, { timestamps: true });

const MessageAttempt = mongoose.model('MessageAttempt', messageSchema);

// Middleware
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Request Signature Verification
function verifyRequestSignature(req, res, buf, encoding) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    throw new Error('Missing signature header');
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.APP_SECRET)
    .update(buf)
    .digest('hex');

  if (`sha256=${expectedSignature}` !== signature) {
    throw new Error('Invalid request signature');
  }
}

// Rate Limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds between API calls

async function throttledRequest() {
  const now = Date.now();
  const waitTime = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();
}

// Root Route
app.get('/', (req, res) => {
  res.json({
    status: 'operational',
    version: '1.0.0',
    endpoints: ['/webhook']
  });
});

// Webhook Verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    logger.warn('Verification failed: Invalid token');
    return res.sendStatus(403);
  }
  res.status(400).send('Bad Request: Missing parameters');
});

// Webhook Handler
app.post('/webhook', async (req, res) => {
  logger.info('Webhook event received', { event: req.body });

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

// Comment Processor
async function handleCommentEvent(commentData) {
  const { from, text, id: commentId, media: { id: postId } } = commentData;
  const userId = from.id;
  const username = from.username;
  const keyword = text.toLowerCase();

  // Content validation
  const bannedKeywords = ['spam', 'scam', 'http', 'www'];
  if (bannedKeywords.some(kw => keyword.includes(kw))) {
    logger.warn('Skipping banned content', { username, commentId });
    return;
  }

  if (!keyword.includes(process.env.TARGET_KEYWORD || 'job')) {
    logger.debug('Skipping non-target comment', { username, text });
    return;
  }

  let userRecord = await MessageAttempt.findOne({ userId });

  if (!userRecord) {
    userRecord = new MessageAttempt({
      userId,
      username,
      commentId,
      postId
    });
  }

  // Skip if already succeeded or max attempts reached
  if (userRecord.status === 'success') {
    logger.info('Skipping successful recipient', { username });
    return;
  }

  if (userRecord.attempts >= 2) {
    logger.warn('Max attempts reached', { username, attempts: userRecord.attempts });
    return;
  }

  // Exponential backoff
  const retryDelay = Math.min(
    3600000, // Max 1 hour delay
    Math.pow(2, userRecord.attempts) * 1000 // Exponential backoff
  );

  if (userRecord.lastAttempt && (Date.now() - new Date(userRecord.lastAttempt).getTime() < retryDelay)) {
    logger.debug('Waiting for retry delay', { username, nextAttemptIn: `${retryDelay}ms` });
    return;
  }

  logger.info('Processing comment', {
    username,
    attempt: userRecord.attempts + 1,
    commentId,
    postId
  });

  const success = await sendInstagramDM(userId, username, text);

  userRecord.attempts += 1;
  userRecord.status = success ? 'success' : 'failed';
  userRecord.lastAttempt = new Date();

  await userRecord.save();
}

// Enhanced DM Sender
async function sendInstagramDM(userId, username, commentText) {
  await throttledRequest();

  const message = generateResponseMessage(commentText);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.INSTAGRAM_BUSINESS_ID}/messages`,
      {
        recipient: { id: userId },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE',
        message: { text: message },
        timestamp: Math.floor(Date.now() / 1000)
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    logger.info('DM sent successfully', {
      userId,
      username,
      messageId: response.data.message_id
    });
    return true;
  } catch (error) {
    logger.error('DM send failed', {
      userId,
      username,
      error: error.response?.data?.error || error.message,
      status: error.response?.status
    });

    if (error.response?.data?.error?.code === 10) {
      logger.warn('Messaging window expired', { userId });
    }
    return false;
  }
}

// Dynamic Message Generation
function generateResponseMessage(commentText) {
  const baseMessage = process.env.REPLY_MESSAGE || "Thanks for your interest!";
  
  // Add opt-out instruction
  return `${baseMessage}\n\n` +
    `Reply STOP to opt out. ` +
    `Original comment: "${commentText.substring(0, 50)}${commentText.length > 50 ? '...' : ''}"`;
}

// Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });
  res.status(500).send('SERVER_ERROR');
});

// Start Server
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`, {
    environment: process.env.NODE_ENV || 'development',
    instagramBusinessId: process.env.INSTAGRAM_BUSINESS_ID
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message });
  process.exit(1);
});