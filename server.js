const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// Configurations
const IG_USER_ID = process.env.INSTAGRAM_BUSINESS_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// MongoDB connection with improved settings
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.once('open', () => {
  console.log('✅ MongoDB connected');
  startScheduledJobs();
});

// Schemas
const PostSettingSchema = new mongoose.Schema({
  postId: { type: String, required: true, unique: true, index: true },
  customCaption: { type: String, default: '' },
  keyword: { type: String, default: '' },
  message: { type: String, default: '' },
  buttonLinks: {
    type: [{
      title: String,
      url: String
    }],
    default: [
      { title: "Apply Now", url: "https://brainyvoyage.com/hiring" },
      { title: "Join WhatsApp", url: "https://WhatsApp.openinapp.co/Brainy_Voyage" },
      { title: "Watch on YouTube", url: "https://YouTube.openinapp.co/Brainy_Voyage" }
    ]
  }
});

const CommentSchema = new mongoose.Schema({
  postId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  commentID: { type: String, required: true, unique: true },
  commentTime: { 
    type: Date, 
    required: true,
    index: { expireAfterSeconds: 604800 } // 7 days
  },
  commentText: { type: String, required: true },
  msgSentStatus: {
    type: String,
    enum: ['p', 's', 'f', 'i','e'],
    default: 'p'
  },
  retryCount: { type: Number, default: 0 }
}, { timestamps: true });

const PostSetting = mongoose.model('PostSetting', PostSettingSchema);
const Comment = mongoose.model('Comment', CommentSchema);

// Data cache
let cachedAllData = [];

// Instagram API Service
async function fetchInstagramPosts() {
  try {
    console.log('⏳ Fetching Instagram posts...');
    const response = await axios.get(
      `https://graph.facebook.com/v22.0/${IG_USER_ID}/media`,
      {
        params: {
          fields: 'id,caption,permalink,timestamp,comments_count,like_count,comments{id,text,username,timestamp}',
          access_token: ACCESS_TOKEN
        },
        timeout: 10000
      }
    );
    return response.data.data;
  } catch (error) {
    console.error('❌ Instagram API Error:', error.response?.data || error.message);
    throw error;
  }
}

async function fetchComments() {
  try {
    const posts = await fetchInstagramPosts();
    
    const allDataMapped = posts.map(post => ({
      postId: post.id,
      caption: post.caption,
      permalink: post.permalink,
      timestamp: post.timestamp,
      comments_count: post.comments_count,
      like_count: post.like_count,
      comments: (post.comments?.data || []).map(comment => ({
        commentID: comment.id,
        commentText: comment.text,
        commentTime: comment.timestamp,
        commentUsername: comment.username,
        timestamp: comment.timestamp 
      }))
    }));

    const allData = posts.map(post => ({
      postId: post.id,
      comments: (post.comments?.data || []).map(comment => ({
        username: comment.username,
        commentID: comment.id,
        commentText: comment.text,
        commentTime: comment.timestamp,
      }))
    }));

    cachedAllData = allDataMapped;
    console.log('✅ Comments fetched and cached');
    await saveCommentsToMongo(allData);
    return allDataMapped;
  } catch (error) {
    console.error('❌ Error in fetchComments:', error.message);
    return [];
  }
}

async function saveCommentsToMongo(allData) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const postIds = allData.map(post => post.postId);
  
  try {
    const settings = await PostSetting.find({ postId: { $in: postIds } });
    const settingsMap = new Map(settings.map(s => [s.postId, s]));

    const bulkOps = allData.flatMap(post => {
      const setting = settingsMap.get(post.postId);
      if (!setting) return [];

      return post.comments
        .filter(comment => new Date(comment.commentTime) >= sevenDaysAgo)
        .map(comment => ({
          updateOne: {
            filter: { commentID: comment.commentID },
            update: {
              $set: {
                postId: post.postId,
                username: comment.username,
                commentID: comment.commentID,
                commentTime: new Date(comment.commentTime),
                commentText: comment.commentText
              },
              $setOnInsert: { msgSentStatus: 'p' }
            },
            upsert: true
          }
        }));
    });

    if (bulkOps.length > 0) {
      const result = await Comment.bulkWrite(bulkOps);
      console.log(`💾 Saved comments: ${result.upsertedCount} new, ${result.modifiedCount} updated`);
    } else {
      console.log('ℹ️ No new comments to save');
    }
  } catch (err) {
    console.error('❌ Error saving comments:', err);
  }
}

