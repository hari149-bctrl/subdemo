const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  commentId: { type: String, required: true, unique: true },
  postId: String,
  attempts: { type: Number, default: 0, min: 0, max: 3 },
  status: { 
    type: String, 
    enum: ['pending', 'success', 'failed'], 
    default: 'pending' 
  },
  lastAttempt: Date,
  messageContent: String
}, { timestamps: true });

// Auto-delete records after 30 days
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('MessageAttempt', messageSchema);