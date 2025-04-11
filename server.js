require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');





// Define your models before using them
const SystemLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'comment_received',
      'dm_success',
      'dm_failed',
      'post_fetch_error',
      'comment_fetch_error',
      'entry_processing_error',
      'api_error',
      'system'
    ],
    required: true
  },
  details: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now }
});

const MessageAttemptSchema = new mongoose.Schema({
  userId: String,
  username: String,
  commentId: { type: String, unique: true },
  postId: String,
  requestId: String,
  messageContent: String,
  attempts: Number,
  status: { type: String, enum: ['pending', 'success', 'failed'] },
  lastAttempt: Date,
  errorLog: [{
    code: Number,
    message: String,
    timestamp: { type: Date, default: Date.now }
  }]
});

const SystemLog = mongoose.model('SystemLog', SystemLogSchema);
const MessageAttempt = mongoose.model('MessageAttempt', MessageAttemptSchema);

const app = express();
app.set('trust proxy', 1); // Important for rate-limiting on Render
app.use(bodyParser.json());


// Configuration
const config = {
  accessToken: process.env.ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  instagramBusinessId: process.env.INSTAGRAM_BUSINESS_ID,
  replyMessage: process.env.REPLY_MESSAGE || "Thanks for your interest! Check out our careers page: {careersLink}",
  careersLink: process.env.CAREERS_LINK,
  targetKeywords: (process.env.TARGET_KEYWORDS || 'job,career,hiring,work').toLowerCase().split(','),
  bannedKeywords: (process.env.BANNED_KEYWORDS || 'spam,scam,free').toLowerCase().split(','),
  maxAttempts: parseInt(process.env.MAX_ATTEMPTS) || 3,
  messageDelay: parseInt(process.env.MESSAGE_DELAY) || 7000,
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  fetchInterval: parseInt(process.env.FETCH_INTERVAL) || 300000,
  maxCommentsToFetch: parseInt(process.env.MAX_COMMENTS_TO_FETCH) || 100,
  maxPostsToMonitor: parseInt(process.env.MAX_POSTS_TO_MONITOR) || 10,
  lookbackPeriod: parseInt(process.env.LOOKBACK_PERIOD) || 7 * 24 * 60 * 60 * 1000
};


// Rate limiting
const apiLimiter = rateLimit({
    windowMs: config.rateLimitWindow,
    max: config.rateLimitMax,
    message: 'Too many requests, please try again later'
  });
  app.use('/webhook', apiLimiter);

  app.get('/', (req, res) => {
    res.send('🚀 Instagram Automation Webhook is live.');
  });
  
  
  // MongoDB connection (updated to remove deprecated options)
  const connectWithRetry = () => {
    mongoose.connect(process.env.MONGODB_URI)
      .then(() => console.log('✅ MongoDB connected'))
      .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        setTimeout(connectWithRetry, 5000);
      });
  };
  connectWithRetry();

// MongoDB connection with retry
// const connectWithRetry = () => {
//   mongoose.connect(process.env.MONGODB_URI, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//     retryWrites: true,
//     w: 'majority'
//   }).then(() => {
//     console.log('✅ MongoDB connected');
//   }).catch(err => {
//     console.error('❌ MongoDB connection error:', err);
//     setTimeout(connectWithRetry, 5000);
//   });
// };
// connectWithRetry();

// Request validation
const validateWebhookRequest = (req, res, next) => {
  if (req.query['hub.mode'] === 'subscribe') return next();
  
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('Missing signature header');
    return res.sendStatus(403);
  }
  const hmac = crypto.createHmac('sha256', process.env.APP_SECRET);
  const digest = `sha256=${hmac.update(JSON.stringify(req.body)).digest('hex')}`;

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    console.error('❌ Invalid signature');
    return res.sendStatus(403);
  }
  next();
};


// Webhook endpoints
// app.get('/webhook', validateWebhookRequest, (req, res) => {
//   const mode = req.query['hub.mode'];
//   const token = req.query['hub.verify_token'];
//   const challenge = req.query['hub.challenge'];

//   if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
//     console.log('🔐 Webhook verified');
//     res.status(200).send(challenge);
//   } else {
//     console.warn('⚠️ Webhook verification failed');
//     res.sendStatus(403);
//   }
// });

// app.post('/webhook', validateWebhookRequest, async (req, res) => {
//   try {
//     const data = req.body;
//     console.log('📩 Incoming webhook:', JSON.stringify(data, null, 2));

