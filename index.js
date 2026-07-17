'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

const { CONFIG, validateConfig } = require('./config')
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

// ==================== UTILS ====================
function say(msg) {
  if (bot) bot.chat(String(msg).slice(0, 200))
}

function getOwner() {
  if (!bot) return null
  return bot.players?.[CONFIG.ownerName]?.entity || null
}

// ==================== CONNECT ====================
function connect() {
  console.log(`🔄 Kết nối lần ${reconnectAttempts + 1}...`)
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 120000,
    keepAlive: true
  })

  bot.physicsEnabled = false
  bot.loadPlugin(pathfinder)

  bot.once('spawn', onSpawn)
  bot.on('kicked', r => console.log('👢 Kicked:', r))
  bot.on('error', e => console.log('❌ Error:', e.message))
  bot.on('end', onEnd)
}

async function onSpawn() {
  console.log('✅ Spawn tại', bot.entity.position)

  // CHỜ DÀI + TẮT PHYSICS
  await new Promise(r => setTimeout(r, 3000))

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)

  // KHÔNG bật physics ngay
  // bot.physicsEnabled = true;  // Tạm comment

  await memory.init()
  moodEngine.resetSession()
  moodEngine.startEngine(bot)

  say("Ông Tư đã vào vườn rồi đây Tới ơi.")

  // Test nhẹ
  setTimeout(() => {
    if (bot) say("Hôm nay trời đẹp, ông đi trồng lúa tiếp đây.")
  }, 5000)
}

function onEnd(reason) {
  console.log('🔌 Disconnected:', reason)
  bot = null
  if (!shuttingDown) {
    reconnectAttempts++
    setTimeout(connect, 8000)
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  shuttingDown = true
  if (bot) bot.quit()
  process.exit(0)
})

connect()
