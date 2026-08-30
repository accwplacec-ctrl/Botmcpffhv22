'use strict'
const movement = require('./movement')
const interaction = require('./interaction')
const idle = require('./idle')

async function executeAction(action, ctx) {
  const { bot, garden, moodEngine, memory, CONFIG, rag, say, getOwnerEntity, maybeAutoDeliverGift } = ctx
  if (!bot) return
  try {
    switch (action) {
      case 'idle': return idle.doIdle(bot, moodEngine)
      case 'wander': return movement.doWander(bot, garden, moodEngine)
      case 'look_owner': return movement.doLookOwner(bot, getOwnerEntity)
      case 'rest': return movement.doRest(bot, moodEngine)
      case 'wave': return idle.doEmote(bot)
      case 'till': return interaction.doTill(bot, garden, moodEngine)
      case 'plant': return interaction.doPlant(bot, garden, moodEngine)
      case 'harvest': return interaction.doHarvest(bot, garden, moodEngine, memory, maybeAutoDeliverGift)
      case 'deliver_gift': return interaction.doDeliverGift(bot, CONFIG, memory, rag, say)
      default:
        console.log(`❓ Action không xác định: ${action}`)
        return idle.doIdle(bot, moodEngine)
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

module.exports = { executeAction }
