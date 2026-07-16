'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock } = goals
const { Vec3 } = require('vec3')

const { CONFIG, validateConfig } = require('./config')
const firebaseModule = require('./firebase')
const memory = require('./memory')
const workingMemory = require('./workingMemory')
const moodEngine = require('./moodEngine')
const persona = require('./persona')
const brain = require('./brain')
const garden = require('./garden')
const proactive = require('./proactive')

for (const w of validateConfig()) console.log(`⚠️ ${w}`)

let bot = null
let reconnectAttempts = 0
let shuttingDown = false

let farmingTickHandle = null
let affectionDecayHandle = null
let workingMemorySweepHandle = null
let brainCallInFlight = false

function say(message) {
  if (!bot || !message) return
  try {
    bot.chat(String(message).slice(0, 250))
  } catch (e) {
    console.log('❌ Lỗi khi chat:', e.message)
  }
}

function getOwnerEntity() {
  if (!bot) return null
  const p = bot.players && bot.players[CONFIG.ownerName]
  return p && p.entity ? p.entity : null
}

function countWheatInInventory() {
  if (!bot) return 0
  return bot.inventory
    .items()
    .filter((i) => i.name === 'wheat')
    .reduce((sum, i) => sum + i.count, 0)
}

// ===== Ket noi =====
function connect() {
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    username: CONFIG.server.username,
    version: CONFIG.server.version,
    auth: CONFIG.server.auth,
    checkTimeoutInterval: 60000,
  })

  bot.loadPlugin(pathfinder)
  registerEvents()
}

function registerEvents() {
  bot.once('spawn', onSpawn)
  bot.on('chat', onChat)
  bot.on('death', onDeath)
  bot.on('blockUpdate', onBlockUpdate)
  bot.on('playerCollect', onPlayerCollect)
  bot.on('kicked', (reason) => console.log('👢 Bị kick khỏi server:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi bot:', err && err.message ? err.message : err))
  bot.on('end', onEnd)
}

// ===== ON SPAWN - DA TOI UU CHO ATERNOS =====
async function onSpawn() {
  console.log('✅ Ông Tư đã vào vườn.');
  reconnectAttempts = 0;

  // FIX ATERNOS: Tắt physics ngay để tránh invalid movement
  try {
    bot.physicsEnabled = false;
    bot.pathfinder.setGoal(null);
  } catch (e) {}

  // Chờ chunk load (9 giây)
  console.log('⏳ Đang chờ chunk load (9 giây)...');
  await new Promise((resolve) => setTimeout(resolve, 9000));

  if (!bot || !bot.entity) return;

  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(movements);

  // Bật lại physics
  bot.physicsEnabled = true;

  await memory.init();
  moodEngine.resetSession();
  moodEngine.startEngine(bot);

  startFarmingLoop();
  startAffectionDecayLoop();
  startWorkingMemorySweep();

  proactive.start(bot, () => runBrainTurn('proactive', null));

  console.log('🚀 Ông Tư đã sẵn sàng hoạt động.');
}

function onEnd(reason) {
  console.log('🔌 Mất kết nối:', reason || '');
  stopAllLoops();
  proactive.stop();
  moodEngine.stopEngine();
  bot = null;
  if (!shuttingDown) scheduleReconnect();
}

function scheduleReconnect() {
  const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 120000);
  reconnectAttempts++;
  console.log(`⏳ Kết nối lại sau ${Math.round(delay / 1000)}s (lần ${reconnectAttempts})...`);
  setTimeout(connect, delay);
}

function stopAllLoops() {
  if (farmingTickHandle) clearInterval(farmingTickHandle);
  if (affectionDecayHandle) clearInterval(affectionDecayHandle);
  if (workingMemorySweepHandle) clearInterval(workingMemorySweepHandle);
  farmingTickHandle = null;
  affectionDecayHandle = null;
  workingMemorySweepHandle = null;
}

// Các hàm còn lại giữ nguyên (onDeath, onBlockUpdate, onPlayerCollect, onChat, runBrainTurn, executeAction...)

function onDeath() { /* ... giữ nguyên code cũ ... */ }
function onBlockUpdate(oldBlock, newBlock) { /* ... */ }
function onPlayerCollect(collector, collected) { /* ... */ }
async function onChat(username, message) { /* ... */ }
async function runBrainTurn(mode, userMessage) { /* ... */ }
async function executeAction(action) { /* ... */ }
// ... (các hàm doIdle, doWander, ... giữ nguyên)

function startFarmingLoop() { /* code cũ */ }
function startAffectionDecayLoop() { /* code cũ */ }
function startWorkingMemorySweep() { /* code cũ */ }

connect();
