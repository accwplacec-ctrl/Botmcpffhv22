'use strict'

const { CONFIG } = require('./config')
const garden = require('./garden')

/**
 * proactive.js
 * ------------------------------------------------------------
 * Vong lap random interval (5-15 phut), CHI trigger callback khi
 * chu dang o trong vuon luc do. Neu chu khong o trong vuon, bo
 * qua luot nay va lich lai lan ke tiep (khong tich luy don).
 * ------------------------------------------------------------
 */

let timeoutHandle = null
let stopped = false

function randomDelay() {
  const { minIntervalMs, maxIntervalMs } = CONFIG.proactive
  return minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs)
}

function isOwnerInGarden(bot) {
  const owner = bot.players && bot.players[CONFIG.ownerName]
  if (!owner || !owner.entity) return false
  return garden.isInGarden(owner.entity.position)
}

/**
 * @param {object} bot - instance mineflayer
 * @param {function} onTrigger - callback async duoc goi khi den luot va chu dang trong vuon
 */
function start(bot, onTrigger) {
  stopped = false

  function scheduleNext() {
    if (stopped) return
    if (timeoutHandle) clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(async () => {
      try {
        if (isOwnerInGarden(bot)) {
          await onTrigger()
        }
      } catch (e) {
        console.log('❌ Lỗi trong vòng lặp proactive:', e.message)
      }
      scheduleNext()
    }, randomDelay())
  }

  scheduleNext()
}

function stop() {
  stopped = true
  if (timeoutHandle) {
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
}

module.exports = { start, stop }
