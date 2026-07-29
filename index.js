'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const { Vec3 } = require('vec3')

const http = require('http')

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

// ==================== HTTP SERVER GIỮ PORT TRÊN RENDER ====================
http
  .createServer((req, res) => res.end('Ông Tư đang làm việc trong vườn.'))
  .listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP giữ chỗ đang chạy ở port ${process.env.PORT || 3000}`)
  })

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

// ==================== KHAI BÁO BIẾN TOÀN CỤC ====================
let bot = null
let reconnectAttempts = 0
let shuttingDown = false
let handshakeTimer = null

let farmingTimeoutHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false

// cấu hình SOCKS5 Proxy Wispbyte
const PROXY = {
  host: '78.154.103.34',
  port: 14589,
  type: 5,
  userId: 'admin',
  password: 'strongpassword123'   // ← phải giống hệt bên proxy
}
// ==================== TIỆN ÍCH CHUNG ====================

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
  if (!bot || !bot.inventory) return 0
  return bot.inventory
    .items()
    .filter((i) => i.name === 'wheat')
    .reduce((sum, i) => sum + i.count, 0)
}

// ==================== KẾT NỐI VÀO SERVER MINECRAFT ====================

function connect() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }

  console.log(`🔄 Kết nối lần ${reconnectAttempts + 1}... (qua TCP Proxy 78.154.103.34:14589)`)

  bot = mineflayer.createBot({
    host: '78.154.103.34',     // IP Wispbyte
    port: 14589,               // Port proxy
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth || 'offline',
    checkTimeoutInterval: 60000,
    keepAlive: true,
  })

  bot.loadPlugin(pathfinder)
  registerEvents()

  // Timeout 60 giây cho handshake
  handshakeTimer = setTimeout(() => {
    console.log('⚠️ [Handshake Timeout] Quá 60s không nhận phản hồi từ Server. Hủy...')
    try {
      if (bot) bot.end()
    } catch (e) {}
    scheduleReconnect()
  }, 60000)
}

function registerEvents() {
  bot.once('spawn', onSpawn)
  bot.on('chat', onChat)
  bot.on('death', onDeath)
  bot.on('blockUpdate', onBlockUpdate)
  bot.on('playerCollect', onPlayerCollect)

  bot.on('message', (jsonMsg) => {
    try {
      const rawText = jsonMsg.toString().trim()
      if (!rawText) return
      console.log('📩 [Server Message]:', rawText)

      if (/^\/login|đăng nhập|dang nhap|login <password>/i.test(rawText)) {
        console.log('🔑 Phát hiện server yêu cầu đăng nhập...')
        if (CONFIG.server.password) {
          bot.chat(`/login ${CONFIG.server.password}`)
        }
      } else if (/^\/register|đăng ký|dang ky|register <password>/i.test(rawText)) {
        console.log('🔑 Phát hiện server yêu cầu đăng ký...')
        if (CONFIG.server.password) {
          bot.chat(`/register ${CONFIG.server.password} ${CONFIG.server.password}`)
        }
      }
    } catch (e) {
      console.log('❌ Lỗi xử lý message:', e.message)
    }
  })

  bot.on('kicked', (reason) => {
    console.log('👢 Bị kick khỏi server:', typeof reason === 'object' ? JSON.stringify(reason) : reason)
  })
  bot.on('error', (err) => console.log('❌ Lỗi Mineflayer bot:', err && err.message ? err.message : err))
  bot.on('end', onEnd)
}

async function onSpawn() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }

  console.log('✅ Ông Tư đã vào vườn tại vị trí:', bot.entity.position)
  reconnectAttempts = 0

  stopAllLoops()
  proactive.stop()

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  bot.pathfinder.setMovements(movements)

  await memory.init()
  moodEngine.resetSession()
  moodEngine.startEngine(bot)

  startFarmingLoop()
  startAffectionDecayLoop()
  startWorkingMemorySweep()

  proactive.start(bot, () => runBrainTurn('proactive', null))
}

function onEnd(reason) {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }
  console.log('🔌 Mất kết nối server:', reason || '')
  stopAllLoops()
  proactive.stop()
  moodEngine.stopEngine()
  bot = null
  if (!shuttingDown) scheduleReconnect()
}

function scheduleReconnect() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }
  const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 120000)
  reconnectAttempts++
  console.log(`⏳ Thử kết nối lại sau ${Math.round(delay / 1000)}s (lần ${reconnectAttempts})...`)
  setTimeout(connect, delay)
}

function stopAllLoops() {
  if (farmingTimeoutHandle) clearTimeout(farmingTimeoutHandle)
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  farmingTimeoutHandle = null
  affectionDecayHandle = null
  workingMemorySweepHandle = null
}

// ==================== SỰ KIỆN KHÁC ====================

function onDeath() {
  let reason = 'không rõ lý do'
  try {
    if (bot.lastDamageSource) reason = String(bot.lastDamageSource)
  } catch (e) {}
  console.log(`☠️ Ông Tư vừa chết: ${reason}`)
  memory.recordDeath(reason)
}

function onBlockUpdate(oldBlock, newBlock) {
  try {
    if (!oldBlock || !newBlock) return
    const wasFarmish = oldBlock.name === 'farmland' || oldBlock.name === 'wheat'
    const becameEmpty = newBlock.name === 'air' || newBlock.name === 'dirt'
    if (!wasFarmish || !becameEmpty) return
    if (!garden.isInGarden(newBlock.position)) return

    const owner = getOwnerEntity()
    if (!owner) return

    const distToOwner = owner.position.distanceTo(newBlock.position)
    if (distToOwner <= 6) {
      workingMemory.setFlag('ruong_bi_pha', 12 * 60 * 1000)
      console.log('🌾 Ghi nhận: Vân Thiên vừa phá ruộng gần vị trí của mình.')
    }
  } catch (e) {
    console.log('❌ Lỗi xử lý blockUpdate:', e.message)
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
  } catch (e) {}
}

function hasTriggerWord(message) {
  const lower = (message || '').toLowerCase()
  return CONFIG.triggerWords.some((w) => lower.includes(w))
}

async function onChat(username, message) {
  if (!bot || username === bot.username) return
  console.log(`💬 <${username}> ${message}`)

  const isOwner = CONFIG.ownerNames.includes(username)
  chatLog.addMessage(username, message, isOwner)

  if (!hasTriggerWord(message)) return

  if (isOwner) {
    memory.pushConversation('owner', message)
    await runBrainTurn('chat', message)
  } else {
    await runBrainTurn('stranger_chat', message, username)
  }
}

// ==================== BỘ NÃO VÀ THỰC THI ACTION ====================

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

    const deathMention = memory.consumeDeathMention()
    const promptParts = []
    if (deathMention) {
      promptParts.push(
        `(Ghi chú riêng cho lượt này: Ông Tư vừa hồi sinh sau khi chết vì "${deathMention}" — hãy than thở một chút về việc này rồi thôi.)`
      )
    }
    if (mode === 'proactive') {
      promptParts.push('(Ông Tư đang chủ động bắt chuyện vì Vân Thiên đang ở trong vườn.)')
    } else if (mode === 'stranger_chat') {
      promptParts.push(
        `(Có người lạ tên "${speakerUsername}" — không phải Vân Thiên — vừa nói chuyện với lão.)`
      )
      promptParts.push(`${speakerUsername} nói: "${userMessage}"`)
    } else {
      promptParts.push(`Vân Thiên vừa nói: "${userMessage}"`)
    }
    const userPrompt = promptParts.join('\n')

    const systemPrompt = persona.buildSystemPrompt(memorySummary, moodState, workingFlags, mode, wheatCount)

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
  } catch (e) {
    console.log('❌ Lỗi trong lượt gọi bộ não:', e.message)
  } finally {
    brainCallInFlight = false
  }
}

async function executeAction(action) {
  if (!bot) return
  try {
    switch (action) {
      case 'idle': return doIdle()
      case 'wander': return doWander()
      case 'look': return doLook()
      case 'emote': return doEmote()
      case 'rest': return doRest()
      case 'sit': return doSit()
      case 'till': return doTill()
      case 'plant': return doPlant()
      case 'harvest': return doHarvest()
      case 'avoid_owner': return doAvoidOwner()
      case 'avoid_monster': return doAvoidMonster()
      default: return doIdle()
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

// ==================== CÁC HÀNH ĐỘNG CỤ THỂ ====================

function doIdle() {
  try { bot.pathfinder.setGoal(null) } catch (e) {}
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

async function doSit() {
  moodEngine.notifyRestOrIdle()
  try {
    bot.pathfinder.setGoal(null)
    bot.setControlState('sneak', true)
    setTimeout(() => { try { bot.setControlState('sneak', false) } catch (e) {} }, 4000)
  } catch (e) {}
}

async function doRest() {
  moodEngine.notifyRestOrIdle()
  try {
    bot.pathfinder.setGoal(null)
    bot.setControlState('sneak', true)
    setTimeout(() => { try { bot.setControlState('sneak', false) } catch (e) {} }, 8000)
  } catch (e) {}
}

function doLookOwner() {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try { bot.lookAt(owner.position.offset(0, owner.height || 1.6, 0), true) } catch (e) {}
}

function doLook() { return doLookOwner() }

function doEmote() {
  try { bot.swingArm('right') } catch (e) {}
}

async function doAvoidOwner() {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try {
    const away = bot.entity.position.plus(bot.entity.position.minus(owner.position).normalize())
    bot.lookAt(away, true)
  } catch (e) {}
}

async function doAvoidMonster() {
  moodEngine.notifyRestOrIdle()
  const nearest = findNearestHostile()
  if (!nearest || !bot.entity) return

  try {
    const away = bot.entity.position.minus(nearest.position).normalize().scale(4)
    const target = garden.clampToGarden(bot.entity.position.plus(away))
    const groundY = garden.findGroundY(bot, target.x, target.z)
    const y = groundY === null ? target.y : groundY
    await bot.pathfinder.goto(new GoalNear(target.x, y, target.z, 1))
  } catch (e) {}
}

function findNearestHostile() {
  if (!bot || !bot.entity) return null
  let nearest = null
  let nearestDist = Infinity
  for (const e of Object.values(bot.entities || {})) {
    if (!e || !e.position) continue
    const isHostile =
      e.kind === 'Hostile mobs' ||
      e.type === 'hostile' ||
      /zombie|skeleton|creeper|spider|enderman|witch|drowned|husk|phantom/.test((e.name || '').toLowerCase())
    if (!isHostile) continue
    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = e
    }
  }
  return nearest
}

// ==================== LÀM NÔNG & TẶNG QUÀ ====================

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
  } catch (e) {}
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
  } catch (e) {}
}

async function doHarvest() {
  const mcData = require('minecraft-data')(bot.version)
  if (!mcData.blocksByName.wheat) return

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
  } catch (e) {}
}

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

    const wheatItems = bot.inventory.items().filter((i) => i.name === 'wheat')
    for (const item of wheatItems) {
      await bot.tossStack(item)
    }

    const milestone = memory.addWheatGifted(wheatCount)
    say(`Ta để dành được ${wheatCount} bó lúa mì, mang ra đây tặng Vân Thiên đó.`)

    if (milestone) {
      say(`Ấy chà, vậy là ta đã tặng Vân Thiên tròn ${milestone} bó lúa mì rồi đó, con nhớ giữ sức khoẻ nghen.`)
    }
  } catch (e) {}
}

// ==================== LOOPS TỰ ĐỘNG ====================

function startFarmingLoop() {
  if (farmingTimeoutHandle) clearTimeout(farmingTimeoutHandle)

  const tick = async () => {
    if (!bot || !bot.entity) return

    try {
      const dominant = moodEngine.getDominantMood()
      if (dominant.type === 'tired') {
        await doRest()
      } else {
        await doWander()
      }
    } catch (e) {
      console.log('❌ Lỗi farming loop:', e.message)
    } finally {
      if (bot) {
        farmingTimeoutHandle = setTimeout(tick, CONFIG.farming.tickIntervalMs)
      }
    }
  }

  farmingTimeoutHandle = setTimeout(tick, CONFIG.farming.tickIntervalMs)
}

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

// ==================== KHỞI ĐỘNG CHƯƠNG TRÌNH ====================

process.on('uncaughtException', (err) => console.log('🆘 uncaughtException:', err?.message || err))
process.on('unhandledRejection', (reason) => console.log('🆘 unhandledRejection:', reason))
process.on('SIGINT', () => {
  shuttingDown = true
  console.log('\n👋 Khoa nghỉ tay, đang tắt...')
  stopAllLoops()
  proactive.stop()
  moodEngine.stopEngine()
  if (bot) bot.end()
  process.exit(0)
})

console.log('🚀 Đang khởi động Ông Tư Minecraft Bot...')
firebaseModule.initFirebase()
connect()
