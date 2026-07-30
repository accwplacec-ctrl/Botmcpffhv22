'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const { Vec3 } = require('vec3')

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

// --- TÍCH HỢP RAG ---
const MemoryRAG = require('./memoryRAG')

// ==================== HTTP SERVER GIỮ PORT CHO RENDER ====================
const http = require('http')
http
  .createServer((req, res) => res.end('Ông Tư đang làm việc trong vườn.'))
  .listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP giữ chỗ đang chạy ở port ${process.env.PORT || 3000}`)
  })

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

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

      await executeAction(response.action)
    } else {
      console.log(`🤖 LLM nhận diện ${speakerUsername || 'người chơi'} không hướng về bot. Tắt Session & Im lặng.`)
      clearSession()
      if (response.action) {
        await executeAction(response.action)
      }
    }
  } catch (e) {
    console.log('❌ Lỗi trong lượt gọi bộ não:', e.message)
  } finally {
    brainCallInFlight = false
  }
}

// ==================== DISPATCHER: THỰC THI ACTION TỪ AI ====================

async function executeAction(action) {
  if (!bot) return
  try {
    switch (action) {
      case 'idle':
        return doIdle()
      case 'wander':
        return doWander()
      case 'look':
        return doLook()
      case 'emote':
        return doEmote()
      case 'rest':
        return doRest()
      case 'till':
        return doTill()
      case 'plant':
        return doPlant()
      case 'harvest':
        return doHarvest()
      case 'deliver_gift':
        return doDeliverGift()
      default:
        console.log(`❓ Action không xác định: ${action}`)
        return doIdle()
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

// ==================== CÁC HÀNH ĐỘNG DI CHUYỂN & NGHỈ NGƠI ====================

function doIdle() {
  try {
    bot.pathfinder.setGoal(null)
  } catch (e) {}
  moodEngine.notifyRestOrIdle()
}

async function doWander() {
  moodEngine.notifyRestOrIdle()
  const point = garden.randomPointInGarden()
  const groundY = garden.findGroundY(bot, point.x, point.z)
  if (groundY === null) return
  try {
    await bot.pathfinder.goto(new GoalNear(point.x, groundY, point.z, 1))
  } catch (e) {}
}

async function doRest() {
  moodEngine.notifyRestOrIdle()
  try {
    bot.pathfinder.setGoal(null)
    bot.setControlState('sneak', true)
    setTimeout(() => {
      try {
        bot.setControlState('sneak', false)
      } catch (e) {}
    }, 8000)
  } catch (e) {}
}

function doLookOwner() {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try {
    bot.lookAt(owner.position.offset(0, owner.height || 1.6, 0), true)
  } catch (e) {}
}

function doLook() {
  return doLookOwner()
}

function doEmote() {
  try {
    bot.swingArm('right')
  } catch (e) {}
}

// ==================== CANH TÁC THẬT: TILL / PLANT / HARVEST ====================

async function doTill() {
  const hoe = bot.inventory.items().find((i) => /_hoe$/.test(i.name))
  if (!hoe) return

  const grassBlock = bot.findBlock({
    matching: (block) => block.name === 'grass_block' && garden.isInGarden(block.position),
    maxDistance: 32,
  })
  if (!grassBlock) return

  try {
    await bot.pathfinder.goto(new GoalNear(grassBlock.position.x, grassBlock.position.y, grassBlock.position.z, 2))
    await bot.equip(hoe, 'hand')
    await bot.activateBlock(grassBlock)
    moodEngine.notifyFarmAction()
  } catch (e) {
    console.log('❌ Lỗi khi cày đất:', e.message)
  }
}

async function doPlant() {
  const seeds = bot.inventory.items().find((i) => i.name === 'wheat_seeds')
  if (!seeds) return

  const farmland = bot.findBlock({
    matching: (block) => block.name === 'farmland' && garden.isInGarden(block.position),
    maxDistance: 32,
    point: bot.entity.position,
    useExtraInfo: (block) => {
      const above = bot.blockAt(block.position.offset(0, 1, 0))
      return above && above.name === 'air'
    },
  })
  if (!farmland) return

  try {
    await bot.pathfinder.goto(new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2))
    await bot.equip(seeds, 'hand')
    await bot.placeBlock(farmland, new Vec3(0, 1, 0))
    moodEngine.notifyFarmAction()
  } catch (e) {
    console.log('❌ Lỗi khi trồng hạt giống:', e.message)
  }
}

async function doHarvest() {
  const mcData = require('minecraft-data')(bot.version)
  const wheatInfo = mcData.blocksByName.wheat
  if (!wheatInfo) return

  const ripe = bot.findBlock({
    matching: (block) => block.name === 'wheat' && block.metadata === 7 && garden.isInGarden(block.position),
    maxDistance: 32,
  })
  if (!ripe) return

  try {
    await bot.pathfinder.goto(new GoalNear(ripe.position.x, ripe.position.y, ripe.position.z, 2))
    await bot.dig(ripe)
    moodEngine.notifyFarmAction()
    moodEngine.addHappyOnHarvest()
    memory.addWheatSinceLastGift(1)
    await maybeAutoDeliverGift()
  } catch (e) {
    console.log('❌ Lỗi khi thu hoạch:', e.message)
  }
}

// ==================== TẶNG QUÀ TỰ ĐỘNG ====================

async function maybeAutoDeliverGift() {
  const wheatCount = countWheatInInventory()
  const m = memory.getMemory()
  const shouldGift =
    (m.wheatSinceLastGift || 0) >= CONFIG.gift.wheatThreshold || wheatCount >= CONFIG.gift.fullStackSize
  if (shouldGift) await doDeliverGift()
}

async function doDeliverGift() {
  const wheatCount = countWheatInInventory()
  if (wheatCount <= 0) return

  const dropPoint = CONFIG.giftDropPoint
  try {
    await bot.pathfinder.goto(new GoalNear(dropPoint.x, dropPoint.y, dropPoint.z, 2))
    const wheatItem = bot.inventory.items().find((i) => i.name === 'wheat')
    if (!wheatItem) return
    const total = bot.inventory
      .items()
      .filter((i) => i.name === 'wheat')
      .reduce((sum, i) => sum + i.count, 0)

    await bot.toss(wheatItem.type, null, total)
    const milestone = memory.addWheatGifted(total)
    say(`Ta để dành được ${total} bó lúa mì, mang ra đây tặng Vân Thiên đó.`)

    // Lưu sự kiện tặng lúa vào RAG
    if (rag) {
      rag.addDocument(`[SỰ KIỆN] Bot đã tặng ${total} lúa mì cho Vân Thiên`, {
        type: 'deliver_gift',
        count: total,
        milestone: milestone || null,
        timestamp: Date.now()
      }).catch(err => console.error('[RAG] Lỗi lưu sự kiện tặng lúa:', err))
    }

    if (milestone) {
      say(`Ấy chà, vậy là ta đã tặng Vân Thiên tròn ${milestone} bó lúa mì rồi đó, con nhớ giữ sức khoẻ mà làm ăn nghen.`)
    }
  } catch (e) {
    console.log('❌ Lỗi khi tặng quà:', e.message)
  }
}

// ==================== VÒNG LẶP CANH TÁC TỰ ĐỘNG ====================

function startFarmingCycle() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  farmingTickHandle = setInterval(async () => {
    if (!bot || !bot.entity) return

    const dominant = moodEngine.getDominantMood()
    if (dominant.type === 'tired') {
      await doRest()
      return
    }

    return doWander()
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
