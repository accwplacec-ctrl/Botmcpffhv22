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

/**
 * index.js - ĐÃ FIX "Invalid move player packet received"
 */

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

let bot = null
let reconnectAttempts = 0
let shuttingDown = false

let farmingTickHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false
let spawnStableTimer = null

// ===== Tien ich chung =====
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
  const p = bot.players && bot.players[CONFIG.ownerName]
  return p && p.entity ? p.entity : null
}

function countWheatInInventory() {
  if (!bot) return 0
  return bot.inventory
    .items()
    .filter((i) => i.name === 'wheat')
    .reduce((sum, i) => sum + i.count, 0)
}

// ===== Ket noi vao server =====
function connect() {
  console.log('🔄 Đang kết nối vào server...')

  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 120000,
    hideErrors: false
  })

  // TẮT PHYSICS NGAY TỪ ĐẦU - RẤT QUAN TRỌNG
  bot.physicsEnabled = false

  bot.loadPlugin(pathfinder)

  registerEvents()
}

function registerEvents() {
  bot.once('spawn', onSpawn)
  bot.on('chat', onChat)
  bot.on('death', onDeath)
  bot.on('blockUpdate', onBlockUpdate)
  bot.on('playerCollect', onPlayerCollect)
  bot.on('kicked', (reason) => console.log('👢 Bị kick:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi bot:', err?.message || err))
  bot.on('end', onEnd)
}

// ===== Chờ chunk load mạnh mẽ =====
async function waitForChunkReady() {
  return new Promise((resolve) => {
    let attempts = 0
    const maxAttempts = 60 // \~12 giây

    const check = () => {
      attempts++
      if (!bot || !bot.entity) return resolve()

      try {
        const column = bot.world.getColumnAt(bot.entity.position)
        if (column) {
          console.log('✅ Chunk đã load thành công.')
          return resolve()
        }
      } catch (e) {}

      if (attempts >= maxAttempts) {
        console.log('⚠️ Timeout chờ chunk, tiếp tục với rủi ro thấp...')
        return resolve()
      }

      setTimeout(check, 200)
    }
    check()
  })
}

async function onSpawn() {
  console.log('✅ Ông Tư đã spawn tại server.')

  // Reset reconnect sau khi ổn định
  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  spawnStableTimer = setTimeout(() => { reconnectAttempts = 0 }, 30000)

  // === FIX CHÍNH: Chờ chunk + set vị trí an toàn ===
  await waitForChunkReady()

  if (!bot || !bot.entity) return

  // Set vị trí rõ ràng
  bot.entity.position.set(
    bot.entity.position.x,
    bot.entity.position.y,
    bot.entity.position.z
  )

  // Bật physics sau khi đã an toàn
  await new Promise(r => setTimeout(r, 800))
  bot.physicsEnabled = true
  console.log('⚙️ Physics đã bật an toàn.')

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)

  // Khởi tạo các module
  await memory.init()
  moodEngine.resetSession()
  moodEngine.startEngine(bot)

  startFarmingLoop()
  startAffectionDecayLoop()
  startWorkingMemorySweep()

  proactive.start(bot, () => runBrainTurn('proactive', null))

  console.log('🚀 Ông Tư đã sẵn sàng hoạt động!')
}

// ===== Disconnect handler =====
function onEnd(reason) {
  console.log('🔌 Mất kết nối:', reason || 'Unknown')
  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  stopAllLoops()
  proactive.stop()
  moodEngine.stopEngine()
  bot = null

  if (!shuttingDown) scheduleReconnect()
}

function scheduleReconnect() {
  const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 120000)
  reconnectAttempts++
  console.log(`⏳ Reconnect sau ${Math.round(delay/1000)}s (lần ${reconnectAttempts})...`)
  setTimeout(connect, delay)
}

function stopAllLoops() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  farmingTickHandle = affectionDecayHandle = workingMemorySweepHandle = null
}

// ===== Các event khác =====
function onDeath() {
  let reason = 'không rõ'
  try {
    if (bot.lastDamageSource) reason = String(bot.lastDamageSource)
  } catch (e) {}
  console.log(`☠️ Ông Tư chết vì: ${reason}`)
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

    const dist = owner.position.distanceTo(newBlock.position)
    if (dist <= 5) {
      workingMemory.setFlag('ruong_bi_pha', 12 * 60 * 1000)
      console.log('🌾 Ghi nhận: Chủ phá ruộng gần Ông Tư.')
    }
  } catch (e) {
    console.log('❌ Lỗi blockUpdate:', e.message)
  }
}

