const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const minecraftData = require('minecraft-data')

const { GoalNear, GoalFollow } = goals

// ============================================
// CẤU HÌNH
// ============================================

const CONFIG = {
  SERVER_IP: 'jjjggdffgg.aternos.me',
  SERVER_PORT: 34242,
  BOT_USERNAME: 'SmartBot',
  AUTH: 'offline',
  VERSION: '1.21.4'
}

// ============================================
// TẠO BOT
// ============================================

const bot = mineflayer.createBot({
  host: CONFIG.SERVER_IP,
  port: Number(CONFIG.SERVER_PORT),
  username: CONFIG.BOT_USERNAME,
  auth: CONFIG.AUTH,
  version: CONFIG.VERSION,
  connectTimeout: 30000
})

bot.loadPlugin(pathfinder)

// ============================================
// TRẠNG THÁI
// ============================================

let isFollowing = false
let followTarget = null
let currentGoal = null

let movements = null

// ============================================
// SPAWN
// ============================================

bot.once('spawn', () => {
  console.log('========================================')
  console.log('[Bot] Đã vào server!')
  console.log('[Bot] Minecraft:', bot.version)
  console.log('[Bot] Username:', bot.username)
  console.log('========================================')

  const mcData = minecraftData(bot.version)

  if (!mcData) {
    console.error(
      '[Bot] Không tìm thấy minecraft-data:',
      bot.version
    )
    return
  }

  // ==========================================
  // MOVEMENTS
  // ==========================================

  movements = new Movements(bot, mcData)

  // Không đào block
  movements.canDig = false

  // Cho phép dựng cột 1x1
  movements.allow1by1towers = true

  // Cho phép parkour
  movements.allowParkour = true

  // Cho phép sprint
  movements.canSprint = true

  // Mở cửa
  movements.canOpenDoors = true

  // Mở trapdoor
  movements.canOpenTrapdoors = true

  // Leo thang
  movements.canUseLadders = true

  // Leo dây leo
  movements.canUseVines = true

  // Bơi
  movements.canSwim = true

  // Không free motion
  movements.allowFreeMotion = false

  // Không cho phép rơi quá 3 block
  movements.maxDropDown = 3

  // ==========================================
  // SCAFFOLDING = DIRT
  // ==========================================

  const dirt = mcData.blocksByName.dirt

  if (dirt) {
    movements.scafoldingBlocks = [
      dirt.id
    ]

    console.log(
      '[Pathfinder] Scaffolding = dirt'
    )
  }

  // ==========================================
  // ÁP DỤNG MOVEMENTS
  // ==========================================

  bot.pathfinder.setMovements(movements)

  console.log('========================================')
  console.log('[Pathfinder] Đã sẵn sàng')
  console.log('canDig:', movements.canDig)
  console.log(
    'allow1by1towers:',
    movements.allow1by1towers
  )
  console.log(
    'allowParkour:',
    movements.allowParkour
  )
  console.log(
    'canSprint:',
    movements.canSprint
  )
  console.log(
    'canOpenDoors:',
    movements.canOpenDoors
  )
  console.log(
    'canOpenTrapdoors:',
    movements.canOpenTrapdoors
  )
  console.log(
    'canUseLadders:',
    movements.canUseLadders
  )
  console.log(
    'canUseVines:',
    movements.canUseVines
  )
  console.log(
    'canSwim:',
    movements.canSwim
  )
  console.log(
    'maxDropDown:',
    movements.maxDropDown
  )
  console.log('========================================')

  bot.chat(
    '🤖 Bot sẵn sàng! goto <x> <y> <z> | follow [tên] | stop'
  )
})

// ============================================
// CHAT COMMAND
// ============================================

