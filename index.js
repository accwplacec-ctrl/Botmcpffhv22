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

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

let bot = null
let reconnectAttempts = 0
let shuttingDown = false

let farmingTickHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false
let spawnStableTimer = null

// Utils
function say(message) {
  if (!bot || !message) return
  try { bot.chat(String(message).slice(0, 250)) } catch (e) {}
}

function getOwnerEntity() {
  if (!bot) return null
  const p = bot.players?.[CONFIG.ownerName]
  return p?.entity || null
}

function countWheatInInventory() {
  if (!bot) return 0
  return bot.inventory.items().filter(i => i.name === 'wheat').reduce((a, b) => a + b.count, 0)
}

// Connect
function connect() {
  console.log(`🔄 Kết nối lần ${reconnectAttempts + 1}...`)
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 90000,
    keepAlive: true,
    hideErrors: false
  })

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
  bot.on('kicked', reason => console.log('👢 Kicked:', reason))
  bot.on('error', err => console.log('❌ Error:', err?.message || err))
  bot.on('end', onEnd)
}

// Fix mạnh cho spawn
async function waitForChunkReady() {
  return new Promise(resolve => {
    let attempts = 0
    const timer = setInterval(() => {
      attempts++
      if (!bot?.entity) {
        clearInterval(timer)
        return resolve()
      }
      try {
        if (bot.world.getColumnAt(bot.entity.position)) {
          clearInterval(timer)
          console.log('✅ Chunk loaded')
          resolve()
        }
      } catch {}
      if (attempts > 100) {
        clearInterval(timer)
        resolve()
      }
    }, 150)
  })
}

async function onSpawn() {
  console.log('✅ Spawn tại', bot.entity.position)

  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  spawnStableTimer = setTimeout(() => reconnectAttempts = 0, 45000)

  await waitForChunkReady()

  if (!bot?.entity) return

  // Fix packet
  const pos = bot.entity.position
  bot.entity.position.set(pos.x, pos.y + 0.1, pos.z)
  bot.entity.yaw = 0
  bot.entity.pitch = 0

  await new Promise(r => setTimeout(r, 2000)) // Delay dài hơn
  bot.physicsEnabled = true
  console.log('✅ Physics bật an toàn')

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
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
  console.log('🔌 Disconnected:', reason)
  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  stopAllLoops()
  proactive.stop()
  moodEngine.stopEngine()
  bot = null
  if (!shuttingDown) {
    const delay = Math.min(8000 * Math.pow(1.5, reconnectAttempts), 150000)
    reconnectAttempts++
    setTimeout(connect, delay)
  }
}

function stopAllLoops() {
  [farmingTickHandle, affectionDecayHandle, workingMemorySweepHandle].forEach(h => h && clearInterval(h))
}

// Events
function onDeath() {
  memory.recordDeath('unknown')
}

function onBlockUpdate(oldBlock, newBlock) { /* giữ nguyên như trước */ }
function onPlayerCollect(collector, collected) { /* giữ nguyên */ }

async function onChat(username, message) {
  if (username !== CONFIG.ownerName || !bot) return
  memory.pushConversation('owner', message)
  await runBrainTurn('chat', message)
}

// Brain & Action (đơn giản hóa tạm thời để test)
async function runBrainTurn(mode, userMessage) {
  if (brainCallInFlight || !bot) return
  brainCallInFlight = true
  try {
    say("Chào Tới, ông đang ở đây nè.")
    await new Promise(r => setTimeout(r, 1000))
  } catch (e) {}
  finally { brainCallInFlight = false }
}

async function executeAction(action) {
  if (action === 'idle' || !action) doIdle()
}

function doIdle() {
  if (bot) bot.pathfinder.setGoal(null)
}

// Loops
function startFarmingLoop() {
  farmingTickHandle = setInterval(() => {}, CONFIG.farming.tickIntervalMs || 10000)
}
function startAffectionDecayLoop() {
  affectionDecayHandle = setInterval(() => {}, 3600000)
}
function startWorkingMemorySweep() {
  workingMemorySweepHandle = setInterval(() => {}, 60000)
}

// Start
connect()

process.on('SIGINT', () => {
  shuttingDown = true
  if (bot) bot.quit()
  process.exit(0)
})
