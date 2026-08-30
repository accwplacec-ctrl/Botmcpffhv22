'use strict'

const pathing = require('../pathing')

function doWander(bot, garden, moodEngine) {
  moodEngine.notifyRestOrIdle()
  if (pathing.isPathing(bot)) return
  const point = pathing.pickWanderTarget(bot, garden, 14)
  if (!point) {
    console.log('⚠️ Wander: không chọn được điểm đi (vườn / chunk / mặt đất)')
    return
  }
  return pathing.goTo(bot, point.x, point.y, point.z, {
    range: 2,
    style: 'farm',
    label: 'wander',
    searchRadius: 32,
    thinkTimeout: 2500,
    timeoutMs: 20000,
  })
}

async function doRest(bot, moodEngine) {
  moodEngine.notifyRestOrIdle()
  try {
    pathing.stop(bot)
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

function doStop(bot, say) {
  pathing.stop(bot, { say })
}

async function doGoto(bot, x, y, z, say) {
  if (!bot || !bot.entity) return
  if (x == null || z == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
    console.log('⚠️ Goto thiếu tọa độ', { x, y, z })
    if (say) say('toạ độ gì đâu mà đi')
    return
  }
  if (say) say(`ok t đi ${Math.round(Number(x))} ${y != null ? Math.round(Number(y)) : '~'} ${Math.round(Number(z))}`)
  await pathing.goTo(bot, x, y, z, {
    range: 2,
    style: 'travel',
    label: 'goto',
    say,
    announce: true,
  })
}

function doFollow(bot, entity, say) {
  return pathing.follow(bot, entity, { say, range: 3 })
}

async function doComeTo(bot, entity, say) {
  if (!entity || !entity.position) {
    console.log('⚠️ Come: không thấy người gọi')
    if (say) say('k thấy mày, lại gần t cái')
    return
  }
  const p = entity.position
  if (say) say('ok t ra liền')
  return pathing.goTo(bot, p.x, p.y, p.z, {
    range: 2,
    style: 'travel',
    label: 'come',
    say,
    announce: true,
  })
}

module.exports = { doWander, doRest, doLookOwner, doGoto, doStop, doFollow, doComeTo }
