require('dotenv').config();
const MongoStore = require('connect-mongo');
const jwt = require('jsonwebtoken');
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');

const app = express();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT;
const FB_APP_ID = process.env.APP_ID;
const FB_APP_SECRET = process.env.APP_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;


// Middleware

app.use(express.json());
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60 // 1 day
  }),
  cookie: {
    maxAge: 60 * 60 * 1000, // 1 hour
    secure: process.env.NODE_ENV === 'production', // only true in production
    sameSite: 'lax', // default behavior, works for same-origin
    httpOnly: true
  }
}));




//-------------------------------------------------- MongoDB connection
mongoose.connect(MONGODB_URI, {
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
  title: { type: String, default: '' },
  link: { type: String, default: '' },
  userId: { type: String, required: true } // Track which user created this
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
    enum: ['p', 's', 'f', 'i', 'e'],
    default: 'p'
  },
  retryCount: { type: Number, default: 0 },
  userId: { type: String, required: true } // Track which user this belongs to
});

const UserSchema = new mongoose.Schema({
  facebookId: { type: String, required: true, unique: true, index:true },
  name: { type: String, required: true },
  picture: {type:String, required: true},
  email: { type: String },
  accessToken: { type: String, required: true },
  longLivedToken: { type: String },
  pageTokens: [{
    pageId: String,
    token: String,
    name: String,
  }],
  instagramAccount: [{
    id: String,
    username: String,
    pageId: String,
  }]
});

const PostSetting = mongoose.model('PostSetting', PostSettingSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const User = mongoose.model('User', UserSchema);
//-------------------------------------------------- MongoDB connection shit ended here











// Data cache
let cachedAllData = [];







// Authentication Middleware
async function ensureAuthenticated(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}








//------------------------------------- For login ----------------------------//
// User Schema
const dashboarduserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
dashboarduserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method to compare passwords
dashboarduserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const dashboardUsers = mongoose.model('dashboardUsers', dashboarduserSchema);

// Signup route
app.post('/dashboard-signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await dashboardUsers.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const user = new dashboardUsers({ name, email, password });
    await user.save();

    req.session.userId = user._id;

    res.status(201).json({
      message: 'User created successfully',
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});



app.post('/dashboard-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await dashboardUsers.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create new session
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({ error: 'Session error' });
      }

      req.session.userId = user._id;
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Session error' });
        }

        res.json({ 
          message: 'Login successful',
          user: {
            id: user._id,
            name: user.name,
            email: user.email
          }
        });
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Logout route
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out successfully' });
    });
});


// Middleware to protect routes
function isAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/dashboard-login'); // or whatever your login page is
}


// Example protected route
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/'); // or res.json({ message: 'Welcome!' })
});
//-------------------------------- login ended for dashboard ----------------------------//







// ----------------------For ui after signing in --------------------------//
let loggedInUser; 
app.get('/user/loggedIn/:ID', async(req,res) => {
  const Id = req.params.ID;
  try{
    const response = await User.findOne({ facebookId: Id });

    let pages = [];
    let instaAcc = [];
    response.pageTokens.forEach(p => {
      pages.push({
        id: p.pageId,
        name: p.name
      });
    });
    response.instagramAccount.forEach(p => {
      instaAcc.push({
        id: p.pageId,
        name: p.username
      })
    })

    res.status(200).json({
      name: response.name,
      profile: response.picture,
      pages,
      instaAcc
    });
  }
  catch(err){
    console.log("Failed to get login details",err);
    res.status(500).json({message: "Failed geting the loggedIn user details from mongoDB"});
  }
})






















app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/auth/status', ensureAuthenticated, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      name: req.user.name,
      email: req.user.email,
      instagram: req.user.instagramAccount
    }
  });
});


