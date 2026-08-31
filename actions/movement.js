'use strict'
const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

// Timeout thủ công cho pathfinder — tránh treo vô thời hạn khi bị chặn/kẹt địa hình
function gotoWithTimeout(bot, goal, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      reject(new Error('timeout: pathfinder bị kẹt/chặn quá lâu'))
    }, timeoutMs)

    bot.pathfinder.goto(goal).then(() => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }).catch((e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(e)
    })
  })
}

function doWander(bot, garden, moodEngine) {
  moodEngine.notifyRestOrIdle()
  const point = garden.randomPointInGarden()
  const groundY = garden.findGroundY(bot, point.x, point.z)
  if (groundY === null) return
  return gotoWithTimeout(bot, new GoalNear(point.x, groundY, point.z, 1), 15000).catch(() => {})
}

async function doRest(bot, moodEngine) {
  moodEngine.notifyRestOrIdle()
  try {
    bot.pathfinder.setGoal(null)
    bot.setControlState('sneak', true)
    setTimeout(() => {
      try { bot.setControlState('sneak', false) } catch (e) {}
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
  try {
    const targetY = y != null ? y : bot.entity.position.y
    await gotoWithTimeout(bot, new GoalNear(x, targetY, z, 2), 20000)
    if (say) say('tới nơi rồi đó')
  } catch (e) {
    console.log('❌ Lỗi khi goto:', e.message)
    if (say && !/goal was changed/i.test(e.message)) {
      say(/timeout/i.test(e.message) ? 'kẹt đường quá, thôi bỏ' : 'đi lỗi mất rồi')
    }
  }
}

module.exports = { doWander, doRest, doLookOwner, doGoto }
