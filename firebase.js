'use strict'

const admin = require('firebase-admin')
const fs = require('fs')
const { CONFIG } = require('./config')

/**
 * firebase.js
 * ------------------------------------------------------------
 * Khoi tao Firebase Admin SDK va cung cap cac ham doc/ghi:
 *  - Tri nho dai han (facts, affection, wheatSinceLastGift, total_wheat_gifted...)
 *  - URL relay (ngrok) moi nhat ma Colab tu ghi len, Railway doc realtime
 * ------------------------------------------------------------
 */

let dbInitialized = false
let db = null
let relayCache = { url: null, updatedAt: 0 }

function loadServiceAccount() {
  if (CONFIG.firebase.serviceAccountJson) {
    try {
      return JSON.parse(CONFIG.firebase.serviceAccountJson)
    } catch (e) {
      console.log('❌ Không parse được FIREBASE_SERVICE_ACCOUNT_JSON:', e.message)
      return null
    }
  }
  if (CONFIG.firebase.serviceAccountPath) {
    try {
      const raw = fs.readFileSync(CONFIG.firebase.serviceAccountPath, 'utf8')
      return JSON.parse(raw)
    } catch (e) {
      console.log('❌ Không đọc được FIREBASE_SERVICE_ACCOUNT_PATH:', e.message)
      return null
    }
  }
  return null
}

function initFirebase() {
  if (dbInitialized) return db
  const serviceAccount = loadServiceAccount()

  if (!serviceAccount || !CONFIG.firebase.databaseURL) {
    console.log('⚠️ Firebase chưa được cấu hình đầy đủ — trí nhớ dài hạn sẽ KHÔNG được lưu.')
    return null
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: CONFIG.firebase.databaseURL,
    })
    db = admin.database()
    dbInitialized = true
    console.log('🔥 Firebase Realtime DB đã kết nối.')
  } catch (e) {
    console.log('❌ Lỗi khởi tạo Firebase:', e.message)
    db = null
  }

  return db
}

// ===== Mac dinh cho tri nho dai han khi chua ton tai =====
function defaultMemory() {
  return {
    affection: 50,
    wheatSinceLastGift: 0,
    total_wheat_gifted: 0,
    first_meet: Date.now(),
    last_died_reason: null,
    facts: {},
    events: [],
    recent_conversations: [],
    // Danh dau moc tron da nhac de tranh nhac lai
    milestones_announced: [],
    // Danh dau da than ve lan chet gan nhat chua
    last_death_mentioned: true,
  }
}

async function loadMemory() {
  const database = initFirebase()
  if (!database) return defaultMemory()

  try {
    const snap = await database.ref(CONFIG.firebase.memoryPath).once('value')
    const data = snap.val()
    if (!data) {
      const fresh = defaultMemory()
      await saveMemory(fresh)
      return fresh
    }
    // Merge voi default de dam bao khong thieu field neu schema cu hon
    return { ...defaultMemory(), ...data }
  } catch (e) {
    console.log('❌ Lỗi đọc trí nhớ từ Firebase:', e.message)
    return defaultMemory()
  }
}

async function saveMemory(memoryObj) {
  const database = initFirebase()
  if (!database) return false

  try {
    await database.ref(CONFIG.firebase.memoryPath).set(memoryObj)
    return true
  } catch (e) {
    console.log('❌ Lỗi ghi trí nhớ vào Firebase:', e.message)
    return false
  }
}

// ===== Doc URL relay (ngrok) moi nhat do Colab ghi =====
// Cache 5s de tranh spam Firebase khi brain.js goi lien tuc.
async function getBrainEndpoint() {
  if (CONFIG.brain.endpointOverride) {
    return CONFIG.brain.endpointOverride.replace(/\/$/, '') + CONFIG.brain.endpointPath
  }

  const now = Date.now()
  if (relayCache.url && now - relayCache.updatedAt < 5000) {
    return relayCache.url
  }

  const database = initFirebase()
  if (!database) return null

  try {
    const snap = await database.ref(CONFIG.firebase.relayPath).once('value')
    const data = snap.val()
    // Cho phep Colab ghi { url: "..." } hoac chuoi thang
    const url = typeof data === 'string' ? data : data && data.url
    if (!url) return null

    relayCache = { url: url.replace(/\/$/, '') + CONFIG.brain.endpointPath, updatedAt: now }
    return relayCache.url
  } catch (e) {
    console.log('❌ Lỗi đọc relay URL từ Firebase:', e.message)
    return null
  }
}

// Lang nghe realtime thay doi cua relay URL (goi 1 lan luc khoi dong, khong bat buoc dung)
function watchRelayUrl(onChange) {
  const database = initFirebase()
  if (!database) return
  database.ref(CONFIG.firebase.relayPath).on('value', (snap) => {
    const data = snap.val()
    const url = typeof data === 'string' ? data : data && data.url
    if (url) {
      relayCache = { url: url.replace(/\/$/, '') + CONFIG.brain.endpointPath, updatedAt: Date.now() }
      if (onChange) onChange(relayCache.url)
    }
  })
}

module.exports = {
  initFirebase,
  loadMemory,
  saveMemory,
  getBrainEndpoint,
  watchRelayUrl,
  defaultMemory,
}
