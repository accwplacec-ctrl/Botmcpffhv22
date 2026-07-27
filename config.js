// config.js
require('dotenv').config();

const config = {
    // Minecraft
    MC_HOST: process.env.MC_HOST || 'rune.pikamc.vn',
    MC_PORT: parseInt(process.env.MC_PORT) || 25565,
    MC_VERSION: process.env.MC_VERSION || '1.19.2',
    BOT_USERNAME: process.env.BOT_USERNAME || 'KhoaGarden',

    // Owner
    OWNER_NAME: process.env.OWNER_NAME || 'chủ',

    // Garden
    GARDEN_X: parseFloat(process.env.GARDEN_X) || 0,
    GARDEN_Z: parseFloat(process.env.GARDEN_Z) || 0,
    GARDEN_RADIUS: parseFloat(process.env.GARDEN_RADIUS) || 20,

    // Brain
    BRAIN_TOKEN: process.env.BRAIN_TOKEN || 'botmcp',

    // Firebase
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || '',
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',

    // General
    NODE_ENV: process.env.NODE_ENV || 'production',
};

module.exports = config;