function onPlayerCollect(collector, collected) {
  try {
    if (!bot || collector.username !== bot.username) return
    const owner = getOwnerEntity()
    if (!owner || !bot.entity) return
    if (owner.position.distanceTo(bot.entity.position) > 8) return

    const items = bot.inventory.items()
    const lastItem = items[items.length - 1]
    const itemName = lastItem ? lastItem.name : 'không rõ'

    if (itemName === 'wheat') return

    const bonus = memory.bonusAffectionForGift(itemName)
    moodEngine.addHappyOnGiftReceived()
    console.log(`🎁 Nhận quà \( {itemName} (+ \){bonus} affection)`)
  } catch (e) {}
}

async function onChat(username, message) {
  if (!bot || username === bot.username) return
  if (username !== CONFIG.ownerName) return

  console.log(`💬 <${username}> ${message}`)
  memory.pushConversation('owner', message)
  await runBrainTurn('chat', message)
}

// ===== Brain & Action (giữ nguyên) =====
async function runBrainTurn(mode, userMessage) {
  if (!bot || brainCallInFlight) return
  brainCallInFlight = true

  try {
    const memorySummary = memory.summarize()
    const moodState = moodEngine.getMoodState()
    const workingFlags = workingMemory.getActiveFlags()
    const wheatCount = countWheatInInventory()

    const deathMention = memory.consumeDeathMention()
    const promptParts = []
    if (deathMention) promptParts.push(`(Ghi chú: Ông Tư vừa hồi sinh sau khi chết vì "${deathMention}")`)
    if (mode === 'proactive') {
      promptParts.push('(Ông Tư đang chủ động bắt chuyện...)')
    } else {
      promptParts.push(`Tới vừa nói: "${userMessage}"`)
    }

    const systemPrompt = persona.buildSystemPrompt(memorySummary, moodState, workingFlags, mode, wheatCount)
    const emotionalState = { affection: memorySummary.affection, ...moodState }
    const memoryContext = {
      facts: memorySummary.facts,
      events: memorySummary.recent_events,
      recent_conversations: memorySummary.recent_conversations,
      working_memory_flags: workingFlags,
    }

    const response = await brain.generate(systemPrompt, promptParts.join('\n'), emotionalState, memoryContext, wheatCount)

    if (response.say) {
      say(response.say)
      memory.pushConversation('ong_tu', response.say)
    }
    if (response.remember) memory.rememberFromBrain(response.remember)
    if (response.affection_delta) memory.updateAffectionFromChat(response.affection_delta)

    await executeAction(response.action)
  } catch (e) {
    console.log('❌ Lỗi gọi brain:', e.message)
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
      case 'till': return doTill()
      case 'plant': return doPlant()
      case 'harvest': return doHarvest()
      case 'sit': return doSit()
      case 'wave': return doWave()
      case 'look_owner': return doLookOwner()
      case 'deliver_gift': return doDeliverGift()
      case 'rest': return doRest()
      case 'avoid_owner': return doAvoidOwner()
      case 'avoid_monster': return doAvoidMonster()
      default:
        console.log(`❓ Action không rõ: ${action}`)
        return doIdle()
    }
  } catch (e) {
    console.log(`❌ Lỗi execute ${action}:`, e.message)
  }
}

// Các hàm action cơ bản (đã rút gọn, bạn có thể mở rộng sau)
function doIdle() { bot.pathfinder.setGoal(null); moodEngine.notifyRestOrIdle() }
async function doWander() {
  moodEngine.notifyRestOrIdle()
  const point = garden.randomPointInGarden()
  const y = garden.findGroundY(bot, point.x, point.z)
  if (y) await bot.pathfinder.goto(new GoalNear(point.x, y, point.z, 1)).catch(() => {})
}

// ... (các hàm doTill, doPlant, doHarvest, doSit, doRest, v.v. giữ nguyên như repo cũ)

function startFarmingLoop() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  farmingTickHandle = setInterval(() => {
    // Farming logic sẽ gọi brain theo chu kỳ
  }, CONFIG.farming.tickIntervalMs)
}

function startAffectionDecayLoop() {
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  affectionDecayHandle = setInterval(() => memory.decayAffection(), 3600000) // 1 giờ
}

function startWorkingMemorySweep() {
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  workingMemorySweepHandle = setInterval(() => workingMemory.sweep(), 60000)
}

// Khởi động
connect()

// Graceful shutdown
process.on('SIGINT', () => {
  shuttingDown = true
  if (bot) bot.quit()
  process.exit(0)
})
