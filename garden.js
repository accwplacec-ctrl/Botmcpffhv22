'use strict'

const { Vec3 } = require('vec3')
const { CONFIG } = require('./config')

/**
 * garden.js
 * ------------------------------------------------------------
 * Tien ich lien quan den bounding box khu vuon: kiem tra vi tri
 * co nam trong vuon khong, gioi han (clamp) 1 diem ve trong vuon,
 * sinh ngau nhien 1 diem trong vuon (dung cho wander).
 * ------------------------------------------------------------
 */

function bounds() {
  const g = CONFIG.garden
  return {
    minX: Math.min(g.minX, g.maxX),
    maxX: Math.max(g.minX, g.maxX),
    minZ: Math.min(g.minZ, g.maxZ),
    maxZ: Math.max(g.minZ, g.maxZ),
    yMin: g.yMin,
    yMax: g.yMax,
  }
}

function isInGarden(pos) {
  if (!pos) return false
  const b = bounds()
  return (
    pos.x >= b.minX &&
    pos.x <= b.maxX &&
    pos.z >= b.minZ &&
    pos.z <= b.maxZ &&
    pos.y >= b.yMin &&
    pos.y <= b.yMax
  )
}

function clampToGarden(pos) {
  const b = bounds()
  return {
    x: Math.max(b.minX, Math.min(b.maxX, pos.x)),
    y: Math.max(b.yMin, Math.min(b.yMax, pos.y)),
    z: Math.max(b.minZ, Math.min(b.maxZ, pos.z)),
  }
}

// Sinh 1 diem (x, z) ngau nhien trong vuon; y se duoc do gioi han (groundY) o noi goi (index.js)
function randomPointInGarden() {
  const b = bounds()
  const x = b.minX + Math.random() * (b.maxX - b.minX)
  const z = b.minZ + Math.random() * (b.maxZ - b.minZ)
  return { x, z }
}

// Tim do cao mat dat gan nhat tai (x, z) bang cach do tu tren xuong trong pham vi vuon
// Tra ve null neu khong tim thay block ran nao (an toan de bo qua diem nay)
function findGroundY(bot, x, z) {
  const b = bounds()
  const startY = Math.min(b.yMax, Math.floor(bot.entity.position.y) + 5)
  for (let y = startY; y >= b.yMin; y--) {
    const block = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)))
    if (block && block.boundingBox === 'block') {
      return y + 1
    }
  }
  return null
}

module.exports = { bounds, isInGarden, clampToGarden, randomPointInGarden, findGroundY }
