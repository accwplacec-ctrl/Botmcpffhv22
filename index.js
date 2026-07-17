'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock } = goals
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
 * index.js FULL - ĐÃ FIX Invalid move player packet + Keepalive
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

// ===== Utils =====
function say(message) {
  if (!bot || !message) return
  try {
    bot.chat(String(message).slice(0, 250))
  } catch (e) {
    console.log('❌ Chat error:', e.message)
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

// ===== Connect =====
function connect() {
  console.log(`🔄 Đang kết nối (lần ${reconnectAttempts + 1})...`)

  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 60000,
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
  bot.on('kicked', (reason) => console.log('👢 Bị kick:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi:', err?.message || err))
  bot.on('end', onEnd)
}

// ===== Fix Spawn - Chống Invalid move packet =====
async function waitForChunkReady() {
  return new Promise((resolve) => {
    let attempts = 0
    const check = () => {
      attempts++
      if (!bot || !bot.entity) return resolve()

      try {
        const col = bot.world.getColumnAt(bot.entity.position)
        if (col) {
          console.log('✅ Chunk loaded successfully')
          return resolve()
        }
      } catch (e) {}

      if (attempts > 70) {
        console.log('⚠️ Chunk timeout, continue anyway')
        return resolve()
      }
      setTimeout(check, 200)
    }
    check()
  })
}

async function onSpawn() {
  console.log('✅ Ông Tư spawn tại:', bot.entity.position)

  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  spawnStableTimer = setTimeout(() => reconnectAttempts = 0, 30000)

  await waitForChunkReady()

  if (!bot || !bot.entity) return

  // Fix position packet
  bot.entity.position.set(
    Math.floor(bot.entity.position.x) + 0.5,
    bot.entity.position.y,
    Math.floor(bot.entity.position.z) + 0.5
  )

  await new Promise(r => setTimeout(r, 1500)) // Delay quan trọng
  bot.physicsEnabled = true
  console.log('⚙️ Physics enabled safely')

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
  console.log('🔌 Mất kết nối:', reason)
  if (spawnStableTimer) clearTimeout(spawnStableTimer)
  stopAllLoops()
  proactive.stop()
  moodEngine.stopEngine()
  bot = null
  if (!shuttingDown) scheduleReconnect()
}

function scheduleReconnect() {
  const delay = Math.min(6000 * Math.pow(1.5, reconnectAttempts), 120000)
  reconnectAttempts++
  console.log(`⏳ Reconnect sau ${Math.round(delay/1000)}s...`)
  setTimeout(connect, delay)
}

function stopAllLoops() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
}

// ===== Events =====
function onDeath() {
  let reason = 'không rõ'
  try { if (bot.lastDamageSource) reason = String(bot.lastDamageSource) } catch {}
  console.log(`☠️ Chết vì: ${reason}`)
  memory.recordDeath(reason)
}

function onBlockUpdate(oldBlock, newBlock) {
  try {
    if (!oldBlock || !newBlock) return
    const wasFarmish = oldBlock.name === 'farmland' || oldBlock.name === 'wheat'
    const becameEmpty = newBlock.name === 'air' || newBlock.name === 'dirt'
    if (!wasFarmish || !becameEmpty || !garden.isInGarden(newBlock.position)) return

    const owner = getOwnerEntity()
    if (owner && owner.position.distanceTo(newBlock.position) <= 5) {
      workingMemory.setFlag('ruong_bi_pha', 12 * 60 * 1000)
    }
  } catch (e) {}
}

function onPlayerCollect(collector, collected) {
  try {
    if (collector.username !== bot.username) return
    const owner = getOwnerEntity()
    if (!owner || owner.position.distanceTo(bot.entity.position) > 8) return

    const items = bot.inventory.items()
    const itemName = items.length ? items[items.length-1].name : 'unknown'
    if (itemName === 'wheat') return

    memory.bonusAffectionForGift(itemName)
    moodEngine.addHappyOnGiftReceived()
  } catch (e) {}
}

async function onChat(username, message) {
  if (!bot || username === bot.username || username !== CONFIG.ownerName) return
  console.log(`💬 <${username}> ${message}`)
  memory.pushConversation('owner', message)
  await runBrainTurn('chat', message)
}

// ===== Brain Core =====
async function runBrainTurn(mode, userMessage) {
  if (!bot || brainCallInFlight) return
  brainCallInFlight = true

  try {
    const memorySummary = memory.summarize()
    const moodState = moodEngine.getMoodState()
    const workingFlags = workingMemory.getActiveFlags()
    const wheatCount = countWheatInInventory()

    const deathMention = memory.consumeDeathMention()
    let userPrompt = mode === 'proactive' 
      ? '(Ông Tư chủ động bắt chuyện)' 
      : `Tới vừa nói: "${userMessage}"`

    if (deathMention) userPrompt = `(Vừa hồi sinh sau khi chết vì ${deathMention}) ${userPrompt}`

    const systemPrompt = persona.buildSystemPrompt(memorySummary, moodState, workingFlags, mode, wheatCount)
    const emotionalState = {
      affection: memorySummary.affection,
      mood_tired: Math.round(moodState.tired),
      mood_scared: Math.round(moodState.scared),
      mood_happy: Math.round(moodState.happy)
    }

    const response = await brain.generate(systemPrompt, userPrompt, emotionalState, memorySummary, wheatCount)

    if (response.say) {
      say(response.say)
      memory.pushConversation('ong_tu', response.say)
    }
    if (response.remember) memory.rememberFromBrain(response.remember)
    if (response.affection_delta) memory.updateAffectionFromChat(response.affection_delta)

    await executeAction(response.action || 'idle')
  } catch (e) {
    console.log('❌ Brain error:', e.message)
  } finally {
    brainCallInFlight = false
  }
}

async function executeAction(action) {
  if (!bot) return
  try {
    switch (action) {
      case 'idle': doIdle(); break
      case 'wander': await doWander(); break
      case 'till': await doTill(); break
      case 'plant': await doPlant(); break
      case 'harvest': await doHarvest(); break
      case 'sit': doSit(); break
      case 'wave': doWave(); break
      case 'look_owner': doLookOwner(); break
      case 'deliver_gift': await doDeliverGift(); break
      case 'rest': doRest(); break
      case 'avoid_owner': doAvoidOwner(); break
      case 'avoid_monster': await doAvoidMonster(); break
      default: doIdle()
    }
  } catch (e) {
    console.log(`❌ Action ${action} error:`, e.message)
    doIdle()
  }
}

// Basic actions
function doIdle() { bot.pathfinder.setGoal(null); moodEngine.notifyRestOrIdle() }
async function doWander() { /* bạn implement sau */ moodEngine.notifyRestOrIdle() }
async function doTill() { /* implement */ }
async function doPlant() { /* implement */ }
async function doHarvest() { /* implement */ }
function doSit() { /* implement */ }
function doWave() { /* implement */ }
function doLookOwner() { /* implement */ }
async function doDeliverGift() { /* implement */ }
function doRest() { doIdle() }
function doAvoidOwner() { /* implement */ }
async function doAvoidMonster() { /* implement */ }

function startFarmingLoop() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  farmingTickHandle = setInterval(() => {
    // Farming logic
  }, CONFIG.farming?.tickIntervalMs || 8000)
}

function startAffectionDecayLoop() {
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  affectionDecayHandle = setInterval(() => memory.decayAffection?.(), 3600000)
}

function startWorkingMemorySweep() {
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  workingMemorySweepHandle = setInterval(() => workingMemory.sweep?.(), 60000)
}

// Start
connect()

process.on('SIGINT', () => {
  shuttingDown = true
  if (bot) bot.quit()
  process.exit(0)
})
