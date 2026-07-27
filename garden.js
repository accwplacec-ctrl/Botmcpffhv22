// garden.js
const Vec3 = require('vec3');

function isInGarden(position, center, radius) {
  if (!position || !center) return false;
  
  const dx = position.x - center.x;
  const dz = position.z - center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  return dist <= radius;
}

function getRandomGardenPosition(center, radius) {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * radius * 0.8; // 80% của radius để không ra ngoài
  return {
    x: center.x + Math.cos(angle) * dist,
    z: center.z + Math.sin(angle) * dist
  };
}

function getClosestFarmland(bot, center, radius) {
  if (!bot) return null;
  
  try {
    const blocks = bot.findBlocks({
      matching: ['farmland'],
      maxDistance: radius,
      count: 20
    });
    
    if (!blocks || blocks.length === 0) return null;
    
    // Sắp xếp theo khoảng cách
    const sorted = blocks.map(pos => {
      const dist = bot.entity.position.distanceTo(pos);
      return { pos, dist };
    }).sort((a, b) => a.dist - b.dist);
    
    return sorted[0].pos;
  } catch (error) {
    return null;
  }
}

function countWheatAround(bot, radius = 5) {
  if (!bot) return 0;
  
  try {
    const blocks = bot.findBlocks({
      matching: ['wheat'],
      maxDistance: radius,
      count: 50
    });
    return blocks.length;
  } catch (error) {
    return 0;
  }
}

function countReadyWheat(bot, radius = 5) {
  if (!bot) return 0;
  
  try {
    const blocks = bot.findBlocks({
      matching: ['wheat'],
      maxDistance: radius,
      count: 50
    });
    
    let ready = 0;
    for (const pos of blocks) {
      const block = bot.blockAt(pos);
      if (block && block.metadata === 7) {
        ready++;
      }
    }
    return ready;
  } catch (error) {
    return 0;
  }
}

module.exports = {
  isInGarden,
  getRandomGardenPosition,
  getClosestFarmland,
  countWheatAround,
  countReadyWheat
};