//     if (!data.entry) return res.status(200).send('EVENT_RECEIVED');

//     await Promise.all(data.entry.map(async (entry) => {
//       try {
//         for (const change of entry.changes || []) {
//           if (change.field === 'comments') {
//             await handleComment(change.value);
//           }
//         }
//       } catch (error) {
//         console.error('Error processing entry:', error);
//         await SystemLog.create({
//           type: 'entry_processing_error',
//           details: { error: error.message, entry }
//         });
//       }
//     }));

//     res.status(200).send('EVENT_PROCESSED');
//   } catch (error) {
//     console.error('❌ Webhook processing error:', error);
//     res.status(500).send('SERVER_ERROR');
//   }
// });

// Instagram API functions

// app.get('/webhook', (req, res) => {
//   const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

//   const mode = req.query['hub.mode'];
//   const token = req.query['hub.verify_token'];
//   const challenge = req.query['hub.challenge'];

//   if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
//     console.log('✅ Webhook verified successfully!');
//     res.status(200).send(challenge);
//   } else {
//     res.sendStatus(403);
//   }
// });

// app.post('/webhook', (req, res) => {
//   console.log('🔥 Webhook event received:', JSON.stringify(req.body, null, 2));

//   const body = req.body;

//   if (body.object === 'instagram') {
//     body.entry.forEach(entry => {
//       const changes = entry.changes;
//       changes.forEach(change => {
//         if (change.field === 'comments') {
//           const comment = change.value.text;
//           const username = change.value.from.username;
//           console.log(`💬 ${username} commented: ${comment}`);
//         }
//       });
//     });

//     res.status(200).send('EVENT_RECEIVED');
//   } else {
//     res.sendStatus(404);
//   }
// });

// Updated webhook endpoints
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Verification failed. Expected token:', VERIFY_TOKEN, 'Got:', token);
    res.sendStatus(403);
  }
});

app.post('/webhook', validateSignature, (req, res) => {
  console.log('📩 Valid webhook event:', req.body.object);
  
  try {
    const body = req.body;
    if (body.object !== 'instagram') return res.sendStatus(404);

    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        if (change.field === 'comments') {
          const comment = change.value;
          console.log(`💬 New comment from ${comment.from?.username}:`, comment.text);
          // Add your comment processing logic here
        }
      });
    });

    res.status(200).send('EVENT_PROCESSED');
  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    res.sendStatus(500);
  }
});


async function fetchRecentPosts() {
  try {
    const url = `https://graph.facebook.com/v19.0/${config.instagramBusinessId}/media`;
    const response = await axios.get(url, {
      params: {
        fields: 'id,caption,comments_count,timestamp',
        limit: config.maxPostsToMonitor,
        access_token: config.accessToken
      },
      timeout: 10000
    });
    return response.data.data || [];
  } catch (error) {
    console.error('❌ Failed to fetch posts:', error.message);
    await SystemLog.create({
      type: 'post_fetch_error',
      details: { error: error.response?.data || error.message }
    });
    return [];
  }
}

