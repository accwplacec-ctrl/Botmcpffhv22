'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const { CONFIG, validateConfig } = require('./config')
const firebaseModule = require('./firebase')
const memory = require('./memory')
const workingMemory = require('./workingMemory')
const moodEngine = require('./moodEngine')
const persona = require('./persona')
const brain = require('./brain')
const garden = require('./garden')
const proactive = require('./proactive')
const chatLog = require('./chatLog')

// --- ACTIONS (tách ra thư mục actions/) ---
const { executeAction: dispatchAction } = require('./actions/main')

// --- TÍCH HỢP RAG ---
const MemoryRAG = require('./memoryRAG')

let bot = null
let reconnectAttempts = 0
let shuttingDown = false

let rag = null // Instance RAG cho Supabase

let farmingTickHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false

// ==================== QUẢN LÝ ACTIVE SESSION (CỬA SỔ HỘI THOẠI) ====================
let currentSpeaker = null        // Lưu tên người chơi đang hội thoại với bot
let sessionTimeoutHandle = null // Handle của setTimeout
const SESSION_TIMEOUT_MS = 30000 // 30 giây duy trì phiên trò chuyện không cần gõ Trigger

function refreshSession(username) {
  currentSpeaker = username
  if (sessionTimeoutHandle) clearTimeout(sessionTimeoutHandle)
  sessionTimeoutHandle = setTimeout(() => {
    console.log(`⏳ Phiên trò chuyện với ${currentSpeaker} đã hết hạn (30s). Bot quay lại làm việc.`)
    currentSpeaker = null
    sessionTimeoutHandle = null
  }, SESSION_TIMEOUT_MS)
}

function clearSession() {
  if (currentSpeaker) {
    console.log(`🔇 Đóng session trò chuyện với ${currentSpeaker}.`)
  }
  currentSpeaker = null
  if (sessionTimeoutHandle) {
    clearTimeout(sessionTimeoutHandle)
    sessionTimeoutHandle = null
  }
}

// ==================== HTTP SERVER: GIỮ PORT CHO RENDER + DASHBOARD TRẠNG THÁI ====================

const http = require('http')

let lastCpuUsage = process.cpuUsage()
let lastCpuCheck = Date.now()

function getCpuPercent() {
  const currentUsage = process.cpuUsage()
  const now = Date.now()
  const elapsedMs = now - lastCpuCheck
  if (elapsedMs <= 0) return '0.0'
  const userDiff = currentUsage.user - lastCpuUsage.user
  const sysDiff = currentUsage.system - lastCpuUsage.system
  const totalDiffMicros = userDiff + sysDiff
  const pct = (totalDiffMicros / (elapsedMs * 1000)) * 100
  lastCpuUsage = currentUsage
  lastCpuCheck = now
  return pct.toFixed(1)
}