async function sendMessageWithButtons(commentId, message, buttons) {
  try {
    console.log("commentId:",commentId)
    console.log("message:",message)
    console.log("buttons:",buttons)
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${FB_PAGE_ID}/messages`,
      {
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: message, // Main message text here
              buttons: [
                {
                  type: "web_url",
                  url: "https://WhatsApp.openinapp.co/Brainy_Voyage",
                  title: "Join WhatsApp"
                },
                {
                  type: "web_url",
                  url: "https://YouTube.openinapp.co/Brainy_Voyage",
                  title: "Watch on YouTube"
                }
              ]
            }
          }
        }
      },
      {
        params: { access_token: ACCESS_TOKEN },
        timeout: 10000
      }
    );
    return response.data;
  } catch (error) {
    console.error('❌ Message sending failed:', error.response?.data || error.message);
    throw error;
  }
}

async function dispatchMessages() {
  try {
    console.log('🔍 Checking for pending messages...');
    const pendingComments = await Comment.find({ 
      msgSentStatus: 'p',
      retryCount: { $lt: 3 } // Only try 3 times
    }).limit(20); // Process 20 at a time

    if (pendingComments.length === 0) {
      console.log('ℹ️ No pending messages to process');
      return;
    }

    for (const comment of pendingComments) {
      try {
        const setting = await PostSetting.findOne({ postId: comment.postId });
        if (!setting || !setting.keyword) {
          await Comment.updateOne(
            { _id: comment._id },
            { msgSentStatus: 'i' }
          );
          continue;
        }

        if (comment.commentText.toLowerCase().includes(setting.keyword.toLowerCase())) {
          await sendMessageWithButtons(
            comment.commentID,
            setting.message,
            setting.buttonLinks
          );

          await Comment.updateOne(
            { _id: comment._id },
            { 
              msgSentStatus: 's',
              $inc: { retryCount: 1 }
            }
          );
          console.log(`✅ Sent message for comment ${comment.commentID}`);
        } else {
          await Comment.updateOne(
            { _id: comment._id },
            { msgSentStatus: 'i' }
          );
        }
      } catch (err) {
        console.error(`❌ Failed to process comment ${comment.commentID}:`, err.message);
        await Comment.updateOne(
          { _id: comment._id },
          { 
            msgSentStatus: 'f',
            $inc: { retryCount: 1 }
          }
        );
      }
    }
  } catch (err) {
    console.error('❌ Error in dispatchMessages:', err);
  }
}

// Routes
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await fetchComments();
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { postId, customCaption, keyword, message, buttonLinks } = req.body;
    const updated = await PostSetting.findOneAndUpdate(
      { postId },
      { customCaption, keyword, message, buttonLinks },
      { upsert: true, new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error('❌ Settings save error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});


app.get('/api/settings/:postId', async (req, res) => {
  try {
    const [setting, dbComments, fullPost] = await Promise.all([
      PostSetting.findOne({ postId: req.params.postId }),
      Comment.find({ postId: req.params.postId }),
      cachedAllData.find(p => p.postId === req.params.postId)
    ]);

    if (!fullPost) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ 
      settings: setting || {}, 
      post: fullPost,
      mComments: dbComments // Changed from mComments to dbComments for clarity
    });
  } catch (err) {
    console.error('❌ Data fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch post data' });
  }
});

app.post('/api/retry/:commentId', async (req, res) => {
  try {
    const comment = await Comment.findOne({ commentID: req.params.commentId });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const setting = await PostSetting.findOne({ postId: comment.postId });
    if (!setting) {
      return res.status(400).json({ error: 'No settings for this post' });
    }

    await sendMessageWithButtons(
      comment.commentID,
      setting.message,
      setting.buttonLinks
    );

    await Comment.updateOne(
      { _id: comment._id },
      { msgSentStatus: 's' }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Retry failed:', err);
    res.status(500).json({ error: 'Failed to retry message' });
  }
});



const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Function to send message to Telegram
async function sendTelegramNotification(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
    });
  } catch (error) {
    console.error('Error sending message to Telegram:', error);
  }
}

// Ping route for monitoring
app.get('/ping', async (req, res) => {
  const message = `Ping received at ${new Date().toISOString()}`;
  console.log(message);
  res.status(200).json({
    status: 'alive',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const keepAlive = () => {
  setInterval(async () => {
    try {
      await axios.get(`https://instabot.brainyvoyage.com/ping`);
      let msgStatus = `Ping received at ${new Date().toISOString()} From code`;
      await sendTelegramNotification(msgStatus);
      console.log('🔄 Keepalive ping sent');
    } catch (err) {
      const errorMsg = `❌ Keepalive failed: ${err.message}`;
      console.error(errorMsg);
      await sendTelegramNotification(errorMsg);
    }
  }, 4.5 * 60 * 1000); // 4.5 minutes (under Render's 15m threshold)
};

// Server management
function startScheduledJobs() {
  // Initial run
  fetchComments()
    .then(dispatchMessages)
    .catch(console.error);

  // Scheduled runs
  setInterval(() => {
    fetchComments()
      .then(dispatchMessages)
      .catch(console.error);
  }, 5 * 60 * 1000); // Every 5 minutes
}

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  keepAlive(); // Start keepalive pings
  startScheduledJobs(); // Start business logic jobs
});
