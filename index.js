// ============================================
// MINECRAFT BOT - FIX RENDER DEPLOY & CHUNK LOAD
// ============================================

import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pathfinderPkg;
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import http from 'http'; // ⭐ HTTP server giả cho Render

// ============================================
// ⭐ HTTP SERVER GIẢ - GIÚP RENDER KHÔNG STUCK
// ============================================
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft Bot is running\n');
}).listen(PORT, () => {
  console.log(`[HTTP] Health check server on port ${PORT}`);
});

// ============================================
// CẤU HÌNH
// ============================================
const CONFIG = {
  SERVER_IP: 'jjjggdffgg.aternos.me',
  SERVER_PORT: 34242,
  BOT_USERNAME: 'SmartBot',
  AUTH: 'offline',
  VERSION: '1.21.4',
  
  PATHFINDER_TIMEOUT: 15000,
  STUCK_THRESHOLD: 10,
  GOAL_RANGE: 2,
  RECONNECT_DELAY: 5000,
  ANTI_AFK_INTERVAL: 30000,
  CHUNK_LOAD_WAIT: 3000,      // ⭐ Đợi chunk load (ms)
};

// ============================================
// CLASS BOT
// ============================================
class MinecraftBot {
  constructor() {
    this.bot = null;
    this.mcData = null;
    this.movements = null;
    this.timers = new Map();
    this.isMoving = false;
    this.isFollowing = false;
    this.followTarget = null;
    this.moveStartTime = 0;
    this.lastPos = null;
    this.stuckCounter = 0;
    this.pendingGoal = null;
    this.chunkLoadAttempts = 0; // ⭐ Đếm số lần thử load chunk
    this.stats = { connects: 0, commands: 0, pathsCompleted: 0, pathsFailed: 0 };
  }

  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', path: '📍' };
    console.log(`[${time}] ${icons[type] || '•'} ${msg}`);
  }

  connect() {
    this.log(`Đang kết nối ${CONFIG.SERVER_IP}:${CONFIG.SERVER_PORT}...`);
    this.bot = mineflayer.createBot({
      host: CONFIG.SERVER_IP,
      port: CONFIG.SERVER_PORT,
      username: CONFIG.BOT_USERNAME,
      auth: CONFIG.AUTH,
      version: CONFIG.VERSION,
      viewDistance: 'far',      // ⭐ Load chunk xa nhất có thể
      chatLengthLimit: 256,
    });
    this.bot.loadPlugin(pathfinder);
    this.stats.connects++;
    this.setupEvents();
  }

  setupEvents() {
    this.bot.once('spawn', () => this.onSpawn());
    this.bot.on('chat', (u, m) => this.onChat(u, m));
    this.bot.on('goal_reached', () => this.onGoalReached());
    this.bot.on('path_stop', () => this.onPathStop());
    this.bot.on('death', () => this.onDeath());
    this.bot.on('respawn', () => this.onRespawn());
    this.bot.on('kicked', (r) => this.onKicked(r));
    this.bot.on('end', () => this.onEnd());
    this.bot.on('error', (e) => this.onError(e));
  }

  // ============================================
  // ⭐ SPAWN: ĐỢI CHUNK LOAD TRƯỚC KHI HOẠT ĐỘNG
  // ============================================
  async onSpawn() {
    this.log(`Bot đã vào game!`, 'success');
    
    // ⭐ ĐỢI CHUNK LOAD: Đảm bảo bot nhìn thấy thế giới xung quanh
    this.log('Đang load chunk xung quanh...');
    try {
      await this.bot.waitForChunksToLoad();
    } catch (e) {
      this.log('Không đợi được chunk, tiếp tục anyway', 'warn');
    }
    await this.sleep(CONFIG.CHUNK_LOAD_WAIT);
    
    this.mcData = minecraftData(this.bot.version);
    this.configureMovements();
    
    this.bot.pathfinder.thinkTimeout = CONFIG.PATHFINDER_TIMEOUT;
    this.bot.pathfinder.tickTimeout = 40;
    
    this.startAntiAfk();
    this.startSmartJump();
    
    setTimeout(() => {
      if (this.bot?.entity) this.bot.chat('🤖 Bot sẵn sàng! Gõ !bot help');
    }, 3000);
  }

  configureMovements() {
    this.movements = new Movements(this.bot, this.mcData);
    
    this.movements.canDig = true;
    this.movements.digCost = 10;
    this.movements.canPlaceOnBreak = true;
    this.movements.allow1by1towers = true;
    this.movements.allowFreeMotion = true;
    this.movements.allowParkour = false;
    this.movements.allowSprinting = true;
    
    this.movements.maxDropDown = 3;
    this.movements.liquidCost = 10;
    this.movements.scafoldingBlocks = [];
    
    const avoid = ['lava', 'fire', 'soul_fire', 'sweet_berry_bush', 'cactus'];
    avoid.forEach(name => {
      const b = this.mcData.blocksByName[name];
      if (b) this.movements.blocksToAvoid.add(b.id);
    });
    
    this.bot.pathfinder.setMovements(this.movements);
    this.log('Movements OK (viewDistance: far)', 'success');
  }

  // ============================================
  // ⭐ TỰ NHẢY KHI GẶP BLOCK
  // ============================================
  startSmartJump() {
    this.bot.on('physicsTick', () => {
      if (!this.isMoving && !this.isFollowing) return;
      if (!this.bot?.entity?.onGround) return;
      
      const yaw = this.bot.entity.yaw;
      const px = this.bot.entity.position.x + Math.sin(yaw) * 1.3;
      const py = this.bot.entity.position.y + 1;
      const pz = this.bot.entity.position.z + Math.cos(yaw) * 1.3;
      
      const blockFront = this.bot.blockAt(new Vec3(px, py, pz));
      const blockFeet = this.bot.blockAt(new Vec3(px, py - 1, pz));
      
      if (blockFront && blockFront.boundingBox === 'block' && 
          blockFeet && blockFeet.boundingBox === 'block') {
        
        const blockTop = this.bot.blockAt(new Vec3(px, py + 1, pz));
        if (!blockTop || blockTop.boundingBox !== 'block') {
          this.bot.setControlState('jump', true);
          setTimeout(() => this.bot.setControlState('jump', false), 250);
        }
      }
    });
  }

  // ============================================
  // CHAT & LỆNH
  // ============================================
  onChat(username, message) {
    if (username === CONFIG.BOT_USERNAME) return;
    const msg = message.trim();
    if (!msg.startsWith('!bot ')) return;
    
    this.stats.commands++;
    const args = msg.slice(5).trim().split(/\s+/);
    const cmd = args[0].toLowerCase();

    switch (cmd) {
      case 'đi':
        if (args[1] === 'tới') this.cmdGoto(args.slice(2), username);
        else this.bot.chat('❓ !bot đi tới <x> <y> <z>');
        break;
      case 'goto':
        this.cmdGoto(args.slice(1), username);
        break;
      case 'come':
        this.cmdCome(args[1], username);
        break;
      case 'follow':
        this.cmdFollow(args[1], username);
        break;
      case 'dừng':
      case 'stop':
      case 'unfollow':
        this.cmdStop();
        break;
      case 'info':
        this.cmdInfo();
        break;
      case 'stats':
        this.cmdStats();
        break;
      case 'dig':
        this.toggleDig();
        break;
      case 'help':
      case 'giúp':
        this.cmdHelp();
        break;
      default:
        this.bot.chat('❓ Lệnh không hợp lệ. Gõ !bot help');
    }
  }

  cmdGoto(args, requester) {
    if (args.length < 3) {
      this.bot.chat('⚠️ Thiếu tọa độ! !bot goto <x> <y> <z>');
      return;
    }
    const x = parseFloat(args[0]), y = parseFloat(args[1]), z = parseFloat(args[2]);
    if ([x,y,z].some(isNaN)) {
      this.bot.chat('❌ Tọa độ phải là số!');
      return;
    }
    this.stopAllMovement();
    this.chunkLoadAttempts = 0;
    this.log(`Đi tới ${x} ${y} ${z}`, 'path');
    
    const goal = new goals.GoalNear(x, y, z, CONFIG.GOAL_RANGE);
    this.startPathfinding(goal, `🚶 Đang đi tới ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}...`);
  }

  cmdCome(targetName, requester) {
    const name = targetName || requester;
    const target = this.bot.players[name]?.entity;
    if (!target) { this.bot.chat(`❌ Không thấy ${name}`); return; }
    
    this.stopAllMovement();
    this.chunkLoadAttempts = 0;
    const pos = target.position;
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
    this.startPathfinding(goal, `🚶 Đang đến chỗ ${name}...`);
  }

  cmdFollow(targetName, requester) {
    const name = targetName || requester;
    const target = this.bot.players[name]?.entity;
    if (!target) { this.bot.chat(`❌ Không thấy ${name}`); return; }
    
    this.stopAllMovement();
    this.isFollowing = true;
    this.followTarget = name;
    this.bot.chat(`👀 Theo ${name}... (!bot stop để dừng)`);
    
    const goal = new goals.GoalFollow(target, 2);
    this.bot.pathfinder.setGoal(goal, true);
  }

  cmdStop() {
    const was = this.isMoving || this.isFollowing;
    this.stopAllMovement();
    this.bot.chat(was ? '🛑 Đã dừng!' : 'ℹ️ Bot đang đứng yên.');
  }

  cmdInfo() {
    const p = this.bot.entity.position;
    this.bot.chat(`📍 X=${Math.floor(p.x)} Y=${Math.floor(p.y)} Z=${Math.floor(p.z)} | ❤️${Math.floor(this.bot.health)} 🍗${Math.floor(this.bot.food)}`);
  }

  cmdStats() {
    this.bot.chat(`📊 Kết nối:${this.stats.connects} | Lệnh:${this.stats.commands} | OK:${this.stats.pathsCompleted} | Lỗi:${this.stats.pathsFailed}`);
  }

  toggleDig() {
    this.movements.canDig = !this.movements.canDig;
    this.bot.pathfinder.setMovements(this.movements);
    this.bot.chat(this.movements.canDig ? '⛏️ Tự đào: BẬT' : '⛏️ Tự đào: TẮT');
  }

  cmdHelp() {
    [
      '!bot goto <x> <y> <z> - Đi tới tọa độ',
      '!bot come [tên] - Đến chỗ người chơi',
      '!bot follow [tên] - Theo sau người chơi',
      '!bot stop - Dừng ngay',
      '!bot info - Tọa độ & máu',
      '!bot dig - Bật/tắt tự đào block',
      '!bot stats - Thống kê',
    ].forEach((h, i) => setTimeout(() => this.bot.chat(h), i * 400));
  }

  // ============================================
  // PATHFINDING
  // ============================================
  startPathfinding(goal, msg) {
    this.isMoving = true;
    this.moveStartTime = Date.now();
    this.stuckCounter = 0;
    this.lastPos = this.bot.entity.position.clone();
    this.pendingGoal = goal;
    
    this.bot.chat(msg);
    this.bot.pathfinder.setGoal(goal);
    this.startStuckMonitor();
  }

  startStuckMonitor() {
    this.clearTimer('stuck');
    this.timers.set('stuck', setInterval(() => {
      if (!this.isMoving || !this.bot?.entity) return;
      
      const cur = this.bot.entity.position;
      const dist = cur.distanceTo(this.lastPos);
      
      if (dist < 0.3) {
        this.stuckCounter++;
        this.log(`Bị kẹt ${this.stuckCounter}s`, 'warn');
        
        if (this.stuckCounter === 2) this.attemptUnstuck();
        else if (this.stuckCounter >= CONFIG.STUCK_THRESHOLD) {
          this.log('Kẹt quá lâu -> Hủy', 'error');
          this.stopAllMovement();
          this.stats.pathsFailed++;
          this.bot.chat('❌ Kẹt đường! Không đi được.');
        }
      } else {
        this.stuckCounter = 0;
        this.chunkLoadAttempts = 0; // Reset khi đang di chuyển tốt
      }
      this.lastPos = cur.clone();
    }, 1000));
  }

  // ============================================
  // ⭐ THOÁT KẸT + LOAD CHUNK XUNG QUANH
  // ============================================
  async attemptUnstuck() {
    this.chunkLoadAttempts++;
    this.log(`Thoát kẹt lần ${this.chunkLoadAttempts}...`, 'warn');
    
    // ⭐ CÁCH 1: Nhảy + đi tới
    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);
    
    // ⭐ CÁCH 2: Xoay nhìn xung quanh để server gửi thêm chunk
    // Bot nhìn trái, phải, trên, dưới -> trigger server load chunk
    const looks = [
      { yaw: 0, pitch: 0 },
      { yaw: Math.PI / 2, pitch: 0 },
      { yaw: Math.PI, pitch: 0 },
      { yaw: -Math.PI / 2, pitch: 0 },
      { yaw: 0, pitch: -Math.PI / 4 }, // Nhìn lên
      { yaw: 0, pitch: Math.PI / 4 },  // Nhìn xuống
    ];
    
    for (const look of looks) {
      this.bot.look(this.bot.entity.yaw + look.yaw, look.pitch, true);
      await this.sleep(200);
    }
    
    // ⭐ CÁCH 3: Nếu kẹt nhiều lần, thử đi lùi để load chunk phía sau rồi tính lại đường
    if (this.chunkLoadAttempts >= 2) {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('back', true);
      await this.sleep(500);
      this.bot.setControlState('back', false);
      
      // ⭐ CÁCH 4: Đợi chunk load lại rồi reset goal
      this.log('Đợi chunk load lại...', 'warn');
      try { await this.bot.waitForChunksToLoad(); } catch(e) {}
      await this.sleep(1000);
      
      // Reset lại pathfinding với cùng goal để tính lại đường
      if (this.pendingGoal && this.isMoving) {
        this.log('Tính lại đường đi...', 'path');
        this.bot.pathfinder.setGoal(null);
        await this.sleep(500);
        this.bot.pathfinder.setGoal(this.pendingGoal);
        this.stuckCounter = 0;
      }
    }
    
    setTimeout(() => {
      this.bot.setControlState('jump', false);
      this.bot.setControlState('forward', false);
    }, 600);
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  onGoalReached() {
    if (!this.isMoving) return;
    this.stopAllMovement();
    this.stats.pathsCompleted++;
    this.pendingGoal = null;
    this.chunkLoadAttempts = 0;
    this.bot.chat('✅ Đã đến nơi!');
  }

  onPathStop() {
    if (!this.isMoving) return;
    this.stopAllMovement();
    this.stats.pathsFailed++;
    this.pendingGoal = null;
    this.chunkLoadAttempts = 0;
    this.bot.chat('❌ Không tìm được đường!');
  }

  onDeath() {
    this.log('Bot chết!', 'error');
    this.stopAllMovement();
    this.bot.chat('💀 Chết rồi...');
  }

  onRespawn() {
    this.log('Hồi sinh', 'success');
    setTimeout(() => {
      this.configureMovements();
      this.pendingGoal = null;
      this.chunkLoadAttempts = 0;
    }, 1000);
  }

  stopAllMovement() {
    this.isMoving = false;
    this.isFollowing = false;
    this.followTarget = null;
    this.pendingGoal = null;
    this.stuckCounter = 0;
    
    if (this.bot?.pathfinder) this.bot.pathfinder.setGoal(null);
    if (this.bot) {
      ['forward', 'back', 'left', 'right', 'jump', 'sprint'].forEach(c => 
        this.bot.setControlState(c, false)
      );
    }
    this.clearTimer('stuck');
  }

  startAntiAfk() {
    this.clearTimer('afk');
    this.timers.set('afk', setInterval(() => {
      if (this.isMoving || this.isFollowing) return;
      if (this.bot?.entity) this.bot.look(this.bot.entity.yaw + 0.5, this.bot.entity.pitch, true);
    }, CONFIG.ANTI_AFK_INTERVAL));
  }

  onKicked(reason) {
    const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    this.log(`Kick: ${reasonStr}`, 'error');
    this.cleanup();
    this.scheduleReconnect();
  }

  onEnd() {
    this.log('Mất kết nối', 'warn');
    this.cleanup();
    this.scheduleReconnect();
  }

  onError(e) {
    this.log(`Lỗi: ${e.message}`, 'error');
  }

  scheduleReconnect() {
    if (this.timers.has('reconnect')) return;
    this.log(`Reconnect sau ${CONFIG.RECONNECT_DELAY/1000}s...`);
    this.timers.set('reconnect', setTimeout(() => {
      this.timers.delete('reconnect');
      this.connect();
    }, CONFIG.RECONNECT_DELAY));
  }

  cleanup() {
    this.stopAllMovement();
    this.clearTimer('afk');
    if (this.bot) { try { this.bot.end(); } catch(e){} this.bot = null; }
  }

  clearTimer(name) {
    if (this.timers.has(name)) {
      clearInterval(this.timers.get(name));
      clearTimeout(this.timers.get(name));
      this.timers.delete(name);
    }
  }

  gracefulShutdown() {
    this.log('Tắt bot...');
    this.cleanup();
    this.clearTimer('reconnect');
    process.exit(0);
  }
}

// ============================================
// CHẠY
// ============================================
const app = new MinecraftBot();
app.connect();
process.on('SIGINT', () => app.gracefulShutdown());
process.on('SIGTERM', () => app.gracefulShutdown());