function getStatusHtml() {
  const mem = process.memoryUsage()
  const uptimeSec = process.uptime()
  const h = Math.floor(uptimeSec / 3600)
  const m = Math.floor((uptimeSec % 3600) / 60)
  const s = Math.floor(uptimeSec % 60)

  const rssMB = (mem.rss / 1024 / 1024).toFixed(1)
  const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1)
  const heapTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1)
  const externalMB = (mem.external / 1024 / 1024).toFixed(1)
  const heapPct = mem.heapTotal ? (mem.heapUsed / mem.heapTotal * 100).toFixed(0) : 0
  const cpuPct = getCpuPercent()

  const botOnline = !!bot
  const botStatus = botOnline ? '🟢 Đang online' : '🔴 Mất kết nối'
  const pos = botOnline && bot.entity
    ? `(${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})`
    : '—'
  const speaker = currentSpeaker || '—'
  const wheat = botOnline ? countWheatInInventory() : 0

  const onlinePlayers = botOnline
    ? Object.keys(bot.players || {}).filter((n) => n !== bot.username)
    : []
  const onlinePlayersHtml = onlinePlayers.length ? onlinePlayers.join(', ') : '—'

  let moodHtml = '—'
  let affectionVal = '—'
  let totalWheatGifted = '—'
  let lastDied = '—'
  let firstMeet = '—'
  try {
    const mood = moodEngine.getMoodState()
    const mem2 = memory.summarize()
    affectionVal = mem2.affection ?? '—'
    moodHtml = `Affection ${affectionVal} | Tired ${Math.round(mood.tired)} | Scared ${Math.round(mood.scared)} | Happy ${Math.round(mood.happy)}`
    const rawMem = memory.getMemory ? memory.getMemory() : {}
    totalWheatGifted = rawMem.total_wheat_gifted ?? '—'
    lastDied = rawMem.last_died_reason ?? '—'
    firstMeet = rawMem.first_meet ?? '—'
  } catch (e) {}

  const ragStatus = rag ? '🟢 Kết nối' : '🔴 Chưa kết nối'
  const brainStatus = brainCallInFlight ? '⏳ Đang xử lý...' : '💤 Rảnh'
  const reconnects = reconnectAttempts

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="10">
<title>Ông Tư - Trạng thái Bot</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #eee; padding: 24px; max-width: 600px; margin: 0 auto; }
  h1 { color: #ffd700; }
  .card { background: #16213e; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2a2a4a; }
  .row:last-child { border-bottom: none; }
  .label { color: #9aa; }
  .value { font-weight: 600; text-align: right; }
  .bar-bg { background: #2a2a4a; border-radius: 6px; height: 10px; overflow: hidden; margin-top: 6px; }
  .bar-fill { background: linear-gradient(90deg,#4ade80,#22c55e); height: 100%; }
  .section-title { color: #667; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px 4px; }
</style>
</head>
<body>
<h1>🌾 Ông Tư - Trạng thái Bot</h1>

<div class="section-title">Trong game</div>
<div class="card">
  <div class="row"><span class="label">Trạng thái Minecraft</span><span class="value">${botStatus}</span></div>
  <div class="row"><span class="label">Vị trí</span><span class="value">${pos}</span></div>
  <div class="row"><span class="label">Người chơi online</span><span class="value">${onlinePlayersHtml}</span></div>
  <div class="row"><span class="label">Đang trò chuyện với</span><span class="value">${speaker}</span></div>
  <div class="row"><span class="label">Lúa mì trong túi</span><span class="value">${wheat}</span></div>
</div>

<div class="section-title">Trí nhớ & cảm xúc</div>
<div class="card">
  <div class="row"><span class="label">Cảm xúc</span><span class="value">${moodHtml}</span></div>
  <div class="row"><span class="label">Tổng lúa đã tặng</span><span class="value">${totalWheatGifted}</span></div>
  <div class="row"><span class="label">Lần chết gần nhất</span><span class="value">${lastDied}</span></div>
  <div class="row"><span class="label">Lần đầu gặp</span><span class="value">${firstMeet}</span></div>
  <div class="row"><span class="label">RAG (Supabase)</span><span class="value">${ragStatus}</span></div>
  <div class="row"><span class="label">Bộ não (brain call)</span><span class="value">${brainStatus}</span></div>
</div>

<div class="section-title">Hệ thống</div>
<div class="card">
  <div class="row"><span class="label">Uptime</span><span class="value">${h}h ${m}m ${s}s</span></div>
  <div class="row"><span class="label">Số lần reconnect</span><span class="value">${reconnects}</span></div>
  <div class="row"><span class="label">CPU</span><span class="value">${cpuPct}%</span></div>
  <div class="row"><span class="label">RAM (RSS)</span><span class="value">${rssMB} MB</span></div>
  <div class="row"><span class="label">External (buffers/native)</span><span class="value">${externalMB} MB</span></div>
  <div class="row"><span class="label">Heap dùng / tổng</span><span class="value">${heapUsedMB} / ${heapTotalMB} MB</span></div>
  <div class="bar-bg"><div class="bar-fill" style="width:${heapPct}%"></div></div>
</div>

<p style="color:#667; font-size:12px;">Tự làm mới mỗi 10 giây · /ping dùng cho UptimeRobot</p>
</body>
</html>`
}

http
  .createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end('pong')
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getStatusHtml())
  })
  .listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP giữ chỗ đang chạy ở port ${process.env.PORT || 3000}`)
  })

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

// ==================== TIỆN ÍCH LỌC CHUỖI & CHAT ====================

function cleanMinecraftText(str) {
  if (!str) return ''
  return str
    .replace(/§[0-9a-fk-or]/gi, '')    // Xóa mã màu/format Minecraft
    .replace(/^\[.*?\]\s*/g, '')      // Xóa prefix [Thành viên], [VIP] ở đầu
    .trim()
}

function say(message) {
  if (!bot || !message) return
  try {
    bot.chat(String(message).slice(0, 250))
  } catch (e) {
    console.log('❌ Lỗi khi chat:', e.message)
  }
}

function getOwnerEntity() {
  if (!bot) return null
  for (const name of CONFIG.ownerNames) {
    const p = bot.players && bot.players[name]
    if (p && p.entity) return p.entity
  }
  return null
}

function countWheatInInventory() {
  if (!bot) return 0
  return bot.inventory
    .items()
    .filter((i) => i.name === 'wheat')
    .reduce((sum, i) => sum + i.count, 0)
}

// ==================== KẾT NỐI VÀO SERVER ====================

function connect() {
  console.log(`🔄 Kết nối lần ${reconnectAttempts + 1}...`)
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 60000,
    keepAlive: true,
  })

  bot.loadPlugin(pathfinder)
  registerEvents()
}

function registerEvents() {
  bot.once('spawn', onSpawn)
  bot.on('chat', onChat)
  bot.on('death', onDeath)
  bot.on('playerCollect', onPlayerCollect)
  bot.on('kicked', (reason) => console.log('👢 Bị kick khỏi server:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi bot:', err && err.message ? err.message : err))
  bot.on('end', onEnd)
}

async function onSpawn() {
  console.log('✅ Ông Tư đã vào vườn tại', bot.entity.position)
  reconnectAttempts = 0

  // Khởi tạo RAG với Supabase
  try {
    rag = new MemoryRAG()
    console.log('📚 Trí nhớ Supabase RAG sẵn sàng!')
  } catch (err) {
    console.error('❌ Lỗi khởi tạo RAG:', err.message)
    rag = null
  }

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  bot.pathfinder.setMovements(movements)

  await memory.init()
  moodEngine.resetSession()
  moodEngine.startEngine(bot)

  startFarmingCycle()
  startAffectionDecayLoop()
  startWorkingMemorySweep()

  proactive.start(bot, () => runBrainTurn('proactive', null))
}

function onEnd(reason) {
  console.log('🔌 Mất kết nối:', reason || '')
  stopAllLoops()
  clearSession()
  proactive.stop()
  moodEngine.stopEngine()
  bot = null
  if (!shuttingDown) scheduleReconnect()
}

function scheduleReconnect() {
  const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 120000)
  reconnectAttempts++
  console.log(`⏳ Kết nối lại sau ${Math.round(delay / 1000)}s (lần ${reconnectAttempts})...`)
  setTimeout(connect, delay)
}

function stopAllLoops() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  farmingTickHandle = null
  affectionDecayHandle = null
  workingMemorySweepHandle = null
}

