require('dotenv').config();
const axios = require('axios');

// Config
const {
  INSTAGRAM_BUSINESS_ID,
  FACEBOOK_PAGE_ID,
  ACCESS_TOKEN,
  KEYWORD = 'job',
  REPLY_MESSAGE = "Thanks for your interest! Here's our careers page: [your-link]",
  CHECK_INTERVAL_MINUTES = 5
} = process.env;

// Rate limiter
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 1. Correct timestamp parser
function parseCommentTime(timestamp) {
  try {
    // Instagram returns either ISO string or Unix timestamp
    return typeof timestamp === 'string' 
      ? new Date(timestamp).getTime() / 1000
      : timestamp;
  } catch {
    return Date.now() / 1000; // Fallback to current time
  }
}

// 2. Format time display
function formatAge(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds/60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)} hours`;
  return `${Math.floor(seconds/86400)} days`;
}

// 3. Send DM function
async function sendDM(userId, username) {
  try {
    await delay(7000);
    
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${FACEBOOK_PAGE_ID}/messages`,
      {
        recipient: { id: userId },
        message: { text: REPLY_MESSAGE },
        messaging_type: "MESSAGE_TAG",
        tag: "CONFIRMED_EVENT_UPDATE"
      },
      { params: { access_token: ACCESS_TOKEN } }
    );
    
    console.log(`✅ DM sent to @${username}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to DM @${username}:`, error.response?.data?.error?.message || error.message);
    return false;
  }
}

// 4. Main bot logic
async function runBot() {
  console.log(`🔍 Checking for "${KEYWORD}" comments...`);
  
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${INSTAGRAM_BUSINESS_ID}/media`,
      {
        params: {
          fields: 'comments.limit(100){from{id,username},text,created_time,timestamp}',
          access_token: ACCESS_TOKEN
        }
      }
    );

    const now = Date.now() / 1000;
    const sevenDays = 7 * 24 * 3600;
    
    for (const post of response.data.data || []) {
      for (const comment of post.comments?.data || []) {
        if (comment.text.toLowerCase().includes(KEYWORD.toLowerCase())) {
          const commentTime = parseCommentTime(comment.created_time || comment.timestamp);
          const age = now - commentTime;
          
          if (age <= sevenDays) {
            console.log(`📨 New comment from @${comment.from.username} (${formatAge(age)} ago)`);
            await sendDM(comment.from.id, comment.from.username);
          } else {
            console.log(`⏳ Skipping @${comment.from.username} (posted ${formatAge(age)} ago)`);
          }
        }
      }
    }
  } catch (error) {
    console.error('⚠️ API Error:', error.response?.data?.error || error.message);
  } finally {
    setTimeout(runBot, CHECK_INTERVAL_MINUTES * 60000);
  }
}

// Start
console.log('🚀 Bot started');
runBot();