async function fetchRecentComments(postId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${postId}/comments`;
    const response = await axios.get(url, {
      params: {
        fields: 'id,text,username,from,created_time',
        order: 'reverse_chronological',
        limit: config.maxCommentsToFetch,
        access_token: config.accessToken
      },
      timeout: 10000
    });
    return response.data.data || [];
  } catch (error) {
    console.error(`❌ Failed to fetch comments for post ${postId}:`, error.message);
    await SystemLog.create({
      type: 'comment_fetch_error',
      details: { postId, error: error.response?.data || error.message }
    });
    return [];
  }
}

// Comment processing
async function handleComment(comment) {
  const commentId = comment.id;
  const text = (comment.text || '').toLowerCase();
  const username = comment.username || 'unknown_user';
  const userId = comment.from?.id || comment.from || 'unknown_id';
  const postId = comment.media?.id || comment.media_id;
  const requestId = uuidv4();

  const logEntry = await SystemLog.create({
    type: 'comment_received',
    details: { commentId, username, text, requestId }
  });

  // Keyword validation
  if (!config.targetKeywords.some(kw => text.includes(kw))) {
    logEntry.details.reason = 'no_target_keyword';
    await logEntry.save();
    return;
  }

  if (config.bannedKeywords.some(kw => text.includes(kw))) {
    logEntry.details.reason = 'banned_keyword';
    await logEntry.save();
    console.log(`🚫 Banned keyword found in comment by ${username}`);
    return;
  }

  try {
    const existing = await MessageAttempt.findOne({ commentId });
    if (existing) {
      if (existing.status === 'success') {
        console.log(`⚠️ Already processed comment from ${username}`);
        return;
      }
      if (existing.attempts >= config.maxAttempts) {
        console.log(`⚠️ Max attempts reached for comment ${commentId}`);
        return;
      }
      const timeSinceLastAttempt = Date.now() - existing.lastAttempt.getTime();
      if (timeSinceLastAttempt < config.messageDelay) {
        await new Promise(resolve => 
          setTimeout(resolve, config.messageDelay - timeSinceLastAttempt)
        );
      }
    }

    const attempt = existing || new MessageAttempt({
      userId,
      username,
      commentId,
      postId,
      requestId,
      messageContent: config.replyMessage.replace('{careersLink}', config.careersLink),
      attempts: 0,
      status: 'pending'
    });

    attempt.attempts += 1;
    attempt.lastAttempt = new Date();
    await attempt.save();

    await sendInstagramDM(userId, attempt.messageContent, requestId);

    attempt.status = 'success';
    attempt.responseId = 'dm_sent';
    await attempt.save();

    await SystemLog.create({
      type: 'dm_success',
      details: { commentId, username, requestId }
    });

    console.log(`✅ Message sent to ${username}`);
  } catch (error) {
    console.error('❌ Failed to send DM:', error?.response?.data || error.message);
    await SystemLog.create({
      type: 'dm_failed',
      details: {
        error: error?.response?.data || error.message,
        commentId,
        username,
        requestId
      }
    });
    await MessageAttempt.updateOne(
      { commentId },
      {
        $set: { status: 'failed' },
        $push: {
          errorLog: {
            code: error.response?.data?.error?.code || 500,
            message: error.response?.data?.error?.message || error.message,
            timestamp: new Date()
          }
        }
      }
    );
  }
}

// DM sending with retry
async function sendInstagramDM(userId, message, requestId) {
  const url = `https://graph.facebook.com/v19.0/${config.instagramBusinessId}/messages`;
  try {
    const response = await axios.post(url, {
      recipient: { id: userId },
      message: { text: message },
      messaging_type: 'RESPONSE'
    }, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'X-Request-ID': requestId
      },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.code === 10) {
      const retryAfter = error.response.headers['retry-after'] || 60;
      console.warn(`⚠️ Rate limited. Retrying after ${retryAfter} seconds`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return sendInstagramDM(userId, message, requestId);
    }
    throw error;
  }
}

// Automatic comment polling
async function processExistingComments() {
    try {
      const posts = await fetchRecentPosts();
      console.log(`🔄 Found ${posts.length} recent posts to monitor`);
  
      for (const post of posts) {
        const postDate = new Date(post.timestamp);
        if (Date.now() - postDate > config.lookbackPeriod) continue;
  
        try {
          const comments = await fetchRecentComments(post.id);
          console.log(`📝 Found ${comments.length} comments on post ${post.id}`);
  
          for (const comment of comments) {
            try {
              await handleComment({
                id: comment.id,
                text: comment.text,
                username: comment.username || comment.from?.name,
                from: comment.from?.id,
                media: { id: post.id },
                created_time: comment.created_time
              });
            } catch (commentError) {
              console.error(`❌ Error processing comment ${comment.id}:`, commentError.message);
              await SystemLog.create({
                type: 'api_error',
                details: {
                  error: commentError.message,
                  postId: post.id,
                  commentId: comment.id
                }
              });
            }
          }
        } catch (postError) {
          console.error(`❌ Error processing comments for post ${post.id}:`, postError.message);
          await SystemLog.create({
            type: 'comment_fetch_error',
            details: {
              error: postError.message,
              postId: post.id
            }
          });
        }
      }
    } catch (error) {
      console.error('❌ Error in comment processing cycle:', error.message);
      await SystemLog.create({
        type: 'system',
        details: {
          error: error.message,
          event: 'comment_processing_cycle'
        }
      });
    }
  }

function startCommentPolling() {
  processExistingComments();
  setInterval(processExistingComments, config.fetchInterval);
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date(),
    dbState: mongoose.connection.readyState
  });
});

// Server startup
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startCommentPolling();
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('🔴 Server and MongoDB connection closed');
      process.exit(0);
    });
  });
});
