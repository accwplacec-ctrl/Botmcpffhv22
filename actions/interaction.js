'use strict'
const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const { Vec3 } = require('vec3')

async function doTill(bot, garden, moodEngine) {
  const hoe = bot.inventory.items().find((i) => /_hoe$/.test(i.name))
  if (!hoe) return
  const grassBlock = bot.findBlock({
    matching: (block) => block.name === 'grass_block' && garden.isInGarden(block.position),
    maxDistance: 32,
  })
  if (!grassBlock) return
  try {
    await bot.pathfinder.goto(new GoalNear(grassBlock.position.x, grassBlock.position.y, grassBlock.position.z, 2))
    await bot.equip(hoe, 'hand')
    await bot.activateBlock(grassBlock)
    moodEngine.notifyFarmAction()
  } catch (e) { console.log('❌ Lỗi khi cày đất:', e.message) }
}

async function doPlant(bot, garden, moodEngine) {
  const seeds = bot.inventory.items().find((i) => i.name === 'wheat_seeds')
  if (!seeds) return
  const farmland = bot.findBlock({
    matching: (block) => block.name === 'farmland' && garden.isInGarden(block.position),
    maxDistance: 32,
    point: bot.entity.position,
    useExtraInfo: (block) => {
      const above = bot.blockAt(block.position.offset(0, 1, 0))
      return above && above.name === 'air'
    },
  })
  if (!farmland) return
  try {
    await bot.pathfinder.goto(new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2))
    await bot.equip(seeds, 'hand')
    await bot.placeBlock(farmland, new Vec3(0, 1, 0))
    moodEngine.notifyFarmAction()
  } catch (e) { console.log('❌ Lỗi khi trồng hạt giống:', e.message) }
}

async function doHarvest(bot, garden, moodEngine, memory, maybeAutoDeliverGift) {
  const ripe = bot.findBlock({
    matching: (block) => block.name === 'wheat' && block.metadata === 7 && garden.isInGarden(block.position),
    maxDistance: 32,
  })
  if (!ripe) return
  try {
    await bot.pathfinder.goto(new GoalNear(ripe.position.x, ripe.position.y, ripe.position.z, 2))
    await bot.dig(ripe)
    moodEngine.notifyFarmAction()
    moodEngine.addHappyOnHarvest()
    memory.addWheatSinceLastGift(1)
    await maybeAutoDeliverGift()
  } catch (e) { console.log('❌ Lỗi khi thu hoạch:', e.message) }
}

async function doDeliverGift(bot, CONFIG, memory, rag, say) {
  const wheatCount = bot.inventory.items().filter((i) => i.name === 'wheat').reduce((s, i) => s + i.count, 0)
  if (wheatCount <= 0) return
  const dropPoint = CONFIG.giftDropPoint
  try {
    await bot.pathfinder.goto(new GoalNear(dropPoint.x, dropPoint.y, dropPoint.z, 2))
    const wheatItem = bot.inventory.items().find((i) => i.name === 'wheat')
    if (!wheatItem) return
    const total = wheatCount
    await bot.toss(wheatItem.type, null, total)
    const milestone = memory.addWheatGifted(total)
    say(`Ta để dành được ${total} bó lúa mì, mang ra đây tặng Vân Thiên đó.`)
    if (rag) {
      rag.addDocument(`[SỰ KIỆN] Bot đã tặng ${total} lúa mì cho Vân Thiên`, {
        type: 'deliver_gift', count: total, milestone: milestone || null, timestamp: Date.now()
      }).catch(err => console.error('[RAG] Lỗi lưu sự kiện tặng lúa:', err))
    }
    if (milestone) {
      say(`Ấy chà, vậy là ta đã tặng Vân Thiên tròn ${milestone} bó lúa mì rồi đó, con nhớ giữ sức khoẻ mà làm ăn nghen.`)
    }
  } catch (e) { console.log('❌ Lỗi khi tặng quà:', e.message) }
}

module.exports = { doTill, doPlant, doHarvest, doDeliverGift }
