'use strict'

const { CONFIG } = require('./config')
const { getBrainEndpoint } = require('./firebase')
const MemoryRAG = require('./memoryRAG')

/**
 * brain.js
 * ------------------------------------------------------------
 * Goi endpoint /generate cua Colab (dia chi doc tu Firebase relay
 * hoac BRAIN_ENDPOINT_OVERRIDE), gui payload day du gom system
 * prompt, prompt hien tai, emotional_state, memory_context, wheatCount.
 * Timeout 15s, parse an toan, fallback khi loi de bot KHONG crash.
 * ------------------------------------------------------------
 */

// Khởi tạo RAG instance (chỉ 1 lần duy nhất)
let ragInstance = null

function getRagInstance() {
  if (!ragInstance) {
    try {
      ragInstance = new MemoryRAG()
      console.log('📚 RAG instance đã khởi tạo trong brain.js')
    } catch (err) {
      console.error('❌ Lỗi khởi tạo RAG trong brain.js:', err.message)
      ragInstance = null
    }
  }
  return ragInstance
}

// ĐỒNG BỘ với danh sách case trong actions/main.js — mọi giá trị ở đây
// PHẢI có case xử lý tương ứng bên actions/, nếu không sẽ luôn rơi về idle.
const VALID_ACTIONS = new Set([
  'idle',
  'wander',
  'till',
  'plant',
  'harvest',
  'rest',
  'look_owner',
  'deliver_gift',
  'wave',
  'chop_wood',
  'mine',
  'goto',
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

  let action = 'idle'
  if (VALID_ACTIONS.has(raw.action)) {
    action = raw.action
  } else {
    console.log(
      `⚠️ action không hợp lệ từ Colab: ${JSON.stringify(raw.action)} (kiểu: ${typeof raw.action}) — fallback về "idle". Giá trị hợp lệ: ${[...VALID_ACTIONS].join(', ')}`
    )
  }

  const remember = typeof raw.remember === 'string' && raw.remember.trim() ? raw.remember.trim() : null

    let affectionDelta = Number.isFinite(raw.affection_delta) ? Math.round(raw.affection_delta) : 0
  affectionDelta = Math.max(-3, Math.min(3, affectionDelta))

  const goto_x = Number.isFinite(raw.goto_x) ? Math.round(raw.goto_x) : null
  const goto_y = Number.isFinite(raw.goto_y) ? Math.round(raw.goto_y) : null
  const goto_z = Number.isFinite(raw.goto_z) ? Math.round(raw.goto_z) : null

  return { say, action, remember, affection_delta: affectionDelta, goto_x, goto_y, goto_z }
}

/**
 * Lấy RAG context từ Supabase (có debug log chi tiết)
 * @param {string} query - Câu hỏi/tin nhắn của người dùng
 * @param {number} topK - Số lượng context tối đa
 * @returns {Promise<string>} - Chuỗi context đã gộp
 */
async function fetchRAGContext(query, topK = 5) {
  // --- DEBUG: Bắt đầu ---
  console.log(`[RAG-DEBUG] fetchRAGContext được gọi với query: "${query}" (độ dài: ${query?.length || 0})`)

  if (!query || query.trim().length < 3) {
    console.log('[RAG-DEBUG] ❌ Query quá ngắn (<3 ký tự), bỏ qua RAG')
    return ''
  }

  const rag = getRagInstance()
  if (!rag) {
    console.log('[RAG-DEBUG] ❌ Không có RAG instance, bỏ qua')
    return ''
  }

  console.log('[RAG-DEBUG] 🔍 Đang tìm kiếm RAG...')
  try {
    const contexts = await rag.getContext(query, topK)
    console.log(`[RAG-DEBUG] 📊 Kết quả: tìm thấy ${contexts?.length || 0} context`)

    if (contexts && contexts.length > 0) {
      console.log(`📚 RAG: Đã lấy ${contexts.length} context cho query: "${query.slice(0, 50)}..."`)
      // In ra nội dung đầu tiên để kiểm tra
      console.log(`[RAG-DEBUG] 📄 Context đầu tiên: "${contexts[0]?.slice(0, 100)}..."`)
      return contexts.join('\n')
    } else {
      console.log('[RAG-DEBUG] ⚠️ Không tìm thấy context nào phù hợp')
      return ''
    }
  } catch (err) {
    console.error('[RAG] ❌ Lỗi lấy context:', err.message)
    return ''
  }
}

/**
 * @param {string} systemPrompt - tu persona.buildSystemPrompt()
 * @param {string} userPrompt - noi dung Tới vua noi, hoac mo ta ngu canh (proactive)
 * @param {object} emotionalState - { affection, mood_tired, mood_scared, mood_happy }
 * @param {object} memoryContext - { facts, events, recent_conversations, working_memory_flags }
 * @param {number} wheatCount
 */
async function generate(systemPrompt, userPrompt, emotionalState, memoryContext, wheatCount) {
  console.log(`[RAG-DEBUG] ===== generate() bắt đầu =====`)
  console.log(`[RAG-DEBUG] userPrompt: "${userPrompt}" (độ dài: ${userPrompt?.length || 0})`)

  // --- LẤY RAG CONTEXT TỪ SUPABASE ---
  let ragContext = ''

  // Chỉ lấy RAG context nếu userPrompt có nội dung (không phải proactive rỗng)
  if (userPrompt && userPrompt.trim().length > 0) {
    console.log('[RAG-DEBUG] Gọi fetchRAGContext...')
    ragContext = await fetchRAGContext(userPrompt, 5)
  } else {
    console.log('[RAG-DEBUG] ⚠️ userPrompt rỗng, bỏ qua RAG')
  }

  // --- GHÉP RAG CONTEXT VÀO SYSTEM PROMPT ---
  let finalSystemPrompt = systemPrompt

  if (ragContext) {
    console.log(`[RAG-DEBUG] ✅ RAG context có nội dung (độ dài: ${ragContext.length})`)
    finalSystemPrompt = systemPrompt + `\n\n[Thông tin liên quan từ trí nhớ dài hạn (RAG)]:\n${ragContext}\n`
    console.log('📚 Đã ghép RAG context vào system prompt')
  } else {
    console.log('[RAG-DEBUG] ⚠️ RAG context rỗng, không ghép vào prompt')
  }

  const endpoint = await getBrainEndpoint()
  if (!endpoint) {
    return fallbackResponse('không lấy được endpoint của Colab (relay URL trống)')
  }

  const payload = {
    system: finalSystemPrompt,
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

    // Log raw action trước khi sanitize, để biết chính xác Colab đang trả gì
    console.log(`[RAG-DEBUG] raw action từ Colab: ${JSON.stringify(data?.action)}`)

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
