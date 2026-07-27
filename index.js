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

// HTTP server giả chỉ để giữ port mở cho Render (nếu deploy dạng Web Service).
// Không ảnh hưởng gì tới logic bot, chỉ để Render không báo "No open ports".
const http = require('http')
http
  .createServer((req, res) => res.end('Ông Tư đang làm việc trong vườn.'))
  .listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP giữ chỗ đang chạy ở port ${process.env.PORT || 3000} (chỉ để Render không cảnh báo port)`)
  })

/**
 * index.js
 * ------------------------------------------------------------
 * File chính: khởi tạo bot, đăng ký toàn bộ event, chạy farming
 * loop thật, mood engine, proactive loop, gift logic, và thực thi
 * tập action đầy đủ trả về từ bộ não (Colab).
 * ------------------------------------------------------------
 */

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

let bot = null
let reconnectAttempts = 0
let shuttingDown = false

let farmingTickHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false

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
  bot.on('blockUpdate', onBlockUpdate)
  bot.on('playerCollect', onPlayerCollect)
  bot.on('kicked', (reason) => console.log('👢 Bị kick khỏi server:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi bot:', err && err.message ? err.message : err))
  bot.on('end', onEnd)
}

async function onSpawn() {
  console.log('✅ Ông Tư đã vào vườn tại', bot.entity.position)
  reconnectAttempts = 0

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

  // Đã tắt lời chào tự động khi vào vườn — bỏ comment dòng dưới nếu muốn bật lại
  // say(`Ông Tư đã vào vườn rồi đây Vân Thiên ơi.`)
}

function onEnd(reason) {
  console.log('🔌 Mất kết nối:', reason || '')
  stopAllLoops()
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

// ==================== SỰ KIỆN: CHẾT ====================

function onDeath() {
  let reason = 'không rõ lý do'
  try {
    if (bot.lastDamageSource) reason = String(bot.lastDamageSource)
  } catch (e) {
    // bỏ qua, dùng giá trị mặc định
  }
  console.log(`☠️ Ông Tư vừa chết: ${reason}`)
  memory.recordDeath(reason)
}

// ==================== SỰ KIỆN: THEO DÕI PHÁ RUỘNG ====================
// Chỉ tính khi block đổi từ farmland/wheat sang air/dirt VÀ chủ đang đứng sát bên
// (tương tác trực tiếp), không tính nếu chủ chỉ đi ngang qua.

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
    if (distToOwner <= 5) {
      workingMemory.setFlag('ruong_bi_pha', 12 * 60 * 1000)
      console.log('🌾 Ghi nhận: Vân Thiên vừa phá ruộng gần vị trí của mình.')
    }
  } catch (e) {
    console.log('❌ Lỗi xử lý blockUpdate:', e.message)
  }
}

// ==================== SỰ KIỆN: CHỦ TẶNG ĐỒ ====================

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

    if (itemName === 'wheat') return // wheat tự thu hoạch không tính là quà

    const bonus = memory.bonusAffectionForGift(itemName)
    moodEngine.addHappyOnGiftReceived()
    console.log(`🎁 Nhận được ${itemName} từ Vân Thiên, affection +${bonus}.`)
  } catch (e) {
    // bỏ qua lỗi heuristic, không quan trọng
  }
}

// ==================== SỰ KIỆN: CHAT ====================

// Chỉ trả lời khi tin nhắn có gọi tên/nickname bot (vd "khoa", "ka") - áp dụng cho cả chủ lẫn người lạ
function hasTriggerWord(message) {
  const lower = (message || '').toLowerCase()
  return CONFIG.triggerWords.some((w) => lower.includes(w))
}

async function onChat(username, message) {
  if (!bot || username === bot.username) return
  console.log(`💬 <${username}> ${message}`)

  const isOwner = CONFIG.ownerNames.includes(username)
  chatLog.addMessage(username, message, isOwner) // general_chat ghi cho mọi người, boss_chat tự lọc chỉ owner

  if (!hasTriggerWord(message)) return // không gọi tên bot thì chỉ ghi log, không trả lời

  if (isOwner) {
    memory.pushConversation('owner', message)
    await runBrainTurn('chat', message)
  } else {
    // Người lạ cũng được trả lời, nhưng đi qua nhánh riêng (không đụng affection/facts của chủ)
    await runBrainTurn('stranger_chat', message, username)
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

    const deathMention = memory.consumeDeathMention()
    const promptParts = []
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
    // Affection/facts chỉ áp dụng cho chủ — người lạ chat không ảnh hưởng tới hệ tình cảm của Vân Thiên
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

// ==================== DISPATCHER: THỰC THI ACTION TỪ COLAB ====================

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
      default:
        console.log(`❓ Action không xác định: ${action}`)
        return doIdle()
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

// ==================== CÁC HÀNH ĐỘNG ĐƠN LẺ ====================

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
  } catch (e) {
    // không tới được thì bỏ qua, không quan trọng với wander
  }
}

async function doSit() {
  moodEngine.notifyRestOrIdle()
  try {
    bot.pathfinder.setGoal(null)
    bot.setControlState('sneak', true)
    setTimeout(() => {
      try {
        bot.setControlState('sneak', false)
      } catch (e) {}
    }, 4000)
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

function doWave() {
  try {
    bot.swingArm('right')
  } catch (e) {}
}

function doLookOwner() {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try {
    bot.lookAt(owner.position.offset(0, owner.height || 1.6, 0), true)
  } catch (e) {}
}

// "look" - Khoa nhìn về phía chủ (hoặc người gần nhất) nếu có, không thì thôi
function doLook() {
  return doLookOwner()
}

// "emote" - 1 cử chỉ ngắn (vung tay), thay cho "wave" cũ
function doEmote() {
  try {
    bot.swingArm('right')
  } catch (e) {}
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
  } catch (e) {
    // nếu không pathfind được thì thôi, ưu tiên không crash
  }
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

// ==================== CANH TÁC THẬT: TILL / PLANT / HARVEST ====================

async function doTill() {
  const hoe = bot.inventory.items().find((i) => /_hoe$/.test(i.name))
  if (!hoe) {
    console.log('🌱 Không có cuốc trong túi đồ, bỏ qua till.')
    return
  }

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
  if (!seeds) {
    console.log('🌱 Không có hạt giống trong túi đồ, bỏ qua plant.')
    return
  }

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
  if (wheatCount <= 0) {
    console.log('🎁 Không có lúa mì để tặng.')
    return
  }

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

    if (milestone) {
      say(`Ấy chà, vậy là ta đã tặng Vân Thiên tròn ${milestone} bó lúa mì rồi đó, con nhớ giữ sức khoẻ mà làm ăn nghen.`)
    }
  } catch (e) {
    console.log('❌ Lỗi khi tặng quà:', e.message)
  }
}

// ==================== VÒNG LẶP CANH TÁC TỰ ĐỘNG (không cần Colab) ====================

// Chỉ đi lung tung trong khu vực đã nhốt (garden bounds) - không tự đào/cày/trồng gì cả,
// tránh phá hoại vì Khoa đang bị nhốt trong 1 khu vực kín.
function startFarmingLoop() {
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

// ==================== AFFECTION: GIẢM DẦN THEO GIỜ ====================

function startAffectionDecayLoop() {
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  affectionDecayHandle = setInterval(() => {
    memory.decayAffection()
  }, 60 * 60 * 1000) // mỗi giờ
}

// ==================== WORKING MEMORY: DỌN DẸP ĐỊNH KỲ ====================

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
  proactive.stop()
  moodEngine.stopEngine()
  if (bot) bot.end()
  process.exit(0)
})

console.log('🚀 Đang khởi động Ông Tư...')
firebaseModule.initFirebase()
connect()
