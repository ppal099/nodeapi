const fetch = global.fetch;
const db = require('../models/db');
const logger = require('../models/logger');

class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  add(job) {
    this.queue.push(job);
    this.process();
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      await this.processJob(job);
    }

    this.processing = false;
  }

  async processJob(job) {
    const { delivery_id, status, client_id, webhook_url, retryCount = 0 } = job;

    try {
      const response = await fetch(webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_id, status })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      logger.info('Client notification sent', { delivery_id, status, client_id });
    } catch (error) {
      logger.error('Client notification failed', { delivery_id, status, client_id, error: error.message });

      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        setTimeout(() => {
          this.add({ ...job, retryCount: retryCount + 1 });
        }, delay);
      } else {
        // Write to failed_notifications
        await db.execute(
          'INSERT INTO failed_notifications (delivery_id, client_id, failure_reason) VALUES (?, ?, ?)',
          [delivery_id, client_id, error.message]
        );
      }
    }
  }
}

const queue = new NotificationQueue();

module.exports = queue;