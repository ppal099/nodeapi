require('dotenv').config();
const express = require('express');
const db = require('./models/db');
const { getRedis } = require('./models/redis');
const logger = require('./models/logger');
const { handleDeliveryWebhook } = require('./controllers/webhookController');
const verifySignature = require('./middleware/verifySignature');
const rateLimit = require('./middleware/rateLimit');

const app = express();
app.use(express.json());

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    // Check DB
    await db.execute('SELECT 1');
    // Check Redis
    const redisClient = await getRedis();
    await redisClient.ping();
    res.json({ status: 'healthy', db: 'connected', redis: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Webhook endpoint
app.post('/webhook/delivery', rateLimit, verifySignature, handleDeliveryWebhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});