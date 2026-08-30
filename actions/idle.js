
'use strict'

function doIdle(bot, moodEngine) {
  try { bot.pathfinder.setGoal(null) } catch (e) {}
  moodEngine.notifyRestOrIdle()
}

function doEmote(bot) {
  try { bot.swingArm('right') } catch (e) {}
}

module.exports = { doIdle, doEmote }
