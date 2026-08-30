'use strict'

const { CONFIG } = require('./config')

/**
 * moodEngine.js
 * ------------------------------------------------------------
 * Quan ly 3 mood tuc thoi (tired/scared/happy, 0-100), hoan toan
 * in-memory, KHONG persist Firebase, reset moi session.
 *
 * update() duoc goi dinh ky bang setInterval RIENG (khong block
 * event loop chinh, khong tu goi Colab) - chi tinh toan lai so
 * dua tren trang thai vat ly hien tai cua bot (mua, quai gan,
 * so lan farm lien tiep).
 * ------------------------------------------------------------
 */

const state = {
  tired: 0,
  scared: 0,
  happy: 50, // bat dau o muc trung tinh
}

let consecutiveFarmActions = 0
let lastFarmActionAt = 0
let intervalHandle = null

function clamp(v) {
  return Math.max(0, Math.min(100, v))
}

// Goi moi khi bot vua thuc hien till/plant/harvest (KHONG co nghi giua)
function notifyFarmAction() {
  consecutiveFarmActions += 1
  lastFarmActionAt = Date.now()
  state.tired = clamp(state.tired + CONFIG.mood.tiredPerFarmAction)
}

// Goi khi bot idle/wander/rest - danh dau "co nghi", reset chuoi farm lien tiep
function notifyRestOrIdle() {
  consecutiveFarmActions = 0
}

// Goi khi vua thu hoach xong 1 mon / nhan qua / chu chat tich cuc
function addHappyOnHarvest() {
  state.happy = clamp(state.happy + CONFIG.mood.happyOnHarvest)
}

function addHappyOnGiftReceived() {
  state.happy = clamp(state.happy + CONFIG.mood.happyOnGiftReceived)
}

function addHappyOnPositiveChat() {
  state.happy = clamp(state.happy + CONFIG.mood.happyOnPositiveChat)
}

// Quet quai vat thu dich quanh bot trong ban kinh cau hinh, tra ve khoang cach gan nhat (hoac null)
function scanNearestHostileDistance(bot) {
  if (!bot || !bot.entity) return null
  try {
    const entities = Object.values(bot.entities || {})
    let nearest = null
    for (const e of entities) {
      if (!e || !e.position) continue
      const isHostile =
        e.kind === 'Hostile mobs' ||
        e.type === 'hostile' ||
        /zombie|skeleton|creeper|spider|enderman|witch|drowned|husk|phantom|piglin_brute|slime/.test(
          (e.name || e.mobType || '').toLowerCase()
        )
      if (!isHostile) continue
      const dist = bot.entity.position.distanceTo(e.position)
      if (dist <= CONFIG.mood.monsterScanRadius) {
        if (nearest === null || dist < nearest) nearest = dist
      }
    }
    return nearest
  } catch (e) {
    return null
  }
}

// Tinh Scared dua tren khoang cach quai gan nhat: cang gan cang cao (60-100)
function scaredFromDistance(distance, radius) {
  if (distance === null) return 0
  const ratio = 1 - Math.min(distance / radius, 1) // 0 (xa nhat) -> 1 (sat ben)
  return Math.round(60 + ratio * 40) // 60..100
}

let lastRainCheckAt = 0

function update(bot) {
  const now = Date.now()

  // --- Scared: quet quai moi tick ---
  const nearestDist = scanNearestHostileDistance(bot)
  if (nearestDist !== null) {
    state.scared = clamp(Math.max(state.scared, scaredFromDistance(nearestDist, CONFIG.mood.monsterScanRadius)))
  } else {
    // Khong co quai gan -> Scared giam dan nhanh hon binh thuong
    state.scared = clamp(state.scared - 15)
  }

  // --- Tired: cong theo mua (tinh theo phut thuc te troi qua) ---
  if (bot && bot.isRaining) {
    const elapsedMin = lastRainCheckAt ? (now - lastRainCheckAt) / 60000 : 0
    state.tired = clamp(state.tired + CONFIG.mood.tiredPerRainMinute * elapsedMin)
  }
  lastRainCheckAt = now

  // Neu lau roi khong farm (>15s) thi coi la dang nghi -> Tired giam dan
  if (now - lastFarmActionAt > 15000) {
    state.tired = clamp(state.tired - CONFIG.mood.tiredDecayPerTick)
  }

  // --- Happy: giam dan tu nhien theo thoi gian ---
  state.happy = clamp(state.happy - CONFIG.mood.happyDecayPerTick)
}

function startEngine(bot) {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = setInterval(() => update(bot), CONFIG.mood.updateIntervalMs)
}

function stopEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

// Reset toan bo mood ve trang thai trung tinh (goi luc bot vua spawn lai session moi)
function resetSession() {
  state.tired = 0
  state.scared = 0
  state.happy = 50
  consecutiveFarmActions = 0
  lastFarmActionAt = 0
  lastRainCheckAt = 0
}

function getMoodState() {
  return { ...state }
}

// Ap dung quy tac uu tien: Sợ > Mệt > binh thuong (Affection)
function getDominantMood() {
  if (state.scared >= CONFIG.mood.scaredThreshold) {
    return { type: 'scared', value: state.scared }
  }
  if (state.tired >= CONFIG.mood.tiredThreshold) {
    return { type: 'tired', value: state.tired }
  }
  return { type: 'normal', value: state.happy }
}

module.exports = {
  update,
  startEngine,
  stopEngine,
  resetSession,
  notifyFarmAction,
  notifyRestOrIdle,
  addHappyOnHarvest,
  addHappyOnGiftReceived,
  addHappyOnPositiveChat,
  getMoodState,
  getDominantMood,
}
