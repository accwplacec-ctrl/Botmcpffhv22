'use strict'

/**
 * pathing.js — lớp pathfinder dùng chung.
 * - Cấu hình Movements 1 lần lúc spawn
 * - goTo có timeout theo khoảng cách, fallback GoalNearXZ, không spam "đi lỗi" khi bị lệnh mới hủy
 * - Watchdog gỡ kẹt (đứng im quá lâu khi đang có goal)
 * - Wander chọn điểm gần, đã load chunk, có mặt đất
 */

const { Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalNearXZ, GoalFollow, GoalGetToBlock } = goals
const { Vec3 } = require('vec3')

const HAZARDS = new Set([
  'lava',
  'flowing_lava',
  'fire',
  'soul_fire',
  'cactus',
  'sweet_berry_bush',
  'wither_rose',
  'magma_block',
  'campfire',
  'soul_campfire',
  'powder_snow',
  'cobweb',
])

let navGen = 0
let stuckTimer = null
let lastPos = null
let lastMovedAt = 0
let unstucking = false
let followEntityId = null

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function createMovements(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const m = new Movements(bot, mcData)
  m.canDig = false
  m.scafoldingBlocks = []
  m.allow1by1towers = false
  m.allowParkour = true
  m.allowSprinting = true
  m.maxDropDown = 4
  m.liquidCost = 8
  m.dontCreateFlow = true
  m.dontMineUnderFallingBlock = true
  if ('allowEntityDetection' in m) m.allowEntityDetection = true
  m.exclusionAreasStep = [
    (block) => {
      if (!block) return 0
      return HAZARDS.has(block.name) ? 100 : 0
    },
  ]
  return m
}

function applyStyle(bot, style) {
  const m = bot.pathfinder && bot.pathfinder.movements
  if (!m) return
  if (style === 'farm') {
    m.allowParkour = false
    m.allowSprinting = false
    m.maxDropDown = 2
  } else {
    m.allowParkour = true
    m.allowSprinting = true
    m.maxDropDown = 4
  }
}

function setup(bot) {
  const movements = createMovements(bot)
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 4000
  bot.pathfinder.tickTimeout = 12
  bot.pathfinder.searchRadius = 96

  bot.on('path_update', (r) => {
    if (!r || !r.status) return
    if (r.status === 'noPath') console.log('⚠️ Path: noPath')
    else if (r.status === 'timeout') console.log('⚠️ Path: think timeout — dùng partial nếu có')
    else if (r.status === 'partial') console.log('⚠️ Path: partial (đi gần nhất có thể)')
  })

  bot.on('path_reset', (reason) => {
    if (reason === 'stuck') {
      console.log('⚠️ Path reset: stuck')
      unstuck(bot).catch(() => {})
    }
  })

  startStuckWatchdog(bot)
  console.log('🧭 Pathfinder sẵn sàng (no-dig, sprint, né lava/cactus, timeout 4s)')
  return movements
}

function teardown(bot) {
  navGen += 1
  followEntityId = null
  if (stuckTimer) {
    clearInterval(stuckTimer)
    stuckTimer = null
  }
  try {
    if (bot && bot.pathfinder) bot.pathfinder.setGoal(null)
  } catch (e) {}
}

function startStuckWatchdog(bot) {
  if (stuckTimer) clearInterval(stuckTimer)
  lastPos = null
  lastMovedAt = Date.now()
  stuckTimer = setInterval(() => {
    if (!bot || !bot.entity) return
    const p = bot.entity.position
    if (!bot.pathfinder || !bot.pathfinder.goal) {
      lastPos = p.clone()
      lastMovedAt = Date.now()
      return
    }
    if (!lastPos || p.distanceTo(lastPos) > 0.35) {
      lastPos = p.clone()
      lastMovedAt = Date.now()
      return
    }
    if (!unstucking && Date.now() - lastMovedAt > 3500) {
      unstuck(bot).catch(() => {})
    }
  }, 500)
}

