const db = require('./db');

class Delivery {
  static async findById(deliveryId) {
    const [rows] = await db.execute('SELECT * FROM deliveries WHERE delivery_id = ?', [deliveryId]);
    return rows[0];
  }

  static async updateStatus(deliveryId, status, timestamp) {
    await db.execute(
      'UPDATE deliveries SET status = ?, updated_at = ? WHERE delivery_id = ?',
      [status, timestamp, deliveryId]
    );
  }

  static async create(deliveryId, status, clientId, timestamp) {
    await db.execute(
      'INSERT INTO deliveries (delivery_id, status, client_id, updated_at) VALUES (?, ?, ?, ?)',
      [deliveryId, status, clientId, timestamp]
    );
  }

  static async findClientWebhook(deliveryId) {
    const [rows] = await db.execute(
      'SELECT c.id AS client_id, c.webhook_url FROM clients c JOIN deliveries d ON c.id = d.client_id WHERE d.delivery_id = ?',
      [deliveryId]
    );
    return rows[0];
  }

  static async checkAndUpdateStatus(connection, deliveryId, status, timestamp, clientId) {
    const [existing] = await connection.execute(
      'SELECT status FROM deliveries WHERE delivery_id = ? FOR UPDATE',
      [deliveryId]
    );

    if (existing.length > 0 && existing[0].status === status) {
      return false; // No update needed
    }

    if (existing.length > 0) {
      await connection.execute(
        'UPDATE deliveries SET status = ?, updated_at = ? WHERE delivery_id = ?',
        [status, timestamp, deliveryId]
      );
    } else {
      await connection.execute(
        'INSERT INTO deliveries (delivery_id, status, client_id, updated_at) VALUES (?, ?, ?, ?)',
        [deliveryId, status, clientId, timestamp]
      );
    }
    return true; // Updated
  }
}

module.exports = Delivery;