// ==================== SỰ KIỆN: CHẾT & TẶNG ĐỒ ====================

function onDeath() {
  let reason = 'không rõ lý do'
  try {
    if (bot.lastDamageSource) reason = String(bot.lastDamageSource)
  } catch (e) {}
  console.log(`☠️ Ông Tư vừa chết: ${reason}`)
  memory.recordDeath(reason)

  // Lưu sự kiện chết vào RAG
  if (rag && bot && bot.entity) {
    rag.addDocument(`[SỰ KIỆN] Bot đã chết tại vị trí (${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}) do: ${reason}`, {
      type: 'death',
      position: bot.entity.position,
      reason: reason,
      timestamp: Date.now()
    }).catch(err => console.error('[RAG] Lỗi lưu sự kiện chết:', err))
  }
}

function onPlayerCollect(collector, collected) {
  try {
    if (!bot || collector.username !== bot.username) return
    if (!collected) return

    const owner = getOwnerEntity()
    if (!owner || !bot.entity) return
    if (owner.position.distanceTo(bot.entity.position) > 8) return

    const items = bot.inventory.items()
    const lastItem = items[items.length - 1]
    const itemName = lastItem ? lastItem.name : 'không rõ'

    if (itemName === 'wheat') return

    const bonus = memory.bonusAffectionForGift(itemName)
    moodEngine.addHappyOnGiftReceived()
    console.log(`🎁 Nhận được ${itemName} từ Vân Thiên, affection +${bonus}.`)

    // Lưu sự kiện nhận quà vào RAG
    if (rag) {
      rag.addDocument(`[SỰ KIỆN] Bot đã nhận được ${itemName} từ Vân Thiên, affection +${bonus}`, {
        type: 'gift_received',
        item: itemName,
        bonus: bonus,
        timestamp: Date.now()
      }).catch(err => console.error('[RAG] Lỗi lưu sự kiện nhận quà:', err))
    }
  } catch (e) {}
}

// ==================== SỰ KIỆN: CHAT & KIỂM TRA TRIGGER / SESSION ====================

