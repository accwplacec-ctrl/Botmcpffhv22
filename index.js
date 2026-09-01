// ============================================
// MINECRAFT BOT - FIX KẸT BLOCK & TỐI ƯU ATERNOS
// ============================================

import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pathfinderPkg;
import minecraftData from 'minecraft-data';

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
  STUCK_THRESHOLD: 8,        // Giảm xuống 8 giây
  GOAL_RANGE: 2,             // Tăng lên 2 block (dễ đến đích hơn)
  RECONNECT_DELAY: 5000,
  ANTI_AFK_INTERVAL: 30000,
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
  // SPAWN - CẤU HÌNH MOVEMENTS TỐI ƯU
  // ============================================
  onSpawn() {
    this.log(`Bot đã vào game!`, 'success');
    this.mcData = minecraftData(this.bot.version);
    this.configureMovements();
    
    this.bot.pathfinder.thinkTimeout = CONFIG.PATHFINDER_TIMEOUT;
    this.bot.pathfinder.tickTimeout = 40;
    
    this.startAntiAfk();
    this.startSmartJump(); // ⭐ Tự nhảy khi gặp block
    
    setTimeout(() => this.bot.chat('🤖 Bot sẵn sàng! Gõ !bot help'), 1500);
  }

  // ============================================
  // ⭐ FIX CHÍNH: CẤU HÌNH MOVEMENTS CHO ATERNOS
  // ============================================
  configureMovements() {
    this.movements = new Movements(this.bot, this.mcData);
    
    // --- Di chuyển cơ bản ---
    this.movements.canDig = true;              // ⭐ Tự đào block cản (đất, đá, cát...)
    this.movements.digCost = 10;               // Chi phí đào cao (ưu tiên đường không cần đào)
    this.movements.canPlaceOnBreak = true;     // Đặt block xuống nếu cần
    
    // --- Nhảy & Leo ---
    this.movements.allow1by1towers = true;
    this.movements.allowFreeMotion = true;
    this.movements.allowParkour = false;       // ⭐ TẮT parkour (anti-cheat Aternos dễ flag)
    this.movements.allowSprinting = true;      // ⭐ Bật sprint để nhảy xa hơn
    
    // --- Địa hình ---
    this.movements.maxDropDown = 3;            // Giảm xuống 3 (an toàn hơn)
    this.movements.liquidCost = 10;            // Tránh nước/lava triệt để
    this.movements.scafoldingBlocks = [];      // Không tự đặt block làm thang
    
    // --- Tránh nguy hiểm ---
    const avoid = ['lava', 'fire', 'soul_fire', 'sweet_berry_bush', 'cactus'];
    avoid.forEach(name => {
      const b = this.mcData.blocksByName[name];
      if (b) this.movements.blocksToAvoid.add(b.id);
    });
    
    this.bot.pathfinder.setMovements(this.movements);
    this.log('Movements đã cấu hình (đào block: BẬT, parkour: TẮT)', 'success');
  }

  // ============================================
  // ⭐ FIX CHÍNH: TỰ NHẢY KHI GẶP BLOCK TRƯỚC MẶT
  // ============================================
  startSmartJump() {
    this.bot.on('physicTick', () => {
      if (!this.isMoving && !this.isFollowing) return;
      if (!this.bot?.entity?.onGround) return; // Đang nhảy rồi thì thôi
      
      // Tính vị trí block ngay trước mặt (1.3 block phía trước)
      const yaw = this.bot.entity.yaw;
      const px = this.bot.entity.position.x + Math.sin(yaw) * 1.3;
      const py = this.bot.entity.position.y + 1; // Mắt bot
      const pz = this.bot.entity.position.z + Math.cos(yaw) * 1.3;
      
      const blockFront = this.bot.blockAt({ x: px, y: py, z: pz });
      const blockFeet = this.bot.blockAt({ x: px, y: py - 1, z: pz });
      
      // Nếu có block chắn ngang và block bên dưới là rắn (có thể nhảy lên được)
      if (blockFront && blockFront.boundingBox === 'block' && 
          blockFeet && blockFeet.boundingBox === 'block') {
        
        // Block cao 1 block -> nhảy lên
        const blockTop = this.bot.blockAt({ x: px, y: py + 1, z: pz });
        if (!blockTop || blockTop.boundingBox !== 'block') {
          this.bot.setControlState('jump', true);
          // Nhảy xong thả sau 250ms
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

  // ============================================
  // LỆNH: GOTO
  // ============================================
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
    this.log(`Đi tới ${x} ${y} ${z}`, 'path');
    
    // ⭐ Dùng GoalNear range=2 để bot không bị kẹt vì cố đứng chính xác 1 block
    const goal = new goals.GoalNear(x, y, z, CONFIG.GOAL_RANGE);
    this.startPathfinding(goal, `🚶 Đang đi tới ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}...`);
  }

  cmdCome(targetName, requester) {
    const name = targetName || requester;
    const target = this.bot.players[name]?.entity;
    if (!target) { this.bot.chat(`❌ Không thấy ${name}`); return; }
    
    this.stopAllMovement();
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
  // PATHFINDING CORE
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
        if (this.stuckCounter >= CONFIG.STUCK_THRESHOLD) {
          this.log('Kẹt quá lâu -> Hủy', 'error');
          this.stopAllMovement();
          this.stats.pathsFailed++;
          this.bot.chat('❌ Kẹt đường! Không đi được.');
        }
      } else {
        this.stuckCounter = 0;
      }
      this.lastPos = cur.clone();
    }, 1000));
  }

  // ============================================
  // ⭐ THOÁT KẸT NÂNG CAO
  // ============================================
  attemptUnstuck() {
    this.log('Thoát kẹt...', 'warn');
    // Nhảy + đi tới + xoay nhẹ
    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);
    this.bot.look(this.bot.entity.yaw + (Math.random() - 0.5), this.bot.entity.pitch, true);
    
    setTimeout(() => {
      this.bot.setControlState('jump', false);
      this.bot.setControlState('forward', false);
    }, 600);
  }

  onGoalReached() {
    if (!this.isMoving) return;
    this.stopAllMovement();
    this.stats.pathsCompleted++;
    this.pendingGoal = null;
    this.bot.chat('✅ Đã đến nơi!');
  }

  onPathStop() {
    if (!this.isMoving) return;
    this.stopAllMovement();
    this.stats.pathsFailed++;
    this.pendingGoal = null;
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

  onKicked(r) { this.log(`Kick: ${r}`, 'error'); this.cleanup(); this.scheduleReconnect(); }
  onEnd() { this.log('Mất kết nối', 'warn'); this.cleanup(); this.scheduleReconnect(); }
  onError(e) { this.log(`Lỗi: ${e.message}`, 'error'); }

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
