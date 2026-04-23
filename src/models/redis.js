const redis = require('redis');

let clientPromise;

const getRedis = () => {
  if (!clientPromise) {
    const client = redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });
    clientPromise = client.connect().then(() => client).catch(err => {
      console.error('Redis connection failed:', err);
      throw err;
    });
  }
  return clientPromise;
};

module.exports = { getRedis };