function hasTriggerWord(message) {
  if (!message) return false
  const lowerMsg = cleanMinecraftText(message).toLowerCase()
  const triggers = (CONFIG.triggerWords || []).filter((w) => w && w.trim() !== '')

  for (const trigger of triggers) {
    const cleanTrigger = trigger.toLowerCase().trim()
    if (lowerMsg.includes(cleanTrigger)) {
      return true
    }
  }
  return false
}

async function onChat(username, message) {
  if (!bot) return

  const cleanUsername = cleanMinecraftText(username)
  const cleanMsg = cleanMinecraftText(message)

  if (!cleanMsg || cleanUsername === bot.username) return
  console.log(`💬 <${cleanUsername}> ${cleanMsg}`)

  const isOwner = CONFIG.ownerNames.includes(cleanUsername)
  chatLog.addMessage(cleanUsername, cleanMsg, isOwner)

  // Lưu tin nhắn vào RAG nếu là chủ hoặc tin nhắn dài
  if (rag && (isOwner || cleanMsg.length > 30)) {
    rag.addDocument(`${cleanUsername}: ${cleanMsg}`, {
      username: cleanUsername,
      timestamp: Date.now(),
      type: 'chat',
      isOwner: isOwner
    }).catch(err => console.error('[RAG] Lỗi lưu tin nhắn chat:', err))
  }

  const isTriggered = hasTriggerWord(cleanMsg)
  const isSessionActive = cleanUsername === currentSpeaker

  if (isTriggered || isSessionActive) {
    console.log(`🎯 Kích hoạt lượt đọc AI cho ${cleanUsername} (Triggered: ${isTriggered}, SessionActive: ${isSessionActive})`)
    if (isOwner) {
      memory.pushConversation('owner', cleanMsg)
      await runBrainTurn('chat', cleanMsg, cleanUsername)
    } else {
      await runBrainTurn('stranger_chat', cleanMsg, cleanUsername)
    }
  }
}

// ==================== GỌI BỘ NÃO VÀ THỰC THI KẾT QUẢ ====================
async function runBrainTurn(mode, userMessage, speakerUsername) {
  if (!bot) return
  if (brainCallInFlight) {
    console.log('⏭️ Đang có 1 lượt gọi bộ não khác chạy, bỏ qua lượt này.')
    return
  }
  brainCallInFlight = true

  try {
    const memorySummary = memory.summarize()
    const moodState = moodEngine.getMoodState()
    const workingFlags = workingMemory.getActiveFlags()
    const wheatCount = countWheatInInventory()
    const onlinePlayers = Object.keys(bot.players || {}).filter((name) => name !== bot.username)

    // Lấy RAG context từ Supabase
    let ragContext = ""
    if (rag && userMessage && (mode === 'chat' || mode === 'stranger_chat')) {
      try {
        const contexts = await rag.getContext(userMessage, 5)
        if (contexts && contexts.length > 0) {
          ragContext = contexts.join('\n')
          console.log(`📚 Đã lấy ${contexts.length} context từ RAG`)
        }
      } catch (err) {
        console.log('❌ Lỗi lấy RAG Context:', err.message)
      }
    }

    const deathMention = memory.consumeDeathMention()
    const promptParts = []
    if (ragContext) {
      promptParts.push(`[Thông tin liên quan từ trí nhớ dài hạn]:\n${ragContext}`)
    }
    if (deathMention) {
      promptParts.push(
        `(Ghi chú riêng cho lượt này: Ông Tư vừa hồi sinh sau khi chết vì "${deathMention}" — hãy than thở một chút về việc này rồi thôi, không nhắc lại các lần sau.)`
      )
    }

    if (mode === 'proactive') {
      promptParts.push('(Ông Tư đang chủ động bắt chuyện vì Vân Thiên đang ở trong vườn, Vân Thiên chưa nói gì cả.)')
    } else if (mode === 'stranger_chat') {
      promptParts.push(
        `(Có người lạ tên "${speakerUsername}" — không phải Vân Thiên — vừa nói chuyện với lão, không phải chủ vườn.)`
      )
      promptParts.push(`${speakerUsername} nói: "${userMessage}"`)
    } else {
      promptParts.push(`Vân Thiên vừa nói: "${userMessage}"`)
    }

    const userPrompt = promptParts.join('\n')
    const systemPrompt = persona.buildSystemPrompt(
      memorySummary,
      moodState,
      workingFlags,
      mode,
      wheatCount,
      chatLog.getRecentForPrompt(),
      onlinePlayers
    )

    const emotionalState = {
      affection: memorySummary.affection,
      mood_tired: Math.round(moodState.tired),
      mood_scared: Math.round(moodState.scared),
      mood_happy: Math.round(moodState.happy),
    }

    const memoryContext = {
      facts: memorySummary.facts,
      events: memorySummary.recent_events,
      recent_conversations: memorySummary.recent_conversations,
      working_memory_flags: workingFlags,
      chat_log: chatLog.getRecentForPrompt(),
    }

    const response = await brain.generate(systemPrompt, userPrompt, emotionalState, memoryContext, wheatCount)
    const isAddressingMe = response.is_addressing_me !== false

    if (isAddressingMe) {
      if (speakerUsername) {
        refreshSession(speakerUsername)
      }
      if (response.say) {
        say(response.say)
        memory.pushConversation('ong_tu', response.say)
        chatLog.addMessage('Ông Tư', response.say, false, 'bot')
      }
      if (mode !== 'stranger_chat') {
        if (response.remember) memory.rememberFromBrain(response.remember)
        if (response.affection_delta) memory.updateAffectionFromChat(response.affection_delta)
        if (mode === 'chat' && response.affection_delta > 0) moodEngine.addHappyOnPositiveChat()
      }
      
      // ✅ Đã cập nhật truyền tọa độ goto vào runAction
      await runAction(response.action, { 
        goto_x: response.goto_x, 
        goto_y: response.goto_y, 
        goto_z: response.goto_z 
      })
    } else {
      console.log(`🤖 LLM nhận diện ${speakerUsername || 'người chơi'} không hướng về bot. Tắt Session & Im lặng.`)
      clearSession()
      if (response.action) {
        // ✅ Đã cập nhật truyền tọa độ goto vào runAction
        await runAction(response.action, { 
          goto_x: response.goto_x, 
          goto_y: response.goto_y, 
          goto_z: response.goto_z 
        })
      }
    }
  } catch (e) {
    console.log('❌ Lỗi trong lượt gọi bộ não:', e.message)
  } finally {
    brainCallInFlight = false
  }
}

