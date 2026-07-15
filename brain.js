'use strict'

const { CONFIG } = require('./config')
const { getBrainEndpoint } = require('./firebase')

/**
 * brain.js
 * ------------------------------------------------------------
 * Goi endpoint /generate cua Colab (dia chi doc tu Firebase relay
 * hoac BRAIN_ENDPOINT_OVERRIDE), gui payload day du gom system
 * prompt, prompt hien tai, emotional_state, memory_context, wheatCount.
 * Timeout 15s, parse an toan, fallback khi loi de bot KHONG crash.
 * ------------------------------------------------------------
 */

const VALID_ACTIONS = new Set([
  'idle',
  'wander',
  'till',
  'plant',
  'harvest',
  'sit',
  'wave',
  'look_owner',
  'deliver_gift',
  'rest',
  'avoid_owner',
  'avoid_monster',
])

function fallbackResponse(reason) {
  console.log(`⚠️ Dùng phản hồi dự phòng (fallback) từ brain.js: ${reason}`)
  return {
    say: '',
    action: 'idle',
    remember: null,
    affection_delta: 0,
  }
}

// Kiem tra + chuan hoa response tu Colab, tra ve fallback neu sai dinh dang
function sanitizeResponse(raw) {
  if (!raw || typeof raw !== 'object') return fallbackResponse('response không phải object')

  const say = typeof raw.say === 'string' ? raw.say.slice(0, 250) : ''
  const action = VALID_ACTIONS.has(raw.action) ? raw.action : 'idle'
  const remember = typeof raw.remember === 'string' && raw.remember.trim() ? raw.remember.trim() : null

  let affectionDelta = Number.isFinite(raw.affection_delta) ? Math.round(raw.affection_delta) : 0
  affectionDelta = Math.max(-3, Math.min(3, affectionDelta))

  return { say, action, remember, affection_delta: affectionDelta }
}

/**
 * @param {string} systemPrompt - tu persona.buildSystemPrompt()
 * @param {string} userPrompt - noi dung Tới vua noi, hoac mo ta ngu canh (proactive)
 * @param {object} emotionalState - { affection, mood_tired, mood_scared, mood_happy }
 * @param {object} memoryContext - { facts, events, recent_conversations, working_memory_flags }
 * @param {number} wheatCount
 */
async function generate(systemPrompt, userPrompt, emotionalState, memoryContext, wheatCount) {
  const endpoint = await getBrainEndpoint()
  if (!endpoint) {
    return fallbackResponse('không lấy được endpoint của Colab (relay URL trống)')
  }

  const payload = {
    system: systemPrompt,
    prompt: userPrompt,
    emotional_state: emotionalState,
    memory_context: memoryContext,
    wheatCount,
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), CONFIG.brain.timeoutMs)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Brain-Token': CONFIG.brain.token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutHandle)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return fallbackResponse(`HTTP ${res.status} từ Colab: ${text.slice(0, 200)}`)
    }

    let data
    try {
      data = await res.json()
    } catch (e) {
      return fallbackResponse(`không parse được JSON trả về: ${e.message}`)
    }

    return sanitizeResponse(data)
  } catch (e) {
    clearTimeout(timeoutHandle)
    if (e.name === 'AbortError') {
      return fallbackResponse(`timeout sau ${CONFIG.brain.timeoutMs}ms`)
    }
    return fallbackResponse(`lỗi gọi Colab: ${e.message}`)
  }
}

module.exports = { generate, VALID_ACTIONS }
