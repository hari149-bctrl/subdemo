const axios = require('axios');
const logger = require('../config/logger');

async function sendDM(userId, messageContent) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.INSTAGRAM_BUSINESS_ID}/messages`,
      {
        recipient: { id: userId },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE',
        message: { text: generateMessage(messageContent) },
        timestamp: Math.floor(Date.now() / 1000)
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    return true;
  } catch (error) {
    logger.error('DM failed', {
      userId,
      error: error.response?.data?.error || error.message
    });
    return false;
  }
}

function generateMessage(text) {
  return `Thanks for your interest! Here's our careers page: ${process.env.CAREERS_LINK}\n\n` +
    `Reply STOP to opt out.\n` +
    `Original comment: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`;
}

module.exports = { sendDM };