// ==================== THỰC THI ACTION (delegate sang actions/main.js) ====================

function runAction(action, extra = {}) {
  return dispatchAction(action, {
    bot, garden, moodEngine, memory, CONFIG, rag, say, getOwnerEntity, maybeAutoDeliverGift,
    ...extra,
  })
}

// ==================== TẶNG QUÀ TỰ ĐỘNG (kiểm tra ngưỡng, gọi qua actions/interaction.js) ====================

async function maybeAutoDeliverGift() {
  const wheatCount = countWheatInInventory()
  const m = memory.getMemory()
  const shouldGift =
    (m.wheatSinceLastGift || 0) >= CONFIG.gift.wheatThreshold || wheatCount >= CONFIG.gift.fullStackSize
  if (shouldGift) await runAction('deliver_gift')
}

// ==================== VÒNG LẶP CANH TÁC TỰ ĐỘNG ====================

function startFarmingCycle() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  farmingTickHandle = setInterval(async () => {
    if (!bot || !bot.entity) return
    if (bot.pathfinder && bot.pathfinder.isMoving && bot.pathfinder.isMoving()) return

    const dominant = moodEngine.getDominantMood()
    if (dominant.type === 'tired') {
      await runAction('rest')
      return
    }

    return runAction('wander')
  }, CONFIG.farming.tickIntervalMs)
}

// ==================== AFFECTION DECAY & WORKING MEMORY ====================

function startAffectionDecayLoop() {
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  affectionDecayHandle = setInterval(() => {
    memory.decayAffection()
  }, 60 * 60 * 1000)
}

function startWorkingMemorySweep() {
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  workingMemorySweepHandle = setInterval(() => {
    workingMemory.sweepExpired()
  }, 60 * 1000)
}

// ==================== THOÁT CHƯƠNG TRÌNH AN TOÀN ====================

process.on('uncaughtException', (err) => console.log('🆘 uncaughtException:', err?.message || err))
process.on('unhandledRejection', (reason) => console.log('🆘 unhandledRejection:', reason))
process.on('SIGINT', () => {
  shuttingDown = true
  console.log('\n👋 Ông Tư nghỉ tay, đang tắt...')
  stopAllLoops()
  clearSession()
  proactive.stop()
  moodEngine.stopEngine()
  if (bot) bot.end()
  process.exit(0)
})

console.log('🚀 Đang khởi động Ông Tư...')
firebaseModule.initFirebase()
connect()