// Instagram API Service
async function fetchInstagramPosts(user) {
  try {
    const accInfo = await User.findOne({"pageTokens.pageId": user},{ name: 1, "pageTokens.$": 1, instagramAccount:1 })
    const igAccount = accInfo.instagramAccount.find(acc => acc.pageId === user);
    console.log('⏳ Fetching Instagram posts...');
    const response = await axios.get(
      `https://graph.facebook.com/v22.0/${igAccount.id}/media`,
      {
        params: {
          fields: 'id,caption,permalink,timestamp,comments_count,like_count,comments{hidden,id,text,timestamp,username}',
          access_token: accInfo.pageTokens[0].token
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



async function fetchComments(user) {
  try {
    const posts = await fetchInstagramPosts(user);
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
        timestamp: comment.timestamp,
        hidden: comment.hidden,
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
    await saveCommentsToMongo(allData, user);
    return allDataMapped;
  } catch (error) {
    console.error('❌ Error in fetchComments:', error.message);
    return [];
  }
}

async function saveCommentsToMongo(allData, user) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const postIds = allData.map(post => post.postId);
  
  try {
    const settings = await PostSetting.find({ 
      postId: { $in: postIds },
      userId: user._id 
    });
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
                commentText: comment.commentText,
                userId: user._id
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

async function sendMessageWithButtons(user, commentId, message, title, link) {
  try {
    const accInfo = await User.findOne({"pageTokens.pageId": user},{"pageTokens.$": 1})
    

    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${user}/messages`,
      {
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: message,
              buttons: [
                {
                  type: "web_url",
                  url: link,
                  title: title
                },
                {
                  type: "web_url",
                  url: "https://WhatsApp.openinapp.co/Brainy_Voyage",
                  title: "Join WhatsApp"
                },
                {
                  type: "web_url",
                  url: "https://YouTube.openinapp.co/Brainy_Voyage",
                  title: "Subcribe Us"
                }
              ]
            }
          }
        }
      },
      {
        params: { access_token: accInfo.pageTokens[0].token },
        timeout: 10000
      }
    );
    return response.data;
  } catch (error) {
    console.error('❌ Message sending failed:', error.response?.data || error.message);
    throw error;
  }
}

async function dispatchMessages(user) {
  try {
    console.log('🔍 Checking for pending messages...');
    const pendingComments = await Comment.find({ 
      msgSentStatus: 'p',
      retryCount: { $lt: 3 },
      userId: user._id
    }).limit(20);

    if (pendingComments.length === 0) {
      console.log('ℹ️ No pending messages to process');
      return;
    }

    for (const comment of pendingComments) {
      try {
        const setting = await PostSetting.findOne({ 
          postId: comment.postId,
          userId: user._id 
        });
        
        if (!setting || !setting.keyword) {
          await Comment.updateOne(
            { _id: comment._id },
            { msgSentStatus: 'i' }
          );
          continue;
        }

        if (comment.commentText.toLowerCase().includes(setting.keyword.toLowerCase())) {
          await sendMessageWithButtons(
            user,
            comment.commentID,
            setting.message,
            setting.title,
            setting.link
          );

          await Comment.updateOne(
            { _id: comment._id },
            { 
              msgSentStatus: 's'
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

// Webhooks
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook Data:', JSON.stringify(req.body, null, 2));
    
    // if (req.body.object === 'instagram' && req.body.entry) {
    //   for (const entry of req.body.entry) {
    //     if (entry.changes && entry.changes[0].field === 'comments') {
    //       const postId = entry.changes[0].value.media_id;
    //       const commentId = entry.changes[0].value.id;
          
    //       // Find which user this belongs to by finding the post setting
    //       const setting = await PostSetting.findOne({ postId });
    //       if (!setting) continue;
          
    //       const user = await User.findById(setting.userId);
    //       if (!user) continue;
          
    //       const comment = await fetchCommentDetails(user, commentId);
    //       await saveAndProcessComment(user, postId, comment);
    //     }
    //   }
    // }
    
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500);
  }
});

async function fetchCommentDetails(user, commentId) {
  const pageToken = user.pageTokens.find(p => p.pageId === FACEBOOK_PAGE_ID)?.token;
  if (!pageToken) throw new Error('Page token not found');

  const response = await axios.get(
    `https://graph.facebook.com/v22.0/${commentId}`,
    {
      params: {
        fields: 'id,text,timestamp,username,hidden',
        access_token: pageToken
      }
    }
  );
  return response.data;
}

async function saveAndProcessComment(user, postId, commentData) {
  const comment = new Comment({
    postId,
    username: commentData.username,
    commentID: commentData.id,
    commentTime: new Date(commentData.timestamp),
    commentText: commentData.text,
    msgSentStatus: 'p',
    userId: user._id
  });
  
  await comment.save();
  await processSingleComment(user, comment);
}

async function processSingleComment(user, comment) {
  try {
    const setting = await PostSetting.findOne({ 
      postId: comment.postId,
      userId: user._id 
    });
    
    if (!setting || !setting.keyword) {
      await Comment.updateOne(
        { _id: comment._id },
        { msgSentStatus: 'i' }
      );
      return;
    }

    if (comment.commentText.toLowerCase().includes(setting.keyword.toLowerCase())) {
      await sendMessageWithButtons(
        user,
        comment.commentID,
        setting.message,
        setting.title,
        setting.link
      );

      await Comment.updateOne(
        { _id: comment._id },
        { 
          msgSentStatus: 's',
          processedAt: new Date()
        }
      );
      console.log(`✅ Sent immediate message for comment ${comment.commentID}`);
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












//------------------------  Used for ui populating ---------------------------------//
// API Routes
app.get('/api/instagram-accounts/:ID', async (req, res) => {
  try {
    const ID = req.params.ID;
    const accInfo = await User.findOne({"pageTokens.pageId": ID},{ name: 1, "pageTokens.$": 1 })
    const response = await axios.get(
      `https://graph.facebook.com/v22.0/${ID}/instagram_accounts`,
      {
        params: {
          fields: 'username,followers_count,follows_count,media_count,name,website',
          access_token: accInfo.pageTokens[0].token,
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error('API Error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to fetch Instagram account data',
      details: err.response?.data || err.message,
    });
  }
});

app.get('/api/comments/:ID', async (req, res) => {

  try {
    const ID = req.params.ID;
    const comments = await fetchComments(ID);
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/reply/:commentID/:ID',  async (req, res) => {
  const cmId = req.params.commentID;
  const replyMsg = req.body.replyMessage;
  const ID = req.params.ID;
  try {
    const accInfo = await User.findOne({"pageTokens.pageId": ID},{ name: 1, "pageTokens.$": 1 })
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${cmId}/replies`,
      {
        message: replyMsg
      },
      {
        params: { access_token: accInfo.pageTokens[0].token }
      }
    );
    
    console.log('✅ Reply posted:', response.data);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('❌ Failed to reply:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

app.post('/api/hide/:commentID/:ID', async (req, res) => {
  const cmId = req.params.commentID;
  const hide = req.query.hide === 'true';
  const ID = req.params.ID;
  try {
    const accInfo = await User.findOne({"pageTokens.pageId": ID},{ name: 1, "pageTokens.$": 1 })
    const url = `https://graph.facebook.com/v22.0/${cmId}`;
    const response = await axios.post(url, null, {
      params: {
        hide,
        access_token: accInfo.pageTokens[0].token
      }
    });
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

app.delete('/api/delete/:commentID/:ID',  async (req, res) => {
  const commentID = req.params.commentID;
  const ID = req.params.ID;
  try {
    const accInfo = await User.findOne({"pageTokens.pageId": ID},{ name: 1, "pageTokens.$": 1 })
    const url = `https://graph.facebook.com/v22.0/${commentID}?access_token=${accInfo.pageTokens[0].token}`;
    const response = await axios.delete(url);
    
    res.json({ message: 'Comment deleted successfully', data: response.data });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { postId, customCaption, keyword, message, title, link } = req.body;
    const updated = await PostSetting.findOneAndUpdate(
      { postId,  },
      { 
        postId, 
        customCaption, 
        keyword, 
        message, 
        title, 
        link,
      },
      { upsert: true, new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error('❌ Settings save error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});


app.get('/api/settings/:postId/:ID', async (req, res) => {
  try {
    const [setting, dbComments] = await Promise.all([
      PostSetting.findOne({ 
        postId: req.params.postId,
        // userId: req.user._id 
      }),
      Comment.find({ 
        postId: req.params.postId,
        // userId: req.user._id 
      })
    ]);

    let fullPost = cachedAllData.find(p => p.postId === req.params.postId);
    
    if (!fullPost) {
      const posts = await fetchInstagramPosts(req.params.ID);
      fullPost = posts.find(p => p.id === req.params.postId);
    }

    if (!fullPost) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ 
      settings: setting || {}, 
      post: fullPost,
      mComments: dbComments
    });
  } catch (err) {
    console.error('❌ Data fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch post data' });
  }
});









// Add this near your other route declarations
app.post('/auth/facebook/callback', async (req, res) => {
  try {
    const { token } = req.body;
    
    // Verify the token with Facebook
    const debugToken = await axios.get(`https://graph.facebook.com/debug_token`, {
      params: {
        input_token: token,
        access_token: `${FB_APP_ID}|${FB_APP_SECRET}`
      }
    });

    if (!debugToken.data.data.is_valid) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Get user profile
    const profile = await axios.get(`https://graph.facebook.com/v22.0/me`, {
      params: {
        fields: 'id,name,picture{url}',
        access_token: token
      }
    });

    // Get long-lived token
    const longLivedToken = await axios.get(`https://graph.facebook.com/v22.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: token
      }
    });


    const pages = await axios.get(`https://graph.facebook.com/v22.0/me/accounts`, {
      params: {
        access_token: longLivedToken.data.access_token
      }
    });

    // Step 2: Build an array of pages with access tokens
    const pageTokens = pages.data.data.map(page => ({
      pageId: page.id,
      token: page.access_token,
      name: page.name
    }));

    // Step 3: Loop over pages to fetch connected Instagram business accounts
    const instagram = [];

    for (const page of pageTokens) {
      try {
        const ig = await axios.get(`https://graph.facebook.com/v22.0/${page.pageId}`, {
          params: {
            fields: 'instagram_business_account{name,username,id}',  // <-- key fix
            access_token: page.token
          }
        });
        if (ig.data.instagram_business_account) {
          instagram.push({
            pageId: page.pageId,
            pageName: page.name,
            token: page.token,
            instagram: ig.data.instagram_business_account
          });
        }
      } catch (error) {
        console.error(`❌ Failed to fetch Instagram account for page ${page.name}:`, error.response?.data || error.message);
      }
    }
    // Create or update user in database

    const formattedIGAccounts = instagram.map(acc => ({
      id: acc.instagram?.id,
      username: acc.instagram?.username,
      pageId: acc.pageId
    }));
    const user = await User.findOneAndUpdate(
      { facebookId: profile.data.id },
      {
        name: profile.data.name,
        picture: profile.data.picture.data.url,
        email: profile.data.email,
        accessToken: token,
        longLivedToken: longLivedToken.data.access_token,
        pageTokens: pageTokens,
        instagramAccount: formattedIGAccounts
      },
      { upsert: true, new: true }
    );

    // Create session
    // req.session.userId = user._id;
    
    res.json({ 
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

    
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});




app.post('/api/retry/:commentId/:ID',  async (req, res) => {
  try {
    const comment = await Comment.findOne({ 
      commentID: req.params.commentId,
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const setting = await PostSetting.findOne({ 
      postId: comment.postId,
    });
    
    if (!setting) {
      return res.status(400).json({ error: 'No settings for this post' });
    }
    let ID = req.params.ID
    await sendMessageWithButtons(
      ID,
      comment.commentID,
      setting.message,
      setting.title,
      setting.link
    );

    await Comment.updateOne(
      { _id: comment._id },
      { msgSentStatus: 's' }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Retry failed:', err);
    res.status(500).json({ error: err.message });
  }
});


// Telegram Notification
async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || !CHAT_ID) return;
  
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

// Health Check
app.get('/ping', async (req, res) => {
  res.status(200).json({
    status: 'alive',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use(express.static('public'));

const keepAlive = () => {
  setInterval(async () => {
    try {
      await axios.get(`https://${process.env.DOMAIN || 'localhost:3000'}/ping`);
      let msgStatus = `Ping received at ${new Date().toISOString()} From instabot`;
      await sendTelegramNotification(msgStatus);
      console.log('🔄 Keepalive ping sent');
    } catch (err) {
      const errorMsg = `❌ Keepalive failed: ${err.message}`;
      console.error(errorMsg);
      await sendTelegramNotification(errorMsg);
    }
  }, 4.5 * 60 * 1000); // 4.5 minutes
};

// Server management
function startScheduledJobs() {
  // Run for all active users
  const runForAllUsers = async () => {
    try {
      const users = await User.find();
      for (const user of users) {
        // await fetchComments(user);
        await dispatchMessages(user);
      }
    } catch (err) {
      console.error('Scheduled job error:', err);
    }
  };

  // Initial run
  runForAllUsers().catch(console.error);

  // Scheduled runs
  setInterval(() => {
    runForAllUsers().catch(console.error);
  }, 5 * 60 * 1000); // Every 5 minutes
}

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  keepAlive();
});