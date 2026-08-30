'use strict'

/**
 * firebase.js — PHIEN BAN MOI: dung Firebase REST API + Database Secret
 * KHONG dung firebase-admin / service account JSON nua.
 * Ly do: private key RSA trong service account JSON bi bien doi khi paste
 * qua mobile UI -> JWT signature sai -> "invalid_grant".
 * Database Secret la 1 chuoi don gian, khong can JWT, khong bi loi nay.
 * ------------------------------------------------------------
 */

const https = require('https')
const { CONFIG } = require('./config')

const DB_URL = CONFIG.firebase.databaseURL.replace(/\/$/, '')
const SECRET = process.env.FIREBASE_DATABASE_SECRET || ''

let relayCache = { url: null, updatedAt: 0 }

if (!SECRET) {
  console.log('⚠️  FIREBASE_DATABASE_SECRET chưa được cấu hình — trí nhớ dài hạn sẽ không được lưu.')
}

// ===== REST helper =====

function restRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!SECRET || !DB_URL) {
      return reject(new Error('Firebase chưa cấu hình (thiếu URL hoặc SECRET)'))
    }

    const url = new URL(`${DB_URL}/${path}.json?auth=${SECRET}`)
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Firebase REST ${res.statusCode}: ${data}`))
        }
        try {
          resolve(data ? JSON.parse(data) : null)
        } catch (e) {
          resolve(data)
        }
      })
    })

    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ===== Memory =====

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
    milestones_announced: [],
    last_death_mentioned: true,
  }
}

async function loadMemory() {
  if (!SECRET) return defaultMemory()
  try {
    const data = await restRequest('GET', CONFIG.firebase.memoryPath)
    if (!data) {
      const fresh = defaultMemory()
      await saveMemory(fresh)
      return fresh
    }
    return { ...defaultMemory(), ...data }
  } catch (e) {
    console.log('❌ Lỗi đọc trí nhớ từ Firebase:', e.message)
    return defaultMemory()
  }
}

async function saveMemory(memoryObj) {
  if (!SECRET) return false
  try {
    await restRequest('PUT', CONFIG.firebase.memoryPath, memoryObj)
    return true
  } catch (e) {
    console.log('❌ Lỗi ghi trí nhớ vào Firebase:', e.message)
    return false
  }
}

// ===== Relay URL (ngrok) =====

async function getBrainEndpoint() {
  if (CONFIG.brain.endpointOverride) {
    return CONFIG.brain.endpointOverride.replace(/\/$/, '') + CONFIG.brain.endpointPath
  }

  const now = Date.now()
  if (relayCache.url && now - relayCache.updatedAt < 5000) {
    return relayCache.url
  }

  if (!SECRET) return null
  try {
    const data = await restRequest('GET', CONFIG.firebase.relayPath)
    const url = typeof data === 'string' ? data : data && data.url
    if (!url) return null
    relayCache = { url: url.replace(/\/$/, '') + CONFIG.brain.endpointPath, updatedAt: now }
    return relayCache.url
  } catch (e) {
    console.log('❌ Lỗi đọc relay URL từ Firebase:', e.message)
    return null
  }
}

function initFirebase() {
  if (!SECRET) {
    console.log('⚠️  Firebase: chạy không có SECRET, bỏ qua.')
    return null
  }
  console.log('🔥 Firebase REST API đã sẵn sàng (dùng Database Secret, không cần JWT).')
  return true
}

function watchRelayUrl(onChange) {
  // REST API không hỗ trợ realtime listener như Admin SDK.
  // Thay vao do, poll moi 10s neu can theo doi su thay doi URL.
  if (!SECRET || !onChange) return
  setInterval(async () => {
    try {
      const data = await restRequest('GET', CONFIG.firebase.relayPath)
      const url = typeof data === 'string' ? data : data && data.url
      if (url) {
        const full = url.replace(/\/$/, '') + CONFIG.brain.endpointPath
        if (full !== relayCache.url) {
          relayCache = { url: full, updatedAt: Date.now() }
          onChange(full)
        }
      }
    } catch (e) { /* bo qua loi poll */ }
  }, 10000)
}

module.exports = {
  initFirebase,
  loadMemory,
  saveMemory,
  getBrainEndpoint,
  watchRelayUrl,
  defaultMemory,
}
