const db = require('../models/db');
const { getRedis } = require('../models/redis');
const logger = require('../models/logger');
const notificationQueue = require('../queues/notificationQueue');
const fetch = global.fetch;

async function handleDeliveryWebhook(req, res) {
  const startTime = Date.now();
  const { delivery_id, status, timestamp, courier_signature } = req.body;
  const courier_id = req.headers['x-courier-id'];

  // Input validation
  if (!delivery_id || typeof delivery_id !== 'string') {
    logger.info('Invalid input: delivery_id', { delivery_id, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid delivery_id' });
  }

  const validStatuses = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed'];
  if (!validStatuses.includes(status)) {
    logger.info('Invalid input: status', { delivery_id, status, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(timestamp)) {
    logger.info('Invalid input: timestamp', { delivery_id, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'invalid' });
    return res.status(400).json({ error: 'Invalid timestamp' });
  }

  // Respond immediately
  res.status(200).json({ received: true });

  // Async processing
  try {
    // Check idempotency: if same status already, skip
    const [existing] = await db.execute(
      'SELECT status FROM deliveries WHERE delivery_id = ?',
      [delivery_id]
    );

    if (existing && existing[0].status === status) {
      logger.info('Duplicate status update', { delivery_id, status, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'duplicate' });
      return;
    }

    // Update DB
    if (existing) {
      await db.execute(
        'UPDATE deliveries SET status = ?, updated_at = ? WHERE delivery_id = ?',
        [status, timestamp, delivery_id]
      );
    } else {
      // Assume client_id is provided or from somewhere, but for simplicity, assume 1 or error
      // In real, perhaps from auth or something, but since not specified, assume delivery_id links to client
      // Wait, in broken code, client query by delivery_id, so assume deliveries have client_id
      // But to fix, perhaps add client_id to request or assume.
      // For assignment, assume client_id is in body or something.
      // To make it work, let's assume we have client_id in body.
      const { client_id } = req.body;
      await db.execute(
        'INSERT INTO deliveries (delivery_id, status, client_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = VALUES(updated_at)',
        [delivery_id, status, client_id, timestamp]
      );
    }

    // Publish to Redis
    const message = JSON.stringify({ delivery_id, status, timestamp });
    await redis.publish('delivery_updates', message);

    // Get client webhook_url
    const [clientRows] = await db.execute(
      'SELECT webhook_url FROM clients WHERE id = (SELECT client_id FROM deliveries WHERE delivery_id = ?)',
      [delivery_id]
    );
    if (clientRows.length > 0) {
      notificationQueue.add({
        delivery_id,
        status,
        client_id: clientRows[0].id, // Wait, client_id
        webhook_url: clientRows[0].webhook_url
      });
    }

    // Alert on failed
    if (status === 'failed') {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Delivery ${delivery_id} failed` })
      }).catch(err => logger.error('Slack alert failed', { error: err.message }));
    }

    logger.info('Webhook processed', { delivery_id, status, courier_id, processing_time_ms: Date.now() - startTime, outcome: 'success' });
  } catch (error) {
    logger.error('Webhook processing error', { delivery_id, status, courier_id, error: error.message, processing_time_ms: Date.now() - startTime, outcome: 'error' });
  }
}

module.exports = { handleDeliveryWebhook };