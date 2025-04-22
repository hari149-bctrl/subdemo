const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const IG_USER_ID = process.env.INSTAGRAM_BUSINESS_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL || 5 * 60 * 1000; // 5 minutes
const APP_SECRET = process.env.APP_SECRET;
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID

app.use(express.static('public'));
app.use(express.json());

// Verify webhook signature
function verifySignature(req, res, buf) {
  const signature = req.headers['x-hub-signature'];
  if (!signature) {
    throw new Error('Signature verification failed');
  } else {
    const elements = signature.split('=');
    const signatureHash = elements[1];
    const expectedHash = crypto
      .createHmac('sha1', APP_SECRET)
      .update(buf)
      .digest('hex');
    
    if (signatureHash !== expectedHash) {
      throw new Error('Signature verification failed');
    }
  }
}

app.use(express.json({ verify: verifySignature }));

// MongoDB Schema
const postSchema = new mongoose.Schema({
  postId: { type: String, required: true, unique: true },
  caption: String,
  timestamp: { type: Date, default: Date.now },
  keyword: { type: String, default: 'none' },
  messageTemplate: { type: String, default: 'none' },
  comments: [{
    commentId: String,
    username: String,
    userId: String,
    text: String,
    timestamp: { type: Date, default: Date.now },
    dmStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    dmTimestamp: Date
  }],
  lastChecked: Date
});

