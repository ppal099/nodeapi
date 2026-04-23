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

Note: Compute the HMAC-SHA256 signature of the JSON body with COURIER_SECRET.

## Written Answers

### Question 1: Bug Breakdown

1. **Insecure signature verification**: Plain string comparison is vulnerable to timing attacks. Fix: Use HMAC-SHA256 comparison.
2. **No input validation**: Missing checks for delivery_id, status, timestamp format. Causes invalid data processing. Fix: Validate types and formats, return 400.
3. **Blocking client notification**: `await sendClientNotification` blocks the response. Causes timeouts if client webhook is slow. Fix: Respond immediately, process notifications async.
4. **No error handling**: DB or Redis failures don't send response. Causes hanging requests. Fix: Wrap in try-catch, log errors.
5. **Incorrect client query**: `SELECT * FROM clients WHERE delivery_id = ?` assumes wrong relationship. Causes errors if no match. Fix: Query by client_id from deliveries table.
6. **No idempotency**: Updates and publishes even for same status. Causes duplicate events. Fix: Check if status unchanged, skip if same.
7. **Unused existing query**: Queries existing but doesn't use it. Wasteful. Fix: Use for idempotency check.
8. **No check for delivery existence**: Assumes delivery exists. Causes errors on new deliveries. Fix: Insert or update accordingly.
9. **sendClientNotification failure**: No handling if fetch fails. Causes unhandled rejections. Fix: Try-catch and retry logic.

### Question 2: Architecture Under Pressure

- **Rate limiting**: Redis zset tracks requests per courier. Under burst, checks count, if >100, returns 429. Pressure: Redis load, but handles by expiring keys.
- **Idempotency**: DB select checks status. Under concurrent requests, potential race if not locked, but since update is idempotent, ok. Pressure: DB load from selects.
- **Queue processing**: Notifications queued in memory, processed sequentially. Under burst, queue grows, but since async, webhook responds fast. Pressure: Memory for queue, single-threaded processing.
- **DB writes**: Updates/inserts. Pressure: Connection pool limits, but with 10 connections, handles. If burst, delays.

Design handles by async processing, rate limiting prevents overload, idempotency reduces DB writes.

### Question 3: Production Failure

1. Check logs for the delivery_id: See if processing starts, any errors.
2. Check DB: Query deliveries table for the delivery_id, see if updated_at changes.
3. Check Redis: Monitor publishes, see if events are sent.
4. Check application metrics: CPU, memory, DB connections.
5. Check network: If outbound calls failing.
6. Check code: Perhaps idempotency check failing due to race or wrong logic.

Most likely: Idempotency check failing, or DB connection issues causing selects to fail silently.

## Ambiguity Decision

For failed deliveries, alert every time the status changes to 'failed', assuming each failure event is significant. If Slack is down, log the error but don't retry, as alerts are not critical. No volume threshold, as failures are rare. Notify the general ops channel.