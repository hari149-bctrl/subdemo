const MessageAttempt = require('../models/MessageAttempt');
const { sendDM } = require('./instagram');
const logger = require('../config/logger');

async function handleCommentEvent(commentData) {
  if (!commentData.from?.id || !commentData.id) {
    throw new Error('Invalid comment data');
  }

  // Check for duplicates
  const existing = await MessageAttempt.findOne({ commentId: commentData.id });
  if (existing) {
    logger.debug('Skipping duplicate comment', { commentId: commentData.id });
    return;
  }

  // Create new record
  const record = new MessageAttempt({
    userId: commentData.from.id,
    username: commentData.from.username,
    commentId: commentData.id,
    postId: commentData.media?.id,
    messageContent: commentData.text
  });

  try {
    // Save to DB
    await record.save();
    logger.info('New comment stored', { commentId: record.commentId });

    // Process message
    record.attempts += 1;
    record.lastAttempt = new Date();
    record.status = await sendDM(record.userId, record.messageContent) 
      ? 'success' 
      : 'failed';
    await record.save();

  } catch (error) {
    logger.error('Processing failed', {
      commentId: commentData.id,
      error: error.message
    });
  }
}

module.exports = { handleCommentEvent };