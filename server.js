const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const IG_USER_ID = process.env.INSTAGRAM_BUSINESS_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let KEYWORD = process.env.KEYWORD?.toLowerCase() || 'job';

app.use(express.static('public'));
app.use(express.json());



mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection failed:', err));

  const postSchema = new mongoose.Schema({
    pageId: String,
    caption: String,
    timestamp: String,
    permalink: String,
    keyword: String,
    customMessage: String,  // Add this line
    dmStatus: [{
      userId: String,
      username: String,
      status: String, // 'pending', 'sent', 'failed'
      lastAttempt: Date
    }]
  });
  
  const Post = mongoose.model('Post', postSchema);
  
  app.post('/api/update-keyword-for-post', async (req, res) => {
    const { postId, keyword } = req.body;
  
    if (!postId || !keyword) {
      return res.status(400).json({ success: false, message: 'Post ID and keyword are required' });
    }
  
    try {
      const updated = await Post.findOneAndUpdate(
        { pageId: postId },
        { keyword },
        { new: true, upsert: true } // Creates if doesn't exist
      );
  
      res.json({ success: true, post: updated });
    } catch (err) {
      console.error('Error updating keyword:', err);
      res.status(500).json({ success: false, message: 'Failed to update keyword' });
    }
  });
  



// Update your /api/posts endpoint
app.get('/api/posts', async (req, res) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v22.0/${IG_USER_ID}/media`, {
      params: {
        fields: 'id,caption,media_type,timestamp,permalink',
        access_token: ACCESS_TOKEN,
      },
    });

    // Get all posts from DB to check for custom keywords
    const dbPosts = await Post.find({});
    const dbPostsMap = new Map(dbPosts.map(post => [post.pageId, post]));

    const posts = response.data.data.map(post => {
      const dbPost = dbPostsMap.get(post.id);
      return {
        id: post.id,
        caption: post.caption || 'No caption',
        timestamp: new Date(post.timestamp).toLocaleString(),
        link: post.permalink,
        keyword: dbPost?.keyword || KEYWORD // Use stored keyword if available
      };
    });

    res.json(posts);
  } catch (error) {
    console.error('Failed to fetch posts:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Update your /api/posts/:id endpoint
app.get('/api/posts/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    
    // Check MongoDB first for stored keyword
    const dbPost = await Post.findOne({ pageId: postId });
    const keywordToUse = dbPost?.keyword || KEYWORD;

    // Get post details from Instagram
    const postResponse = await axios.get(`https://graph.facebook.com/v22.0/${postId}`, {
      params: {
        fields: 'id,caption,media_type,timestamp,permalink',
        access_token: ACCESS_TOKEN,
      },
    });

    const post = postResponse.data;
    const comments = await fetchCommentsForPost(postId, keywordToUse);
    
    res.json({
      id: post.id,
      caption: post.caption || 'No caption',
      timestamp: new Date(post.timestamp).toLocaleString(),
      link: post.permalink,
      keyword: keywordToUse, // Use the correct keyword (stored or global)
      customMessage: dbPost?.customMessage || '',
      comments: comments,
      dmStatus: dbPost?.dmStatus || []
    });
  } catch (error) {
    console.error('Failed to fetch post details:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch post details' });
  }
});

// Update fetchCommentsForPost to accept keyword parameter
async function fetchCommentsForPost(postId, keyword = KEYWORD) {
  try {
    const response = await axios.get(`https://graph.facebook.com/v22.0/${postId}/comments`, {
      params: {
        fields: 'id,text,username,timestamp',
        access_token: ACCESS_TOKEN,
      },
    });

    return response.data.data
      .filter(comment => comment.text?.toLowerCase().includes(keyword.toLowerCase()))
      .map(comment => ({
        id: comment.id,
        username: comment.username,
        text: comment.text,
        timestamp: new Date(comment.timestamp).toLocaleString()
      }));
  } catch (error) {
    console.error(`Failed to fetch comments for post ${postId}:`, error.response?.data || error.message);
    return [];
  }
}

app.post('/api/save-post', async (req, res) => {
  try {
    const postData = req.body;
    if (!postData || !postData.pageId) {
      return res.status(400).json({ success: false, message: 'Invalid post data' });
    }
    
    const result = await Post.findOneAndUpdate(
      { pageId: postData.pageId },
      postData,
      { upsert: true, new: true }
    );
    
    res.json({ success: true, message: 'Post saved to MongoDB', data: result });
  } catch (err) {
    console.error('Error saving post:', err);
    res.status(500).json({ success: false, message: 'Failed to save post' });
  }
});

// Update keyword
app.post('/api/update-keyword', (req, res) => {
  const newKeyword = req.body.keyword?.toLowerCase();
  if (newKeyword) {
    KEYWORD = newKeyword;
    res.json({ success: true, message: 'Keyword updated successfully' });
  } else {
    res.status(400).json({ success: false, message: 'Invalid keyword' });
  }
});











