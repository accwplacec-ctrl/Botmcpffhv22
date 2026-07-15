'use strict'

const { CONFIG } = require('./config')
const firebaseModule = require('./firebase')

/**
 * memory.js
 * ------------------------------------------------------------
 * Quan ly object tri nho dai han trong RAM (dong bo tu/ve Firebase),
 * cong voi cac ham tien ich: updateAffection, summarize, cong don
 * wheat, ghi facts, ghi event, danh dau moc tron da tang...
 * ------------------------------------------------------------
 */

let memory = null
let lastChatDay = null
let chatPointsToday = 0
let saveDebounceTimer = null

async function init() {
  memory = await firebaseModule.loadMemory()
  resetDailyChatCounterIfNeeded()
  return memory
}

function getMemory() {
  if (!memory) memory = firebaseModule.defaultMemory()
  return memory
}

// Luu xuong Firebase nhung debounce 3s de tranh ghi qua nhieu lan lien tiep
function scheduleSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  saveDebounceTimer = setTimeout(() => {
    firebaseModule.saveMemory(memory).catch((e) => console.log('❌ Lỗi lưu trí nhớ:', e.message))
  }, 3000)
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function resetDailyChatCounterIfNeeded() {
  const today = todayKey()
  if (lastChatDay !== today) {
    lastChatDay = today
    chatPointsToday = 0
  }
}

// ===== Affection =====

function clampAffection(v) {
  return Math.max(CONFIG.affection.min, Math.min(CONFIG.affection.max, v))
}

function updateAffection(delta, reason = '') {
  const m = getMemory()
  m.affection = clampAffection((m.affection || 0) + delta)
  if (reason) {
    console.log(`💗 Affection ${delta >= 0 ? '+' : ''}${delta} (${reason}) -> ${m.affection}`)
  }
  scheduleSave()
  return m.affection
}

// Tang affection do chat, gioi han +15/ngay (dailyChatCap)
function updateAffectionFromChat(delta) {
  resetDailyChatCounterIfNeeded()
  const cap = CONFIG.affection.dailyChatCap
  const remaining = Math.max(0, cap - chatPointsToday)
  const applied = Math.max(0, Math.min(delta, remaining))
  chatPointsToday += applied
  if (applied > 0) updateAffection(applied, 'chat')
  return applied
}

// Giam affection theo gio khong tuong tac - goi dinh ky (vd moi gio)
function decayAffection() {
  const m = getMemory()
  const before = m.affection
  m.affection = clampAffection((m.affection || 0) - CONFIG.affection.decayPerHour)
  if (m.affection !== before) {
    console.log(`💤 Affection giảm tự nhiên: ${before} -> ${m.affection}`)
    scheduleSave()
  }
}

// Tang vot affection khi nhan qua, tra ve so diem da cong
function bonusAffectionForGift(itemName) {
  const table = CONFIG.affection.giftBonus
  const bonus = table[itemName] !== undefined ? table[itemName] : table.default
  updateAffection(bonus, `quà: ${itemName}`)
  return bonus
}

function getAffectionTierLabel() {
  const m = getMemory()
  const tier = CONFIG.affection.tiers.find((t) => m.affection >= t.min && m.affection <= t.max)
  return tier ? tier.label : 'lich_su'
}

// ===== Facts / events / conversations =====

function setFact(key, value) {
  const m = getMemory()
  m.facts = m.facts || {}
  m.facts[key] = value
  scheduleSave()
}

function getFact(key) {
  const m = getMemory()
  return m.facts ? m.facts[key] : undefined
}

// remember tra ve tu Colab moi luot - gop vao facts theo timestamp de khong ghi de mat lich su
function rememberFromBrain(text) {
  if (!text) return
  const m = getMemory()
  m.events = m.events || []
  m.events.push({ text, timestamp: Date.now() })
  // Gioi han so event luu de tranh phinh to du lieu
  if (m.events.length > 100) m.events = m.events.slice(-100)
  scheduleSave()
}

function pushConversation(role, text) {
  const m = getMemory()
  m.recent_conversations = m.recent_conversations || []
  m.recent_conversations.push({ role, text, timestamp: Date.now() })
  if (m.recent_conversations.length > 20) {
    m.recent_conversations = m.recent_conversations.slice(-20)
  }
  scheduleSave()
}

// ===== Lua mi tang qua =====

function addWheatGifted(count) {
  const m = getMemory()
  m.wheatSinceLastGift = 0
  m.total_wheat_gifted = (m.total_wheat_gifted || 0) + count
  scheduleSave()
  return checkMilestone(m.total_wheat_gifted)
}

function addWheatSinceLastGift(count) {
  const m = getMemory()
  m.wheatSinceLastGift = (m.wheatSinceLastGift || 0) + count
  scheduleSave()
  return m.wheatSinceLastGift
}

// Kiem tra moc tron (1000, 5000, 10000...) - tra ve moc neu vua dat, null neu chua
const MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000]
function checkMilestone(total) {
  const m = getMemory()
  m.milestones_announced = m.milestones_announced || []
  for (const milestone of MILESTONES) {
    if (total >= milestone && !m.milestones_announced.includes(milestone)) {
      m.milestones_announced.push(milestone)
      scheduleSave()
      return milestone
    }
  }
  return null
}

// ===== Death tracking =====

function recordDeath(reason) {
  const m = getMemory()
  m.last_died_reason = reason || 'không rõ lý do'
  m.last_death_mentioned = false
  scheduleSave()
}

function consumeDeathMention() {
  const m = getMemory()
  if (m.last_died_reason && !m.last_death_mentioned) {
    m.last_death_mentioned = true
    scheduleSave()
    return m.last_died_reason
  }
  return null
}

// ===== Tom tat cho prompt =====

function summarize() {
  const m = getMemory()
  return {
    affection: m.affection,
    affection_tier: getAffectionTierLabel(),
    total_wheat_gifted: m.total_wheat_gifted,
    first_meet: m.first_meet,
    facts: m.facts || {},
    recent_events: (m.events || []).slice(-10),
    recent_conversations: (m.recent_conversations || []).slice(-10),
  }
}

module.exports = {
  init,
  getMemory,
  updateAffection,
  updateAffectionFromChat,
  decayAffection,
  bonusAffectionForGift,
  getAffectionTierLabel,
  setFact,
  getFact,
  rememberFromBrain,
  pushConversation,
  addWheatGifted,
  addWheatSinceLastGift,
  recordDeath,
  consumeDeathMention,
  summarize,
}
