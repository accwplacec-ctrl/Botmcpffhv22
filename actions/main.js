'use strict'

const movement = require('./movement')
const interaction = require('./interaction')
const idle = require('./idle')

// ĐỒNG BỘ với VALID_ACTIONS trong brain.js — mỗi case ở đây phải có
// mặt trong VALID_ACTIONS, và mỗi giá trị trong VALID_ACTIONS phải có
// case tương ứng ở đây. Hai bên lệch nhau là bot sẽ đứng im (rơi default).

async function executeAction(action, ctx) {
  const { bot, garden, moodEngine, memory, CONFIG, rag, say, getOwnerEntity, maybeAutoDeliverGift } = ctx
  if (!bot) return

  try {
    switch (action) {
      case 'idle':
        return idle.doIdle(bot, moodEngine)
      case 'wander':
        return movement.doWander(bot, garden, moodEngine)
      case 'look_owner':
        return movement.doLookOwner(bot, getOwnerEntity)
      case 'rest':
        return movement.doRest(bot, moodEngine)
      case 'wave':
        return idle.doEmote(bot)
      case 'till':
        return interaction.doTill(bot, garden, moodEngine)
      case 'plant':
        return interaction.doPlant(bot, garden, moodEngine)
      case 'harvest':
        return interaction.doHarvest(bot, garden, moodEngine, memory, maybeAutoDeliverGift)
      case 'deliver_gift':
        return interaction.doDeliverGift(bot, CONFIG, memory, rag, say)
      case 'chop_wood':
        return interaction.doChopWood(bot, say)
      case 'mine':
        return interaction.doMine(bot, say)
      case 'goto':
        return movement.doGoto(bot, ctx.goto_x, ctx.goto_y, ctx.goto_z, say)
      default:
        console.log(`❓ Action không xác định: ${action}`)
        return idle.doIdle(bot, moodEngine)
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

module.exports = { executeAction }
