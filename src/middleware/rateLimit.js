const { getRedis } = require('../models/redis');

async function rateLimit(req, res, next) {
  const courierId = req.headers['x-courier-id'];
  if (!courierId) {
    return res.status(400).json({ error: 'Missing X-Courier-ID header' });
  }

  const redis = await getRedis();
  const key = `rate_limit:${courierId}`;
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute ago

  // Remove old entries
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current requests
  const count = await redis.zcard(key);

  if (count >= 100) {
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const retryAfter = Math.ceil((oldest[1] - windowStart) / 1000);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  // Add current request
  await redis.zadd(key, now, now);

  // Expire the key after some time
  await redis.expire(key, 120); // 2 minutes

  next();
}

module.exports = rateLimit;