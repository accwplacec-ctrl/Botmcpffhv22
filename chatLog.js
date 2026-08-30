'use strict'

/**
 * chatLog.js
 * ------------------------------------------------------------
 * Quan ly 2 luong chat ngan han, thuan in-memory (khong luu DB,
 * mat het khi restart - dung cho ngu canh hoi thoai gan nhat dua
 * vao prompt, khac voi tri nho dai han/affection trong memory.js).
 *
 * - general_chat : toi da 25 tin gan nhat cua MOI NGUOI (owner/khac/bot)
 * - boss_chat    : toi da 50 tin gan nhat, CHI cua owner (khong tinh tin bot)
 * ------------------------------------------------------------
 */

const GENERAL_LIMIT = 25
const BOSS_LIMIT = 50
const MAX_MESSAGE_LENGTH = 120

// Cac tu khoa nhay cam - tin nhan chua 1 trong so nay se bi loai bo hoan toan,
// khong luu vao ca 2 luong, de tranh lo toa do/vi tri nha ra ngu canh gui len Gemini.
const BLOCKED_KEYWORDS = ['base', 'tọa độ', 'toạ độ', 'toa do', 'coord']

let generalChat = []
let bossChat = []

/**
 * Kiem tra 1 tin nhan co hop le de luu khong.
 * @param {string} text
 * @returns {boolean}
 */
function isValidMessage(text) {
  if (!text) return false

  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length > MAX_MESSAGE_LENGTH) return false

  const lower = trimmed.toLowerCase()
  const hasBlockedKeyword = BLOCKED_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
  if (hasBlockedKeyword) return false

  return true
}

/**
 * Them 1 tin nhan moi vao chatLog.
 * @param {string} username - ten nguoi gui (hoac ten bot neu role la 'bot')
 * @param {string} text - noi dung tin nhan
 * @param {boolean} isOwner - true neu nguoi gui la chu (boss)
 * @param {'owner'|'other'|'bot'} [roleOverride] - de ghi log tin cua chinh bot noi ra, truyen 'bot'
 */
function addMessage(username, text, isOwner, roleOverride) {
  if (!isValidMessage(text)) return

  const role = roleOverride || (isOwner ? 'owner' : 'other')
  const entry = {
    role,
    username: username || 'unknown',
    text: text.trim(),
    timestamp: Date.now(),
  }

  // Luong 1: general_chat - luu tat ca (owner/other/bot)
  generalChat.push(entry)
  if (generalChat.length > GENERAL_LIMIT) {
    generalChat = generalChat.slice(-GENERAL_LIMIT) // sliding window: bo tin cu nhat
  }

  // Luong 2: boss_chat - CHI luu khi la owner chat (khong tinh tin bot tu noi)
  if (role === 'owner') {
    bossChat.push(entry)
    if (bossChat.length > BOSS_LIMIT) {
      bossChat = bossChat.slice(-BOSS_LIMIT) // sliding window: bo tin cu nhat
    }
  }
}

/**
 * Lay toan bo general_chat hien tai (toi da 25 tin gan nhat).
 * @returns {Array<{role:string, username:string, text:string, timestamp:number}>}
 */
function getGeneralChat() {
  return [...generalChat]
}

/**
 * Lay toan bo boss_chat hien tai (toi da 50 tin gan nhat cua owner).
 * @returns {Array<{role:string, username:string, text:string, timestamp:number}>}
 */
function getBossChat() {
  return [...bossChat]
}

/**
 * Lay du lieu rut gon de dua vao prompt goi len bo nao (Colab/Gemini).
 * @returns {{general: Array, boss: Array}}
 */
function getRecentForPrompt() {
  return {
    general: getGeneralChat(),
    boss: getBossChat(),
  }
}

/**
 * Xoa sach ca 2 luong chat (vd khi can reset session).
 */
function clear() {
  generalChat = []
  bossChat = []
}

module.exports = {
  addMessage,
  getGeneralChat,
  getBossChat,
  getRecentForPrompt,
  clear,
}
