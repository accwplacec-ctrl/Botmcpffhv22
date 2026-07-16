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
 * index.js
 * ------------------------------------------------------------
 * File chinh: khoi tao bot, dang ky toan bo event, chay farming
 * loop that, mood engine, proactive loop, gift logic, va thuc thi
 * tap action day du tra ve tu bo nao (Colab).
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
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 60000,
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
  console.log('✅ Ông Tư đã vào vườn.')
  reconnectAttempts = 0

  // Cho chunk quanh diem spawn tai xong truoc khi bat vat ly/pathfinder chu dong.
  // Tren server hieu nang khong on dinh (vd Aternos free), neu bot bat dau mo phong
  // vat ly ngay khi vua spawn ma chunk chua tai kip, server co the nhan duoc goi tin
  // vi tri bat thuong va kick voi ly do "Invalid move player packet received".
  await new Promise((resolve) => setTimeout(resolve, 9000))

  if (!bot || !bot.entity) return // Neu da bi kick/ngat trong luc cho, dung lai o day

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  // Han che pathfinder chi di chuyen trong khu vuon: kiem tra thu cong truoc moi lenh goto
  bot.pathfinder.setMovements(movements)

  await memory.init()
  moodEngine.resetSession()
  moodEngine.startEngine(bot)

  // Neu lan chet truoc chua duoc nhac, cho no cho luot chat/proactive dau tien xu ly
  startFarmingLoop()
  startAffectionDecayLoop()
  startWorkingMemorySweep()

  proactive.start(bot, () => runBrainTurn('proactive', null))
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

// ===== Su kien: chet =====

function onDeath() {
  // mineflayer khong luon cung cap ly do chet ro rang; co lay duoc gi thi lay
  let reason = 'không rõ lý do'
  try {
    if (bot.lastDamageSource) reason = String(bot.lastDamageSource)
  } catch (e) {
    // bo qua, dung gia tri mac dinh
  }
  console.log(`☠️ Ông Tư vừa chết: ${reason}`)
  memory.recordDeath(reason)
}

// ===== Su kien: theo doi pha ruong (working memory) =====
// Chi tinh khi block doi tu farmland/wheat sang air/dirt VA chu dang dung sat ben (tuong tac truc tiep),
// khong tinh neu chu chi di ngang qua khong tuong tac.

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
    // Chi tinh la "chu pha" neu chu dung du gan de tuong tac truc tiep (~ban kinh tuong tac vanilla)
    if (distToOwner <= 5) {
      workingMemory.setFlag('ruong_bi_pha', 12 * 60 * 1000)
      console.log('🌾 Ghi nhận: Tới vừa phá ruộng gần vị trí của mình.')
    }
  } catch (e) {
    console.log('❌ Lỗi xử lý blockUpdate:', e.message)
  }
}

// ===== Su kien: chu tang do (item roi gan bot, bot nhat duoc) =====

function onPlayerCollect(collector, collected) {
  try {
    if (!bot || collector.username !== bot.username) return
    if (!collected || !collected.metadata) return

    // Chi tinh la "qua tang" neu item vua duoc chu tha ra gan day (heuristic: chu dang o gan bot)
    const owner = getOwnerEntity()
    if (!owner || !bot.entity) return
    if (owner.position.distanceTo(bot.entity.position) > 8) return

    // Lay ten item vua nhat tu inventory (so sanh nhanh - lay item cuoi cung thay doi)
    const items = bot.inventory.items()
    const lastItem = items[items.length - 1]
    const itemName = lastItem ? lastItem.name : 'không rõ'

    if (itemName === 'wheat') return // wheat tu thu hoach khong tinh la qua

    const bonus = memory.bonusAffectionForGift(itemName)
    moodEngine.addHappyOnGiftReceived()
    console.log(`🎁 Nhận được ${itemName} từ Tới, affection +${bonus}.`)
  } catch (e) {
    // bo qua loi heuristic, khong quan trong
  }
}

// ===== Su kien: chat =====

async function onChat(username, message) {
  if (!bot || username === bot.username) return
  console.log(`💬 <${username}> ${message}`)
  if (username !== CONFIG.ownerName) return

  memory.pushConversation('owner', message)
  await runBrainTurn('chat', message)
}

// ===== Goi bo nao va thuc thi ket qua =====

