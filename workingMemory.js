'use strict'

/**
 * workingMemory.js
 * ------------------------------------------------------------
 * Tri nho ngan han: cac "flag" tam thoi (vd "ruong_bi_pha") duoc
 * theo doi hoan toan trong RAM, moi flag tu dong het han sau mot
 * khoang TTL (mac dinh 10-15 phut) va KHONG bao gio duoc ghi
 * xuong Firebase.
 * ------------------------------------------------------------
 */

// Map: key -> { expiresAt, data }
const flags = new Map()

const DEFAULT_TTL_MS = 12 * 60 * 1000 // 12 phut (trong khoang 10-15 phut yeu cau)

function setFlag(key, ttlMs = DEFAULT_TTL_MS, data = true) {
  flags.set(key, { expiresAt: Date.now() + ttlMs, data })
}

function clearFlag(key) {
  flags.delete(key)
}

function hasFlag(key) {
  const entry = flags.get(key)
  if (!entry) return false
  if (Date.now() > entry.expiresAt) {
    flags.delete(key)
    return false
  }
  return true
}

function getFlagData(key) {
  const entry = flags.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    flags.delete(key)
    return null
  }
  return entry.data
}

// Tra ve danh sach cac flag dang con hieu luc (da tu loc bo flag het han)
function getActiveFlags() {
  const now = Date.now()
  const active = {}
  for (const [key, entry] of flags.entries()) {
    if (now > entry.expiresAt) {
      flags.delete(key)
      continue
    }
    active[key] = entry.data
  }
  return active
}

// Don dep dinh ky (goi tu index.js qua setInterval, khong bat buoc vi getActiveFlags/hasFlag
// da tu loc, nhung giup tranh Map phinh to neu co nhieu flag it duoc doc lai)
function sweepExpired() {
  const now = Date.now()
  for (const [key, entry] of flags.entries()) {
    if (now > entry.expiresAt) flags.delete(key)
  }
}

module.exports = {
  setFlag,
  clearFlag,
  hasFlag,
  getFlagData,
  getActiveFlags,
  sweepExpired,
}
