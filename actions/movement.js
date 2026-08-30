'use strict'
const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

function doWander(bot, garden, moodEngine) {
  moodEngine.notifyRestOrIdle()
  const point = garden.randomPointInGarden()
  const groundY = garden.findGroundY(bot, point.x, point.z)
  if (groundY === null) return
  return bot.pathfinder.goto(new GoalNear(point.x, groundY, point.z, 1)).catch(() => {})
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

module.exports = { doWander, doRest, doLookOwner }