const Post = mongoose.model('Post', postSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Fetch posts and comments
async function fetchPostsAndComments() {
  try {
    console.log('⏳ Fetching posts and comments...');
    const response = await axios.get(`https://graph.facebook.com/v22.0/${IG_USER_ID}/media`, {
      params: {
        fields: 'id,caption,timestamp,comments{id,text,from,timestamp}',
        access_token: ACCESS_TOKEN,
      },
    });

    const posts = response.data.data;
    console.log(`📊 Found ${posts.length} posts`);

    for (const post of posts) {
      const existingPost = await Post.findOne({ postId: post.id });
      const keyword = existingPost?.keyword || 'none';
      const messageTemplate = existingPost?.messageTemplate || 'none';

      const comments = post.comments?.data || [];
      let newCommentsCount = 0;

      for (const comment of comments) {
        // Check if comment already exists
        const commentExists = existingPost?.comments?.some(c => c.commentId === comment.id);
        if (!commentExists) {
          newCommentsCount++;
          const dmStatus = (keyword !== 'none' && comment.text.toLowerCase().includes(keyword.toLowerCase())) 
            ? 'pending' 
            : 'ignored';

          await Post.updateOne(
            { postId: post.id },
            {
              $setOnInsert: {
                postId: post.id,
                caption: post.caption,
                timestamp: post.timestamp,
                keyword,
                messageTemplate,
                lastChecked: new Date()
              },
              $push: {
                comments: {
                  commentId: comment.id,
                  username: comment.from.username,
                  userId: comment.from.id,
                  text: comment.text,
                  timestamp: comment.timestamp,
                  dmStatus
                }
              }
            },
            { upsert: true }
          );

          // Send DM if keyword matches
          if (dmStatus === 'pending') {
            await sendDirectMessage(
              comment.id,
              comment.from.username,
              post.id,
              messageTemplate,
              keyword
            );
          }
        }
      }

      if (newCommentsCount > 0) {
        console.log(`📨 Added ${newCommentsCount} new comments to post ${post.id}`);
      }
    }

    console.log('✅ Data processing complete');
  } catch (error) {
    console.error('❌ Error fetching posts:', error.response?.data || error.message);
  }
}

// Send direct message
async function sendDirectMessage(commentId, username, postId, template, keyword) {
  try {
    const message = template
      .replace('{username}', username)
      .replace('{keyword}', keyword);

    console.log(`✉️ Attempting to send DM to @${username}...`);

    // Update status to pending
    await Post.updateOne(
      { postId, 'comments.commentId': commentId },
      { $set: { 
        'comments.$.dmStatus': 'pending',
        'comments.$.dmTimestamp': new Date()
      }}
    );

    // Send message directly to comment
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${FACEBOOK_PAGE_ID}/messages`,
      {
        recipient: {
          comment_id: commentId
        },
        message: {
          text: message
        },
        access_token: ACCESS_TOKEN
      }
    );

    // Update status to sent
    await Post.updateOne(
      { postId, 'comments.commentId': commentId },
      { $set: { 'comments.$.dmStatus': 'sent' }}
    );

    console.log(`✅ DM sent to @${username} (Comment ID: ${commentId})`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send DM to @${username}:`, error.response?.data || error.message);
    await Post.updateOne(
      { postId, 'comments.commentId': commentId },
      { $set: { 'comments.$.dmStatus': 'failed' }}
    );
    throw error;
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook for receiving comments
app.post('/webhook', async (req, res) => {
  try {
    const { object_id: postId, text, from, id: commentId } = req.body.entry[0].changes[0].value;
    
    console.log(`🔄 New comment received on post ${postId} from @${from.username}`);

    // Check if comment already exists
    const existingComment = await Post.findOne({
      postId,
      'comments.commentId': commentId
    });
    
    if (!existingComment) {
      const post = await Post.findOne({ postId });
      if (post) {
        const dmStatus = (post.keyword !== 'none' && text.toLowerCase().includes(post.keyword.toLowerCase())) 
          ? 'pending' 
          : 'ignored';

        await Post.updateOne(
          { postId },
          {
            $push: {
              comments: {
                commentId,
                username: from.username,
                userId: from.id,
                text,
                timestamp: new Date(),
                dmStatus
              }
            }
          }
        );

        // Send DM if keyword matches
        if (dmStatus === 'pending') {
          await sendDirectMessage(
            commentId,
            from.username,
            postId,
            post.messageTemplate,
            post.keyword
          );
        }

        console.log(`➕ Added new comment from @${from.username} to database`);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
});

// API Endpoints
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ timestamp: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await Post.findOne({ postId: req.params.id });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    res.json({
      ...post.toObject(),
      currentSettings: {
        keyword: post.keyword,
        messageTemplate: post.messageTemplate
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

app.post('/api/update-settings', async (req, res) => {
  try {
    const { postId, keyword, messageTemplate } = req.body;
    
    await Post.updateOne(
      { postId },
      { $set: { keyword, messageTemplate } }
    );
    
    // Process existing comments with new keyword
    if (keyword && keyword !== 'none') {
      const post = await Post.findOne({ postId });
      for (const comment of post.comments) {
        if (comment.text.toLowerCase().includes(keyword.toLowerCase()) && 
            comment.dmStatus !== 'sent') {
          await sendDirectMessage(
            comment.commentId,
            comment.username,
            postId,
            messageTemplate,
            keyword
          );
        }
      }
    }
    
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/retry-dm', async (req, res) => {
  try {
    const { postId, commentId } = req.body;
    const post = await Post.findOne({ postId });
    
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const comment = post.comments.find(c => c.commentId === commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    await sendDirectMessage(
      commentId,
      comment.username,
      postId,
      post.messageTemplate,
      post.keyword
    );
    
    res.json({ success: true, message: 'DM retry initiated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retry DM' });
  }
});

app.post('/api/refresh-comments', async (req, res) => {
  try {
    const { postId } = req.body;
    
    const response = await axios.get(`https://graph.facebook.com/v22.0/${postId}`, {
      params: {
        fields: 'comments{id,text,from,timestamp}',
        access_token: ACCESS_TOKEN,
      },
    });

    const comments = response.data.comments?.data || [];
    let newCommentsCount = 0;

    for (const comment of comments) {
      const commentExists = await Post.findOne({ 
        postId,
        'comments.commentId': comment.id 
      });
      
      if (!commentExists) {
        newCommentsCount++;
        const post = await Post.findOne({ postId });
        const dmStatus = (post?.keyword !== 'none' && comment.text.toLowerCase().includes(post?.keyword.toLowerCase())) 
          ? 'pending' 
          : 'ignored';

        await Post.updateOne(
          { postId },
          {
            $push: {
              comments: {
                commentId: comment.id,
                username: comment.from.username,
                userId: comment.from.id,
                text: comment.text,
                timestamp: comment.timestamp,
                dmStatus
              }
            }
          }
        );

        if (dmStatus === 'pending') {
          await sendDirectMessage(
            comment.id,
            comment.from.username,
            postId,
            post.messageTemplate,
            post.keyword
          );
        }
      }
    }

    res.json({ 
      success: true, 
      message: `Found ${newCommentsCount} new comments`,
      newComments: newCommentsCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh comments' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: https://yourdomain.com/webhook`);
  
  // Initial fetch
  fetchPostsAndComments();
  
  // Periodic fetching
  setInterval(fetchPostsAndComments, CHECK_INTERVAL);
});