async function unstuck(bot) {
  if (unstucking || !bot || !bot.entity) return
  unstucking = true
  console.log('🩹 Gỡ kẹt pathfinder')
  try {
    bot.clearControlStates()
    bot.setControlState('jump', true)
    bot.setControlState('sprint', true)
    bot.setControlState('forward', true)
    await sleep(350)
    bot.setControlState('forward', false)
    bot.setControlState('back', true)
    await sleep(180)
    bot.clearControlStates()
    const goal = bot.pathfinder && bot.pathfinder.goal
    if (goal) {
      const dynamic = !!followEntityId
      bot.pathfinder.setGoal(null)
      bot.pathfinder.setGoal(goal, dynamic)
    }
  } catch (e) {
    console.log('⚠️ Unstuck lỗi:', e.message)
  } finally {
    unstucking = false
    lastMovedAt = Date.now()
    if (bot.entity) lastPos = bot.entity.position.clone()
  }
}

function clearSneak(bot) {
  try {
    bot.setControlState('sneak', false)
  } catch (e) {}
}

function isPathing(bot) {
  return !!(bot && bot.pathfinder && bot.pathfinder.goal)
}

function alreadyThere(bot, x, y, z, range) {
  if (!bot || !bot.entity) return false
  const p = bot.entity.position
  const dx = p.x - x
  const dz = p.z - z
  const dy = y == null ? 0 : p.y - y
  return dx * dx + dz * dz + dy * dy <= range * range
}

function timeoutForDistance(from, to) {
  const dist = from.distanceTo(to)
  return Math.min(90000, Math.max(8000, Math.round(dist * 450)))
}

function withTimeout(promise, ms, bot) {
  let handle
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => {
      try {
        bot.pathfinder.stop()
      } catch (e) {}
      reject(new Error(`timeout ${ms}ms`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle))
}

function isCancelledError(err) {
  const msg = (err && err.message) || String(err || '')
  return /GoalChanged|PathStopped|interrupted|cancel/i.test(msg)
}

/**
 * @param {object} opts
 * @param {number} [opts.range=2]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.style] 'travel' | 'farm'
 * @param {string} [opts.label]
 * @param {function} [opts.say]
 * @param {boolean} [opts.announce=false] chat khi tới nơi / lỗi
 */
async function goTo(bot, x, y, z, opts = {}) {
  if (!bot || !bot.entity || !bot.pathfinder) return false
  if (x == null || z == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
    if (opts.say) opts.say('toạ độ gì đâu mà đi')
    return false
  }

  const tx = Math.round(Number(x))
  const tz = Math.round(Number(z))
  const ty = y != null && Number.isFinite(Number(y)) ? Math.round(Number(y)) : null
  const range = opts.range != null ? opts.range : 2
  const label = opts.label || 'goto'
  const myGen = ++navGen
  followEntityId = null

  if (alreadyThere(bot, tx, ty ?? bot.entity.position.y, tz, range)) {
    console.log(`✅ ${label}: đã ở gần (${tx}, ${ty ?? '~'}, ${tz})`)
    return true
  }

  applyStyle(bot, opts.style || 'travel')
  bot.pathfinder.searchRadius = opts.searchRadius != null ? opts.searchRadius : 96
  bot.pathfinder.thinkTimeout = opts.thinkTimeout != null ? opts.thinkTimeout : 5000
  clearSneak(bot)

  const destY = ty ?? Math.round(bot.entity.position.y)
  const dest = new Vec3(tx, destY, tz)
  const ms = opts.timeoutMs || timeoutForDistance(bot.entity.position, dest)
  const goal = ty != null ? new GoalNear(tx, ty, tz, range) : new GoalNearXZ(tx, tz, range)

  console.log(
    `🚶 ${label} → (${tx}, ${ty ?? '?'}, ${tz}) range=${range} timeout=${Math.round(ms / 1000)}s từ (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})`
  )

  try {
    await withTimeout(bot.pathfinder.goto(goal), ms, bot)
    if (myGen !== navGen) return false
    console.log(`✅ ${label} tới nơi`, bot.entity.position)
    if (opts.announce && opts.say) opts.say('tới nơi rồi đó')
    return true
  } catch (e) {
    if (myGen !== navGen || isCancelledError(e)) {
      console.log(`⏭️ ${label} bị lệnh mới thay thế`)
      return false
    }
    console.log(`⚠️ ${label} lần 1: ${e.message} — fallback GoalNearXZ`)
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNearXZ(tx, tz, range + 2)), Math.min(ms, 25000), bot)
      if (myGen !== navGen) return false
      console.log(`✅ ${label} tới (fallback)`, bot.entity.position)
      if (opts.announce && opts.say) opts.say('tới nơi rồi đó')
      return true
    } catch (e2) {
      if (myGen !== navGen || isCancelledError(e2)) return false
      console.log(`❌ ${label}:`, e2.message)
      if (opts.announce && opts.say) opts.say('đi lỗi mất rồi, k tới đc')
      return false
    }
  }
}

