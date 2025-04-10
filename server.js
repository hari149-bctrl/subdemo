const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database for tracking sent messages (in-memory for simplicity)
const messageTracker = new Map(); // Format: { userId: { attempts: number, lastAttempt: timestamp } }

// Middleware
app.use(bodyParser.json());

// Root Route
app.get('/', (req, res) => {
  res.send('✅ Webhook server is live and ready!');
});

// Webhook Verification - GET
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'webbrainy';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('🔗 Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Verification failed: Invalid token');
      res.sendStatus(403);
    }
  } else {
    res.status(400).send('Bad Request: Missing parameters');
  }
});

// Improved Webhook Handler
app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('📬 Webhook Event Received');

  try {
    if (body.object === 'instagram' && body.entry) {
      for (const entry of body.entry) {
        if (entry.changes?.[0]?.field === 'comments') {
          await handleCommentEvent(entry.changes[0].value);
        }
      }
    }
    res.status(200).send('EVENT_PROCESSED');
  } catch (error) {
    console.error('⚠️ Webhook Error:', error);
    res.status(500).send('PROCESSING_ERROR');
  }
});

// Message Handling Logic
async function handleCommentEvent(commentData) {
  const userId = commentData.from.id;
  const currentAttempts = messageTracker.get(userId)?.attempts || 0;

  // Skip if already attempted twice
  if (currentAttempts >= 2) {
    console.log(`⏭️ Skipping @${commentData.from.username} (max attempts reached)`);
    return;
  }

  // Skip if sent successfully before
  if (messageTracker.get(userId)?.status === 'success') {
    console.log(`⏭️ Skipping @${commentData.from.username} (already succeeded)`);
    return;
  }

  try {
    console.log(`✉️ Attempting to message @${commentData.from.username} (attempt ${currentAttempts + 1})`);
    
    // Replace with your actual DM sending logic
    const success = await sendInstagramDM(
      userId,
      "Your reply message here"
    );

    // Update tracker
    messageTracker.set(userId, {
      attempts: currentAttempts + 1,
      status: success ? 'success' : 'failed',
      lastAttempt: Date.now()
    });

  } catch (error) {
    console.error(`❌ Failed to message @${commentData.from.username}:`, error.message);
    messageTracker.set(userId, {
      attempts: currentAttempts + 1,
      status: 'failed',
      lastAttempt: Date.now()
    });
  }
}

// Mock DM function (replace with your actual implementation)
async function sendInstagramDM(userId, message) {
    const accessToken = process.env.ACCESS_TOKEN;
    const instagramBusinessId = process.env.INSTAGRAM_BUSINESS_ID;
  
    const url = `https://graph.facebook.com/v19.0/${instagramBusinessId}/messages`;
  
    try {
      const response = await axios.post(
        url,
        {
          recipient: { id: userId },
          messaging_type: 'RESPONSE',
          message: { text: message },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      console.log(`✅ Message sent to user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ DM send failed:', error.response?.data || error.message);
      return false;
    } 
}

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log('🔒 Message tracking enabled (max 2 attempts per user)');
});