// dm sending logic
// Update message
async function sendActualDM(userId, message) {
  try {
    console.log(`Attempting to send DM to user ${userId}`);
    console.log(`Message content: ${message.substring(0, 50)}...`); // Log first 50 chars
    
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${userId}/messages`,
      {
        recipient: { id: userId },
        message: { text: message }
      },
      {
        params: {
          access_token: ACCESS_TOKEN
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('DM sent successfully:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Failed to send DM:');
    console.error('URL:', error.config.url);
    console.error('Error Data:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
    return { 
      success: false, 
      error: error.response?.data || error.message 
    };
  }
}



app.post('/api/update-message', async (req, res) => {
  const { postId, message } = req.body;
  await Post.findOneAndUpdate(
    { pageId: postId },
    { customMessage: message },
    { upsert: true }
  );
  res.json({ success: true });
});

// Send DM endpoint
app.post('/api/send-dm', async (req, res) => {
  const { postId, userId, username, message } = req.body;
  
  try {
    // Try sending DM (implement your actual DM logic here)
    const dmResult = await sendActualDM(userId, message);
    
    // Update status
    await Post.findOneAndUpdate(
      { pageId: postId, 'dmStatus.userId': userId },
      { 
        $set: { 
          'dmStatus.$.status': 'sent',
          'dmStatus.$.lastAttempt': new Date() 
        }
      },
      { upsert: true, new: true }
    );
    
    res.json({ success: true });
  } catch (error) {
    // Mark as failed
    await Post.findOneAndUpdate(
      { pageId: postId },
      { 
        $push: { 
          dmStatus: {
            userId,
            username,
            status: 'failed',
            lastAttempt: new Date()
          }
        }
      },
      { upsert: true }
    );
    res.json({ success: false });
  }
});

// Background worker for auto DMs
// Background worker for auto DMs
setInterval(async () => {
  console.log('\n--- Running auto DM check ---', new Date().toISOString());
  
  try {
    const posts = await Post.find({});
    console.log(`Found ${posts.length} posts to process`);
    
    for (const post of posts) {
      try {
        console.log(`\nProcessing post ${post.pageId}`);
        
        if (!post.customMessage) {
          console.log('Skipping - no custom message set');
          continue;
        }

        const comments = await fetchCommentsForPost(post.pageId, post.keyword);
        console.log(`Found ${comments.length} matching comments`);

        for (const comment of comments) {
          const existingStatus = post.dmStatus?.find(s => s.userId === comment.id);
          
          if (existingStatus?.status === 'sent') {
            console.log(`Already sent to ${comment.username} - skipping`);
            continue;
          }

          console.log(`Preparing to DM ${comment.username} (${comment.id})`);
          
          // Update status to pending first
          await Post.findOneAndUpdate(
            { pageId: post.pageId },
            { 
              $push: { 
                dmStatus: {
                  userId: comment.id,
                  username: comment.username,
                  status: 'pending',
                  lastAttempt: new Date()
                }
              }
            },
            { upsert: true }
          );

          // Send the DM
          const result = await sendActualDM(comment.id, post.customMessage);
          
          // Update status based on result
          await Post.findOneAndUpdate(
            { pageId: post.pageId, 'dmStatus.userId': comment.id },
            { 
              $set: { 
                'dmStatus.$.status': result.success ? 'sent' : 'failed',
                'dmStatus.$.lastAttempt': new Date() 
              }
            }
          );

          console.log(`DM status for ${comment.username}: ${result.success ? '✅ Sent' : '❌ Failed'}`);
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (postError) {
        console.error(`Error processing post ${post.pageId}:`, postError);
      }
    }
  } catch (error) {
    console.error('Background worker error:', error);
  }
  
  console.log('--- Auto DM check completed ---\n');
}, 300000); // 5 minutes

// Add this right after your MongoDB connection
async function verifyInstagramPermissions() {
  try {
    console.log('\nVerifying Instagram permissions...');
    
    // 1. First verify the Instagram Business account exists
    const accountInfo = await axios.get(`https://graph.facebook.com/v22.0/${IG_USER_ID}`, {
      params: {
        fields: 'name,instagram_business_account',
        access_token: ACCESS_TOKEN
      }
    });

    const igBusinessId = accountInfo.data.instagram_business_account?.id;
    
    if (!igBusinessId) {
      throw new Error('No Instagram Business account connected to this Facebook Page');
    }

    console.log('✅ Instagram Business Account Verified');
    console.log(`Account ID: ${igBusinessId}`);
    console.log(`Account Name: ${accountInfo.data.name}`);

    // 2. Check available permissions
    const tokenInfo = await axios.get(`https://graph.facebook.com/v22.0/me/permissions`, {
      params: {
        access_token: ACCESS_TOKEN
      }
    });

    const requiredPermissions = [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_show_list',
      'pages_read_engagement'
    ];

    console.log('\nChecking permissions:');
    const missingPermissions = requiredPermissions.filter(perm => 
      !tokenInfo.data.data.some(p => p.permission === perm && p.status === 'granted')
    );

    if (missingPermissions.length > 0) {
      console.error('❌ Missing required permissions:');
      missingPermissions.forEach(perm => console.error(`- ${perm}`));
      console.error('\nGo to Facebook Developer Dashboard > App > Permissions and Features');
      console.error('to add these permissions and get them approved by Facebook.');
    } else {
      console.log('✅ All required permissions granted');
    }

    // 3. Verify DM capability
    try {
      const dmTest = await axios.get(`https://graph.facebook.com/v22.0/${igBusinessId}/conversations`, {
        params: {
          fields: 'id',
          access_token: ACCESS_TOKEN,
          limit: 1
        }
      });
      console.log('\n✅ Direct Message capability verified');
    } catch (dmError) {
      console.error('\n❌ Direct Message capability failed:');
      console.error(dmError.response?.data || dmError.message);
      console.error('\nMake sure:');
      console.error('1. Your Instagram account is a Professional Account');
      console.error('2. You have "instagram_manage_messages" permission');
      console.error('3. Your app has gone through Facebook\'s review process');
    }

  } catch (error) {
    console.error('\n❌ Instagram verification failed:');
    console.error(error.response?.data || error.message);
    console.error('\nRequired setup:');
    console.error('1. Convert Instagram to Professional Account');
    console.error('2. Connect Instagram to a Facebook Page');
    console.error('3. Ensure proper permissions in Facebook Developer Dashboard');
  }
}

// Call this after MongoDB connects
mongoose.connection.once('open', () => {
  verifyInstagramPermissions();
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
