const MessageAttempt = require('../models/MessageAttempt');
const { sendDM } = require('./instagram');
const logger = require('../config/logger');

async function handleCommentEvent(commentData) {
  // Validate required fields
  if (!commentData.from?.id || !commentData.id || !commentData.text) {
    logger.warn('Invalid comment data received', commentData);
    return;
  }

  try {
    // Check for existing record
    const existing = await MessageAttempt.findOne({ commentId: commentData.id });
    if (existing) {
      logger.debug(`⏭️ Skipping duplicate comment ${commentData.id}`);
      return;
    }

    // Create new record
    const record = new MessageAttempt({
      userId: commentData.from.id,
      username: commentData.from.username,
      commentId: commentData.id,
      postId: commentData.media?.id,
      text: commentData.text
    });

    // Save to DB first
    await record.save();
    logger.info(`📝 Stored comment ${commentData.id} from @${commentData.from.username}`);

    // Process DM if keyword exists
    if (commentData.text.toLowerCase().includes('job')) {
      record.attempts += 1;
      record.lastAttempt = new Date();
      
      const success = await sendDM(record.userId, 
        "Thanks for your interest! Here's our careers page: [your-link]"
      );

      record.status = success ? 'success' : 'failed';
      await record.save();

      logger[success ? 'info' : 'warn'](
        `✉️ DM ${success ? 'succeeded' : 'failed'} to @${commentData.from.username}`
      );
    }
  } catch (error) {
    logger.error('💥 Comment processing failed', {
      error: error.message,
      commentId: commentData.id,
      stack: error.stack
    });
  }
}

module.exports = { handleCommentEvent };