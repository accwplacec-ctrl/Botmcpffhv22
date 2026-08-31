'use strict'

const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

function gotoWithTimeout(bot, goal, timeoutMs = 15000) {
  console.log(`🚶 [PATHFINDER] Bắt đầu goto → goal: x=${goal.x}, y=${goal.y}, z=${goal.z}, bot đang ở: ${bot.entity.position}`)
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      console.log(`⏱️ [PATHFINDER] TIMEOUT sau ${timeoutMs}ms — bot hiện đang ở: ${bot.entity.position}, isMoving: ${bot.pathfinder.isMoving ? bot.pathfinder.isMoving() : 'unknown'}`)
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      reject(new Error('timeout: pathfinder bị kẹt/chặn quá lâu'))
    }, timeoutMs)

    bot.pathfinder.goto(goal).then(() => {
      if (done) return
      done = true
      clearTimeout(timer)
      console.log(`✅ [PATHFINDER] Tới đích thành công, bot ở: ${bot.entity.position}`)
      resolve()
    }).catch((e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      console.log(`❌ [PATHFINDER] goto() reject: ${e.message}, bot ở: ${bot.entity.position}`)
      reject(e)
    })
  })
}

// Thử lại với bán kính chấp nhận đích nới rộng dần nếu điểm chính xác không tới được
async function gotoWithRetry(bot, x, y, z, say, timeoutMs = 15000) {
  const ranges = [2, 4, 7]
  for (const r of ranges) {
    try {
      await gotoWithTimeout(bot, new GoalNear(x, y, z, r), timeoutMs)
      return true
    } catch (e) {
      if (/goal was changed/i.test(e.message)) return false // bị lệnh khác ghi đè, không phải lỗi thật
    }
  }
  if (say) say('không tới gần chỗ đó được')
  return false
}

function doWander(bot, garden, moodEngine) {
  moodEngine.notifyRestOrIdle()
  const pos = bot.entity.position
  const dx = (Math.random() - 0.5) * 20
  const dz = (Math.random() - 0.5) * 20
  const x = Math.floor(pos.x + dx)
  const z = Math.floor(pos.z + dz)
  return gotoWithTimeout(bot, new GoalNear(x, pos.y, z, 1), 15000).catch(() => {})
}

async function doRest(bot, moodEngine) {
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

function doLookOwner(bot, getOwnerEntity) {
  const owner = getOwnerEntity()
  if (!owner || !bot.entity) return
  try {
    bot.lookAt(owner.position.offset(0, owner.height || 1.6, 0), true)
  } catch (e) {}
}

async function doGoto(bot, x, y, z, say) {
  if (x == null || z == null) {
    if (say) say('toạ độ gì đâu mà đi')
    return
  }
  const targetY = y != null ? y : bot.entity.position.y
  const ok = await gotoWithRetry(bot, x, targetY, z, say, 15000)
  if (ok && say) say('tới nơi rồi đó')
}

module.exports = { doWander, doRest, doLookOwner, doGoto, gotoWithTimeout, gotoWithRetry }
