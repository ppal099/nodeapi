const { handleDeliveryWebhook } = require('../src/controllers/webhookController');
const db = require('../src/models/db');
const redis = require('../src/models/redis');

// Mock dependencies
jest.mock('../src/models/db');
jest.mock('../src/models/redis');
jest.mock('../src/models/logger');
jest.mock('../src/queues/notificationQueue');

describe('Idempotency Test', () => {
  it('should not update if status is the same', async () => {
    const req = {
      body: {
        delivery_id: '123',
        status: 'delivered',
        timestamp: '2023-01-01T00:00:00Z',
        client_id: 1,
        courier_signature: 'valid' // Assume verified
      },
      headers: { 'x-courier-id': 'courier1' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const mockConnection = {
      execute: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn()
    };

    // Mock getConnection
    db.getConnection.mockResolvedValue(mockConnection);

    // Mock execute to return existing with same status
    mockConnection.execute.mockResolvedValueOnce([[{ status: 'delivered' }]]);

    await handleDeliveryWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockConnection.execute).toHaveBeenCalledTimes(1); // Only the select
    expect(mockConnection.commit).toHaveBeenCalled();
    // No update
  });
});