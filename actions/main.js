'use strict'

const movement = require('./movement')
const interaction = require('./interaction')
const idle = require('./idle')

// ĐỒNG BỘ với VALID_ACTIONS trong brain.js — mỗi case ở đây phải có
// mặt trong VALID_ACTIONS, và mỗi giá trị trong VALID_ACTIONS phải có
// case tương ứng ở đây. Hai bên lệch nhau là bot sẽ đứng im (rơi default).
async function executeAction(action, ctx) {
  const {
    bot,
    garden,
    moodEngine,
    memory,
    CONFIG,
    rag,
    say,
    getOwnerEntity,
    maybeAutoDeliverGift,
    goto_x,
    goto_y,
    goto_z,
    targetEntity,
    userControlActive,
    beginUserControl,
    endUserControl,
  } = ctx
  if (!bot) return
  try {
    switch (action) {
      case 'idle':
        // Đừng hủy pathfinder nếu người chơi vừa ra lệnh đi
        if (userControlActive && userControlActive()) {
          console.log('⏭️ idle bị bỏ qua vì đang có lệnh di chuyển của người chơi')
          return
        }
        return idle.doIdle(bot, moodEngine)
      case 'wander':
        if (userControlActive && userControlActive()) return
        return movement.doWander(bot, garden, moodEngine)
      case 'look_owner':
        return movement.doLookOwner(bot, getOwnerEntity)
      case 'rest':
        if (userControlActive && userControlActive()) return
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
      case 'goto': {
        if (beginUserControl) beginUserControl({ follow: false })
        const hasCoords = goto_x != null && goto_z != null
        if (hasCoords) {
          await movement.doGoto(bot, goto_x, goto_y, goto_z, say)
        } else {
          // LLM trả goto nhưng quên tọa độ → đi tới người đang nói / chủ
          await movement.doComeTo(bot, targetEntity || getOwnerEntity(), say)
        }
        if (endUserControl) endUserControl()
        return
      }
      case 'come_here': {
        if (beginUserControl) beginUserControl({ follow: false })
        await movement.doComeTo(bot, targetEntity || getOwnerEntity(), say)
        if (endUserControl) endUserControl()
        return
      }
      case 'follow_owner': {
        const ok = movement.doFollow(bot, targetEntity || getOwnerEntity(), say)
        if (ok && beginUserControl) beginUserControl({ follow: true })
        return
      }
      case 'stop':
        if (endUserControl) endUserControl()
        return movement.doStop(bot, say)
      case 'chop_wood':
        return interaction.doChopWood(bot, say)
      case 'mine':
        return interaction.doMine(bot, say)
      default:
        console.log(`❓ Action không xác định: ${action}`)
        if (userControlActive && userControlActive()) return
        return idle.doIdle(bot, moodEngine)
    }
  } catch (e) {
    console.log(`❌ Lỗi khi thực thi action "${action}":`, e.message)
  }
}

module.exports = { executeAction }