async function goToBlock(bot, block, opts = {}) {
  if (!bot || !block) return false
  const p = block.position
  const myGen = ++navGen
  followEntityId = null
  applyStyle(bot, opts.style || 'farm')
  bot.pathfinder.searchRadius = 48
  bot.pathfinder.thinkTimeout = 3000
  clearSneak(bot)
  const ms = opts.timeoutMs || 20000
  try {
    await withTimeout(bot.pathfinder.goto(new GoalGetToBlock(p.x, p.y, p.z)), ms, bot)
    return myGen === navGen
  } catch (e) {
    if (myGen !== navGen || isCancelledError(e)) return false
    console.log('⚠️ goToBlock fail, thử GoalNear:', e.message)
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(p.x, p.y, p.z, 2)), 15000, bot)
      return myGen === navGen
    } catch (e2) {
      if (myGen !== navGen || isCancelledError(e2)) return false
      console.log('❌ goToBlock:', e2.message)
      return false
    }
  }
}

function follow(bot, entity, opts = {}) {
  if (!bot || !bot.pathfinder) return false
  if (!entity) {
    console.log('⚠️ Follow: không thấy target')
    if (opts.say) opts.say('k thấy mày đâu, lại gần đi')
    return false
  }
  const range = opts.range != null ? opts.range : 3
  applyStyle(bot, 'travel')
  bot.pathfinder.searchRadius = 64
  bot.pathfinder.thinkTimeout = 4000
  clearSneak(bot)
  navGen += 1
  followEntityId = entity.id
  try {
    bot.pathfinder.setGoal(new GoalFollow(entity, range), true)
    console.log(`👣 Follow ${entity.username || entity.name || entity.id} range=${range}`)
    if (opts.say) opts.say('ok theo sau')
    return true
  } catch (e) {
    followEntityId = null
    console.log('❌ Follow:', e.message)
    if (opts.say) opts.say('theo k đc, lỗi r')
    return false
  }
}

function stop(bot, opts = {}) {
  navGen += 1
  followEntityId = null
  try {
    if (bot && bot.pathfinder) bot.pathfinder.setGoal(null)
    if (bot) bot.clearControlStates()
  } catch (e) {}
  console.log('🛑 Dừng pathfinder')
  if (opts.say) opts.say('ok đứng đây')
}

function pickWanderTarget(bot, garden, radius = 12) {
  if (!bot || !bot.entity || !garden) return null
  const b = garden.bounds()
  const p = bot.entity.position
  const gardenW = Math.max(1, b.maxX - b.minX)
  const gardenD = Math.max(1, b.maxZ - b.minZ)
  if (gardenW < 2 && gardenD < 2) {
    console.log('⚠️ Wander: vườn quá nhỏ / chưa set GARDEN_MIN/MAX')
    return null
  }
  const r = Math.min(radius, Math.max(gardenW, gardenD) / 2)

  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2
    const dist = 4 + Math.random() * r
    let x = p.x + Math.cos(ang) * dist
    let z = p.z + Math.sin(ang) * dist
    x = Math.max(b.minX, Math.min(b.maxX, x))
    z = Math.max(b.minZ, Math.min(b.maxZ, z))
    if (Math.abs(x - p.x) + Math.abs(z - p.z) < 3) continue

    const gy = garden.findGroundY(bot, x, z)
    if (gy == null) continue

    const feet = bot.blockAt(new Vec3(Math.floor(x), gy, Math.floor(z)))
    const head = bot.blockAt(new Vec3(Math.floor(x), gy + 1, Math.floor(z)))
    if (feet && feet.boundingBox === 'block') continue
    if (head && head.boundingBox === 'block') continue
    if (feet && HAZARDS.has(feet.name)) continue

    return { x, y: gy, z }
  }
  return null
}

module.exports = {
  setup,
  teardown,
  goTo,
  goToBlock,
  follow,
  stop,
  isPathing,
  alreadyThere,
  pickWanderTarget,
  timeoutForDistance,
  HAZARDS,
}
