'use strict'
const { goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock } = goals
const { Vec3 } = require('vec3')

// Quét bán kính 2 quanh vị trí bot, tìm 1 ô đi được (chân+đầu trống, có nền)
// ưu tiên theo hướng đang cần tới đích, để bước tạm ra khỏi kẹt cục bộ.
async function tryEscapeStuck(bot, targetX, targetZ) {
  const pos = bot.entity.position.floored()
  const dirX = Math.sign(targetX - pos.x)
  const dirZ = Math.sign(targetZ - pos.z)

  const candidates = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue
      candidates.push({ dx, dz, score: dx * dirX + dz * dirZ })
    }
  }
  candidates.sort((a, b) => b.score - a.score)

  for (const c of candidates) {
    const x = pos.x + c.dx
    const y = pos.y
    const z = pos.z + c.dz

    const feet = bot.blockAt(new Vec3(x, y, z))
    const head = bot.blockAt(new Vec3(x, y + 1, z))
    const ground = bot.blockAt(new Vec3(x, y - 1, z))

    const isEmpty = (b) => b && (b.boundingBox === 'empty')
    const isSolid = (b) => b && (b.boundingBox === 'block')

    if (isEmpty(feet) && isEmpty(head) && isSolid(ground)) {
      try {
        await bot.pathfinder.goto(new GoalBlock(x, y, z))
        console.log(`🩹 [ESCAPE] Thoát kẹt thành công tới (${x}, ${y}, ${z})`)
        return true
      } catch (e) {
        continue
      }
    }
  }
  console.log('🩹 [ESCAPE] Không tìm được ô nào để thoát kẹt')
  return false
}

// Timeout thủ công cho pathfinder — khi hết giờ, thử escape trước khi bỏ cuộc hẳn.
function gotoWithTimeout(bot, goal, timeoutMs = 15000) {
  console.log(`🚶 [PATHFINDER] Bắt đầu goto → goal: x=${goal.x}, y=${goal.y}, z=${goal.z}, bot đang ở: ${bot.entity.position}`)
  return new Promise((resolve, reject) => {
    let done = false

    const timer = setTimeout(async () => {
      if (done) return
      done = true
      console.log(`⏱️ [PATHFINDER] TIMEOUT sau ${timeoutMs}ms — bot ở: ${bot.entity.position}, isMoving: ${bot.pathfinder.isMoving ? bot.pathfinder.isMoving() : 'unknown'}`)
      try { bot.pathfinder.setGoal(null) } catch (e) {}

      let escaped = false
      try {
        escaped = await tryEscapeStuck(bot, goal.x, goal.z)
      } catch (e) {
        escaped = false
      }

      if (escaped) {
        // Escape xong, thử lại goal gốc 1 lần nữa với thời gian ngắn hơn
        bot.pathfinder.goto(goal).then(() => {
          console.log(`✅ [PATHFINDER] Sau escape, tới đích thành công, bot ở: ${bot.entity.position}`)
          resolve()
        }).catch((e) => {
          console.log(`❌ [PATHFINDER] Sau escape vẫn không tới được: ${e.message}`)
          reject(new Error('timeout: pathfinder bị kẹt/chặn quá lâu, escape không đủ để tới đích'))
        })
      } else {
        reject(new Error('timeout: pathfinder bị kẹt/chặn quá lâu, escape thất bại'))
      }
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
  const targetY = y != null ? y : bot.entity.position.y
  const ok = await gotoWithRetry(bot, x, targetY, z, say, 15000)
  if (ok && say) say('tới nơi rồi đó')
}

module.exports = { doWander, doRest, doLookOwner, doGoto, gotoWithTimeout, gotoWithRetry, tryEscapeStuck }