async function runBrainTurn(mode, userMessage) {
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

    // Neu co lan chet chua duoc nhac, chen vao prompt lan nay roi tieu thu (chi nhac 1 lan)
    const deathMention = memory.consumeDeathMention()
    const promptParts = []
    if (deathMention) {
      promptParts.push(`(Ghi chú riêng cho lượt này: Ông Tư vừa hồi sinh sau khi chết vì "${deathMention}" — hãy than thở một chút về việc này rồi thôi, không nhắc lại các lần sau.)`)
    }
    if (mode === 'proactive') {
      promptParts.push('(Ông Tư đang chủ động bắt chuyện vì Tới đang ở trong vườn, Tới chưa nói gì cả.)')
    } else {
      promptParts.push(`Tới vừa nói: "${userMessage}"`)
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
    }

    const response = await brain.generate(systemPrompt, userPrompt, emotionalState, memoryContext, wheatCount)

    if (response.say) {
      say(response.say)
      memory.pushConversation('ong_tu', response.say)
    }
    if (response.remember) memory.rememberFromBrain(response.remember)
    if (response.affection_delta) memory.updateAffectionFromChat(response.affection_delta)
    if (mode === 'chat' && response.affection_delta > 0) moodEngine.addHappyOnPositiveChat()

    await executeAction(response.action)
  } catch (e) {
    console.log('❌ Lỗi trong lượt gọi bộ não:', e.message)
  } finally {
    brainCallInFlight = false
  }
}

// ===== Dispatcher: thuc thi action tra ve tu Colab =====

async function executeAction(action) {
  if (!bot) return
  try {
    switch (action) {
      case 'idle':
        return doIdle()
      case 'wander':
        return doWander()
      case 'till':
        return doTill()
      case 'plant':
        return doPlant()
      case 'harvest':
        return doHarvest()
      case 'sit':
        return doSit()
      case 'wave':
        return doWave()
      case 'look_owner':
        return doLookOwner()
      case 'deliver_gift':
        return doDeliverGift()
      case 'rest':
        return doRest()
      case 'avoid_owner':
        return doAvoidOwner()
      case 'avoid_monster':
        return doAvoidMonster()
      default:
        console.log(`❓ Action không xác định: ${action}`)
        return doIdle()
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

// ===== Cac hanh dong don le =====

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
    // Khong toi duoc thi bo qua, khong quan trong voi wander
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

async function doAvoidOwner() {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try {
    // Quay lung lai phia chu: nhin huong nguoc lai
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
    // Neu khong pathfind duoc thi thoi, uu tien khong crash
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

// ===== Canh tac that: till / plant / harvest =====

async function doTill() {
  const mcData = require('minecraft-data')(bot.version)
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
    matching: (block) =>
      block.name === 'wheat' && block.metadata === 7 && garden.isInGarden(block.position),
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

// ===== Tang qua tu dong =====

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
    say(`Ta để dành được ${total} bó lúa mì, mang ra đây tặng Tới đó.`)

    if (milestone) {
      say(`Ấy chà, vậy là ta đã tặng Tới tròn ${milestone} bó lúa mì rồi đó, con nhớ giữ sức khoẻ mà làm ăn nghen.`)
    }
  } catch (e) {
    console.log('❌ Lỗi khi tặng quà:', e.message)
  }
}

// ===== Vong lap canh tac tu dong (chay doc lap, khong can Colab) =====

function startFarmingLoop() {
  if (farmingTickHandle) clearInterval(farmingTickHandle)
  farmingTickHandle = setInterval(async () => {
    if (!bot || !bot.entity) return

    const dominant = moodEngine.getDominantMood()
    if (dominant.type === 'scared') {
      await doAvoidMonster()
      return
    }
    if (dominant.type === 'tired') {
      await doRest()
      return
    }

    // Chu trinh canh tac uu tien: thu hoach -> trong -> cay dat -> di lang thang
    const ripe = bot.findBlock({
      matching: (block) => block.name === 'wheat' && block.metadata === 7 && garden.isInGarden(block.position),
      maxDistance: 32,
    })
    if (ripe) return doHarvest()

    const emptyFarmland = bot.findBlock({
      matching: (block) => block.name === 'farmland' && garden.isInGarden(block.position),
      maxDistance: 32,
      useExtraInfo: (block) => {
        const above = bot.blockAt(block.position.offset(0, 1, 0))
        return above && above.name === 'air'
      },
    })
    if (emptyFarmland) return doPlant()

    const grassAvailable = bot.findBlock({
      matching: (block) => block.name === 'grass_block' && garden.isInGarden(block.position),
      maxDistance: 32,
    })
    if (grassAvailable) return doTill()

    return doWander()
  }, CONFIG.farming.tickIntervalMs)
}

// ===== Affection: giam dan theo gio =====

function startAffectionDecayLoop() {
  if (affectionDecayHandle) clearInterval(affectionDecayHandle)
  affectionDecayHandle = setInterval(() => {
    memory.decayAffection()
  }, 60 * 60 * 1000) // moi gio
}

// ===== Working memory: don dep dinh ky =====

function startWorkingMemorySweep() {
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle)
  workingMemorySweepHandle = setInterval(() => {
    workingMemory.sweepExpired()
  }, 60 * 1000)
}

// ===== Xu ly thoat chuong trinh an toan =====

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
