'use strict'

require('dotenv').config()

/**
 * config.js
 * ------------------------------------------------------------
 * Toan bo cau hinh tinh cua bot doc tu bien moi truong (.env).
 * KHONG hardcode secret o day - moi thu nhay cam deu qua process.env.
 * ------------------------------------------------------------
 */

function toInt(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function toFloat(value, fallback) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

const CONFIG = {
  // ===== Ket noi server Minecraft =====
  server: {
    host: process.env.MC_HOST || 'rune.pikamc.vn',
    port: toInt(process.env.MC_PORT, 25078),
    version: process.env.MC_VERSION || '1.20.1',
    auth: process.env.MC_AUTH || 'offline',
    username: process.env.MC_USERNAME || 'lamthanh',
  },

  // Ten nguoi choi la chu cua bot (nguoi duy nhat bot tuong tac/lang nghe)
  ownerName: process.env.OWNER_NAME || '',

  // ===== Vuon lua mi: bounding box 2 goc (x, z) + gioi han y =====
  // Dat toa do that trong .env. Vi du dat 1 goc (minX, minZ) va goc doi dien (maxX, maxZ).
  garden: {
    minX: toFloat(process.env.GARDEN_MIN_X, 0),
    maxX: toFloat(process.env.GARDEN_MAX_X, 0),
    minZ: toFloat(process.env.GARDEN_MIN_Z, 0),
    maxZ: toFloat(process.env.GARDEN_MAX_Z, 0),
    yMin: toFloat(process.env.GARDEN_Y_MIN, -64),
    yMax: toFloat(process.env.GARDEN_Y_MAX, 320),
  },

  // Diem tha qua tang (toa do tuyet doi trong vuon, gan hang rao/cong)
  giftDropPoint: {
    x: toFloat(process.env.GIFT_DROP_X, 0),
    y: toFloat(process.env.GIFT_DROP_Y, 0),
    z: toFloat(process.env.GIFT_DROP_Z, 0),
  },

  // ===== Nguong tang qua =====
  gift: {
    // Tang qua khi so lua mi tich luy tu lan tang truoc dat nguong nay
    wheatThreshold: toInt(process.env.WHEAT_GIFT_THRESHOLD, 32),
    // Hoac khi tui do day (64) thi tang som hon du chua toi nguong
    fullStackSize: 64,
  },

  // ===== Nguong Affection (dai han) =====
  affection: {
    min: 0,
    max: 100,
    // Diem tang toi da moi ngay nho chat (cap +15/ngay)
    dailyChatCap: toInt(process.env.AFFECTION_DAILY_CHAT_CAP, 15),
    // Giam dan theo gio khong tuong tac
    decayPerHour: toFloat(process.env.AFFECTION_DECAY_PER_HOUR, 1),
    // Tang vot khi nhan qua gia tri (theo ten item)
    giftBonus: {
      iron_pickaxe: 15,
      diamond_pickaxe: 15,
      iron_axe: 15,
      diamond_axe: 15,
      diamond: 15,
      bread: 5,
      cooked_beef: 5,
      cooked_porkchop: 5,
      apple: 5,
      cake: 5,
      default: 2,
    },
    // Ban do affection -> giong dieu + hanh vi (dung trong persona.js)
    tiers: [
      { min: 80, max: 100, label: 'than_thiet' },
      { min: 40, max: 79, label: 'lich_su' },
      { min: 15, max: 39, label: 'trong_khong' },
      { min: 0, max: 14, label: 'doi_hon' },
    ],
  },

  // ===== Nguong Mood tuc thoi (khong persist) =====
  mood: {
    tiredThreshold: toInt(process.env.TIRED_THRESHOLD, 70),
    scaredThreshold: toInt(process.env.SCARED_THRESHOLD, 50),
    // Ban kinh (block) de quet quai vat thu dich quanh vuon
    monsterScanRadius: toInt(process.env.MONSTER_SCAN_RADIUS, 24),
    // Tan suat cap nhat mood engine (ms)
    updateIntervalMs: toInt(process.env.MOOD_UPDATE_INTERVAL_MS, 5000),
    // Moi lan till/plant/harvest lien tiep khong nghi cong them bao nhieu diem Met
    tiredPerFarmAction: toFloat(process.env.TIRED_PER_FARM_ACTION, 2),
    // Moi phut troi mua cong them Met
    tiredPerRainMinute: toFloat(process.env.TIRED_PER_RAIN_MINUTE, 1),
    // Giam Met tu nhien khi idle/wander (moi tick cap nhat)
    tiredDecayPerTick: toFloat(process.env.TIRED_DECAY_PER_TICK, 0.5),
    // Vui giam dan tu nhien theo thoi gian (moi tick)
    happyDecayPerTick: toFloat(process.env.HAPPY_DECAY_PER_TICK, 0.3),
    // So diem Vui khi vua thu hoach / vua nhan qua / chu chat tich cuc
    happyOnHarvest: 5,
    happyOnGiftReceived: 15,
    happyOnPositiveChat: 8,
  },

  // ===== Ket noi Firebase Realtime DB =====
  firebase: {
    databaseURL: process.env.FIREBASE_DATABASE_URL || '',
    memoryPath: process.env.FIREBASE_MEMORY_PATH || 'ongtu/memory',
    relayPath: process.env.FIREBASE_RELAY_PATH || 'ongtu/relay',
  },

  // ===== Ket noi bo nao (Colab qua ngrok) =====
  brain: {
    // Neu khong dat BRAIN_ENDPOINT_OVERRIDE, bot doc URL ngrok moi nhat tu Firebase (relayPath)
    endpointOverride: process.env.BRAIN_ENDPOINT_OVERRIDE || '',
    endpointPath: process.env.BRAIN_ENDPOINT_PATH || '/generate',
    token: process.env.BRAIN_TOKEN || '',
    timeoutMs: toInt(process.env.BRAIN_TIMEOUT_MS, 15000),
  },

  // ===== Vong lap chu dong bat chuyen =====
  proactive: {
    minIntervalMs: toInt(process.env.PROACTIVE_MIN_INTERVAL_MS, 5 * 60 * 1000),
    maxIntervalMs: toInt(process.env.PROACTIVE_MAX_INTERVAL_MS, 15 * 60 * 1000),
  },

  // ===== Wander tu nhien trong vuon =====
  wander: {
    minIntervalMs: toInt(process.env.WANDER_MIN_INTERVAL_MS, 60 * 1000),
    maxIntervalMs: toInt(process.env.WANDER_MAX_INTERVAL_MS, 120 * 1000),
  },

  // ===== Trong luong lam viec =====
  farming: {
    tickIntervalMs: toInt(process.env.FARMING_TICK_INTERVAL_MS, 8000),
  },
}

// Kiem tra nhanh cac cau hinh bat buoc, canh bao neu thieu (khong throw de tranh crash lien tuc)
function validateConfig() {
  const warnings = []
  if (!CONFIG.ownerName) warnings.push('OWNER_NAME chua duoc cau hinh - bot se khong biet ai la chu.')
  if (!CONFIG.firebase.databaseURL) warnings.push('FIREBASE_DATABASE_URL chua duoc cau hinh.')
  if (!process.env.FIREBASE_DATABASE_SECRET) {
    warnings.push('Chua co FIREBASE_DATABASE_SECRET - firebase.js se khong ghi/doc duoc Firebase.')
  }
  if (!CONFIG.brain.token) warnings.push('BRAIN_TOKEN chua duoc cau hinh - goi Colab se khong xac thuc duoc.')
  return warnings
}

module.exports = { CONFIG, validateConfig }
