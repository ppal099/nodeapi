const db = require('../models/db');
const { getRedis } = require('../models/redis');
const logger = require('../models/logger');
const notificationQueue = require('../queues/notificationQueue');
const Delivery = require('../models/delivery');
const fetch = global.fetch;

async function handleDeliveryWebhook(req, res) {
  const startTime = Date.now();
  const { delivery_id, status, timestamp, courier_signature } = req.body;
  const courier_id = req.headers['x-courier-id'];

  // Log receipt of the webhook request before validation so invalid payloads are traceable.
  logger.info('Webhook request received', { delivery_id, status, courier_id, outcome: 'received' });

  // Input validation
  if (!delivery_id || typeof delivery_id !== 'string') {
    const elapsed = Date.now() - startTime;
    logger.info('Invalid input: delivery_id', { delivery_id, courier_id, processing_time_ms: elapsed, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid delivery_id' });
  }

  const validStatuses = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed'];
  if (!validStatuses.includes(status)) {
    const elapsed = Date.now() - startTime;
    logger.info('Invalid input: status', { delivery_id, status, courier_id, processing_time_ms: elapsed, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(timestamp)) {
    const elapsed = Date.now() - startTime;
    logger.info('Invalid input: timestamp', { delivery_id, courier_id, processing_time_ms: elapsed, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid timestamp' });
  }

  // Immediate acknowledgement prevents the courier from retrying due to downstream latency.
  res.status(200).json({ received: true });

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated = false;
    try {
      updated = await Delivery.checkAndUpdateStatus(connection, delivery_id, status, timestamp, req.body.client_id);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    if (!updated) {
      logger.info('Duplicate status update', { delivery_id, status, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'duplicate' });
      return;
    }

    const redis = await getRedis();
    const message = JSON.stringify({ delivery_id, status, timestamp });
    await redis.publish('delivery_updates', message);

    const clientInfo = await Delivery.findClientWebhook(delivery_id);
    if (clientInfo) {
      notificationQueue.add({
        delivery_id,
        status,
        client_id: clientInfo.client_id,
        webhook_url: clientInfo.webhook_url
      });
    }

    if (status === 'failed') {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Delivery ${delivery_id} failed` })
      }).catch(err => logger.error('Slack alert failed', { delivery_id, error: err.message, outcome: 'warning' }));
    }

    logger.info('Webhook processed', { delivery_id, status, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'success' });
  } catch (error) {
    logger.error('Webhook processing error', { delivery_id, status, courier_id, error: error.message, processing_time_ms: Date.now() - startTime, outcome: 'error' });
  }
}

module.exports = { handleDeliveryWebhook };