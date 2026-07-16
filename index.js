'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
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
  return bot.inventory.items()
    .filter((i) => i.name === 'wheat')
    .reduce((sum, i) => sum + i.count, 0)
}

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
  bot.on('kicked', (reason) => console.log('👢 Bị kick:', reason))
  bot.on('error', (err) => console.log('❌ Lỗi:', err?.message || err))
  bot.on('end', onEnd)
}

// ====================== ONSPAWN TỐI ƯU CHO ATERNOS ======================
async function onSpawn() {
  console.log('✅ Ông Tư đã vào vườn.');
  reconnectAttempts = 0;

  // Tắt physics để tránh invalid movement
  bot.physicsEnabled = false;
  try { bot.pathfinder.setGoal(null); } catch (e) {}

  console.log('⏳ Chờ chunk load 15 giây (Aternos)...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  if (!bot || !bot.entity) return;

  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(movements);

  bot.physicsEnabled = true;

  await memory.init();
  moodEngine.resetSession();
  moodEngine.startEngine(bot);

  startFarmingLoop();
  startAffectionDecayLoop();
  startWorkingMemorySweep();

  proactive.start(bot, () => runBrainTurn('proactive', null));
  console.log('🚀 Ông Tư sẵn sàng!');
}
// =====================================================================

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
  console.log(`⏳ Kết nối lại sau ${Math.round(delay/1000)}s (lần ${reconnectAttempts})...`);
  setTimeout(connect, delay);
}

function stopAllLoops() {
  [farmingTickHandle, affectionDecayHandle, workingMemorySweepHandle].forEach(h => {
    if (h) clearInterval(h);
  });
}

// =================== CÁC HÀM CÒN LẠI (giữ nguyên) ===================
function onDeath() {
  let reason = 'không rõ';
  try { if (bot.lastDamageSource) reason = String(bot.lastDamageSource); } catch(e){}
  console.log(`☠️ Ông Tư chết: ${reason}`);
  memory.recordDeath(reason);
}

function onBlockUpdate(oldBlock, newBlock) { /* code cũ của bạn */ }
function onPlayerCollect(collector, collected) { /* code cũ */ }
async function onChat(username, message) { /* code cũ */ }
async function runBrainTurn(mode, userMessage) { /* code cũ */ }
async function executeAction(action) { /* code cũ */ }
function doIdle() { /* code cũ */ }
async function doWander() { /* code cũ */ }
// ... (doSit, doRest, doWave, doLookOwner, doAvoidOwner, doAvoidMonster, startFarmingLoop, v.v.)

connect();