bot.on('chat', (username, message) => {
  if (username === bot.username) {
    return
  }

  const args = message
    .trim()
    .split(/\s+/)

  if (!args[0]) {
    return
  }

  const command =
    args[0].toLowerCase()

  // ==========================================
  // GOTO
  // ==========================================

  if (command === 'goto') {
    if (args.length < 4) {
      bot.chat(
        '⚠️ Dùng: goto <x> <y> <z>'
      )
      return
    }

    const x = Number(args[1])
    const y = Number(args[2])
    const z = Number(args[3])

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      bot.chat(
        '⚠️ Tọa độ không hợp lệ.'
      )
      return
    }

    isFollowing = false
    followTarget = null

    currentGoal = new GoalNear(
      x,
      y,
      z,
      2
    )

    console.log(
      `[Bot] GOTO ${x} ${y} ${z}`
    )

    bot.chat(
      `🚶 Đi tới ${x} ${y} ${z}...`
    )

    bot.pathfinder.setGoal(
      currentGoal
    )

    return
  }

  // ==========================================
  // FOLLOW
  // ==========================================

  if (command === 'follow') {
    const targetName =
      args[1] || username

    const player =
      bot.players[targetName]

    if (!player) {
      bot.chat(
        `❌ Không tìm thấy ${targetName}.`
      )
      return
    }

    if (!player.entity) {
      bot.chat(
        `❌ Không thấy ${targetName} ở gần.`
      )
      return
    }

    isFollowing = true
    followTarget = targetName

    currentGoal = new GoalFollow(
      player.entity,
      2
    )

    console.log(
      `[Bot] FOLLOW ${targetName}`
    )

    bot.chat(
      `👀 Đang theo ${targetName}...`
    )

    bot.pathfinder.setGoal(
      currentGoal,
      true
    )

    return
  }

  // ==========================================
  // STOP
  // ==========================================

  if (command === 'stop') {
    isFollowing = false
    followTarget = null
    currentGoal = null

    bot.pathfinder.setGoal(null)

    // Chỉ clear control khi stop
    bot.clearControlStates()

    console.log(
      '[Bot] Đã dừng.'
    )

    bot.chat(
      '🛑 Đã dừng.'
    )

    return
  }
})

// ============================================
// ENTITY SPAWN
// ============================================

bot.on('entitySpawn', (entity) => {
  if (
    isFollowing &&
    followTarget &&
    entity.username === followTarget
  ) {
    currentGoal = new GoalFollow(
      entity,
      2
    )

    bot.pathfinder.setGoal(
      currentGoal,
      true
    )
  }
})

// ============================================
// PATH UPDATE
// ============================================

bot.on('path_update', (result) => {
  console.log(
    '[Pathfinder]',
    result.status
  )

  if (result.status === 'noPath') {
    console.log(
      '[Pathfinder] Không tìm được đường.'
    )

    if (!isFollowing) {
      bot.chat(
        '❌ Không tìm được đường.'
      )
    }
  }

  if (result.status === 'timeout') {
    console.log(
      '[Pathfinder] Tìm đường timeout.'
    )

    if (!isFollowing) {
      bot.chat(
        '⏱️ Pathfinder tìm đường quá lâu.'
      )
    }
  }
})

// ============================================
// GOAL REACHED
// ============================================

bot.on('goal_reached', () => {
  console.log(
    '[Pathfinder] Goal reached.'
  )

  if (!isFollowing) {
    bot.chat(
      '✅ Đã đến nơi!'
    )
  }
})

// ============================================
// PHYSICS TICK
// ============================================
//
// KHÔNG TỰ ÉP JUMP Ở ĐÂY.
// Pathfinder tự xử lý movement.
//

bot.on('physicsTick', () => {
  if (!bot.entity) {
    return
  }

  // Nếu không có goal thì không làm gì
  if (!currentGoal) {
    return
  }

  // Không tự setControlState('jump')
  //
  // Để mineflayer-pathfinder tự điều khiển.
})

// ============================================
// LOGIN
// ============================================

bot.on('login', () => {
  console.log(
    '[Bot] 🔑 Login thành công.'
  )
})

// ============================================
// KICK
// ============================================

bot.on('kicked', (reason) => {
  console.error(
    '========================================'
  )

  console.error(
    '[Bot] ⚠️ BỊ KICK'
  )

  console.error(
    '[Bot] Reason:',
    reason
  )

  console.error(
    '========================================'
  )
})

// ============================================
// ERROR
// ============================================

bot.on('error', (err) => {
  console.error(
    '========================================'
  )

  console.error(
    '[Bot] ❌ ERROR'
  )

  console.error(
    'Code:',
    err.code
  )

  console.error(
    'Message:',
    err.message
  )

  console.error(err)

  console.error(
    '========================================'
  )
})

// ============================================
// END
// ============================================

bot.on('end', (reason) => {
  console.log(
    '========================================'
  )

  console.log(
    '[Bot] 🔌 Mất kết nối.'
  )

  if (reason) {
    console.log(
      '[Bot] Reason:',
      reason
    )
  }

  console.log(
    '========================================'
  )
})

// ============================================
// DEATH
// ============================================

bot.on('death', () => {
  console.log(
    '[Bot] 💀 Bot đã chết.'
  )

  isFollowing = false
  followTarget = null
  currentGoal = null

  bot.clearControlStates()
})

// ============================================
// HEALTH
// ============================================

bot.on('health', () => {
  if (bot.health <= 5) {
    console.log(
      '[Bot] ⚠️ Máu thấp:',
      bot.health
    )
  }
})
