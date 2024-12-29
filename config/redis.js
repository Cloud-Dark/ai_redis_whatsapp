const { createClient } = require('redis');
require('dotenv').config();

const redis = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
    },
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
});

redis.on('connect', () => {
    console.log('Connected to Redis successfully.');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

(async () => {
    try {
        await redis.connect();
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
    }
})();

module.exports = redis;
