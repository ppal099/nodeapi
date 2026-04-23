# Delivery Webhook Service

A Node.js service for handling delivery status webhooks with idempotency, rate limiting, and async processing.

## Setup

1. Install dependencies: `npm install`
2. Set up MySQL database and run migrations: `mysql -u root -p < migrations/001_create_tables.sql`
3. Set up Redis.
4. Copy `.env.example` to `.env` and fill in values.
5. Start the server: `npm start`

## Observability

- JSON structured logs are emitted for every webhook request.
- Each webhook log includes `delivery_id`, `status`, `courier_id`, `processing_time_ms`, and `outcome`.
- The service exposes `GET /health` to verify service status, DB connectivity, and Redis connectivity.

## Triggering the Webhook Locally

Use curl:

```bash
curl -X POST http://localhost:3000/webhook/delivery \
  -H "Content-Type: application/json" \
  -H "X-Courier-ID: courier1" \
  -d '{
    "delivery_id": "123",
    "status": "delivered",
    "timestamp": "2023-01-01T00:00:00Z",
    "client_id": 1,
    "courier_signature": "computed_signature"
  }'
```

Note: Compute the HMAC-SHA256 signature of the JSON body using the COURIER_SECRET. Example in Node.js:
```javascript
const crypto = require('crypto');
const body = JSON.stringify(requestBody);
const signature = crypto.createHmac('sha256', process.env.COURIER_SECRET).update(body).digest('hex');
```

## Written Answers

### Question 1: Bug Breakdown

The original code had several issues that have been addressed:

1. **Fixed: Secure signature verification**: Now uses `crypto.timingSafeEqual()` for HMAC-SHA256 comparison to prevent timing attacks.
2. **Fixed: Comprehensive input validation**: Validates delivery_id as string, status as enum, timestamp as ISO 8601 format, returns 400 for invalid input.
3. **Fixed: Non-blocking notifications**: Response sent immediately with 200, all processing (DB writes, Redis publish, client notifications) happens asynchronously.
4. **Fixed: Error handling**: All database and Redis operations wrapped in try-catch, errors logged but don't break the response flow.
5. **Fixed: Correct client query**: Uses JOIN between deliveries and clients tables to get webhook_url by delivery_id.
6. **Fixed: Idempotency implemented**: Transactional check prevents duplicate DB writes and Redis events for same delivery_id + status.
7. **Fixed: Efficient queries**: Single transactional query handles both check and update operations.
8. **Fixed: Handles new deliveries**: INSERT ... ON DUPLICATE KEY UPDATE pattern handles both new and existing deliveries.
9. **Fixed: Notification retry logic**: Failed client notifications retried up to 3 times with exponential backoff, then logged to failed_notifications table.

### Question 2: Architecture Under Pressure

The current architecture handles high-load scenarios effectively:

- **Rate limiting**: Redis zset tracks requests per courier with automatic expiration. Under burst traffic, efficiently returns 429 for >100 req/min while maintaining low Redis load.
- **Idempotency**: Database transactions with SELECT ... FOR UPDATE prevent race conditions under concurrent requests, ensuring no duplicate processing.
- **Queue processing**: In-memory queue processes notifications sequentially but asynchronously. Under burst, queue may grow but webhook responses remain fast (<3s). For production scale, consider Redis-based queue.
- **DB writes**: Connection pool (10 connections) handles normal load. Transactions ensure atomicity. Under extreme load, consider read replicas for health checks.

The design prioritizes fast webhook acknowledgment while ensuring reliable async processing, preventing courier timeouts during peak loads.

### Question 3: Production Failure

When a webhook fails to update delivery status:

1. **Check application logs**: Search for the delivery_id to see if request was received, validated, and processed. Look for outcome: success/duplicate/invalid/error.
2. **Verify database state**: Query deliveries table for the delivery_id. Check if status and updated_at reflect the expected change.
3. **Check Redis events**: Monitor delivery_updates channel for published messages. Verify event structure and frequency.
4. **Monitor system resources**: Check CPU, memory, DB connection pool usage, Redis connectivity.
5. **Network diagnostics**: Test outbound HTTP calls to client webhooks and Slack. Check for firewall or DNS issues.
6. **Code review**: Verify idempotency logic handles concurrent requests correctly. Check transaction rollback scenarios.

Most likely causes: Database connection issues, Redis unavailability, or race conditions in high-concurrency scenarios (though mitigated by transactions).

## Ambiguity Decision

**Requirement**: Alert internal ops team on Slack whenever a delivery status changes to 'failed'.

**Decision Made**: 
- Alert on every status change to 'failed' (not just the first failure for a delivery)
- If Slack webhook fails, log the error but don't retry
- No volume threshold for alerts
- Notify the general ops channel

**Implementation**: Direct HTTP POST to Slack webhook URL when status === 'failed', wrapped in try-catch with error logging.

**Rationale**: 
- Each failure event is operationally significant and should be visible to the team
- Slack alerts are not mission-critical (unlike delivery tracking), so failed alerts don't warrant complex retry logic
- Delivery failures are relatively rare events, so volume thresholding isn't necessary
- General ops channel ensures all relevant team members see the alerts without requiring individual configurations