// ============================================
// MINECRAFT BOT NÂNG CẤP - Mineflayer Pathfinder
// ES Module | Class-based | Tối ưu tìm đường
// ============================================

import mineflayer from 'mineflayer';
// SỬA LỖI: mineflayer-pathfinder là CommonJS, phải import default rồi destructuring
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
  
  PATHFINDER_TIMEOUT: 10000,
  STUCK_THRESHOLD: 10,
  GOAL_RANGE: 1,
  RECONNECT_DELAY: 5000,
  ANTI_AFK_INTERVAL: 30000,
};

// ============================================
// CLASS QUẢN LÝ BOT
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
    this.stats = {
      connects: 0,
      commands: 0,
      pathsCompleted: 0,
      pathsFailed: 0,
    };
  }

  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', path: '📍' };
    console.log(`[${time}] ${icons[type] || '•'} ${msg}`);
  }

  connect() {
    this.log(`Đang kết nối tới ${CONFIG.SERVER_IP}:${CONFIG.SERVER_PORT}...`, 'info');
    
    this.bot = mineflayer.createBot({
      host: CONFIG.SERVER_IP,
      port: CONFIG.SERVER_PORT,
      username: CONFIG.BOT_USERNAME,
      auth: CONFIG.AUTH,
      version: '1.21.4', // Ép phiên bản khớp với server
    });

    this.bot.loadPlugin(pathfinder);
    this.stats.connects++;

    this.setupEvents();
  }

  setupEvents() {
    this.bot.once('spawn', () => this.onSpawn());
    this.bot.on('chat', (username, msg) => this.onChat(username, msg));
    this.bot.on('goal_reached', () => this.onGoalReached());
    this.bot.on('path_stop', () => this.onPathStop());
    this.bot.on('path_update', (r) => this.onPathUpdate(r));
    this.bot.on('death', () => this.onDeath());
    this.bot.on('respawn', () => this.onRespawn());
    this.bot.on('kicked', (reason) => this.onKicked(reason));
    this.bot.on('end', () => this.onEnd());
    this.bot.on('error', (err) => this.onError(err));
  }

  onSpawn() {
    this.log(`Bot "${CONFIG.BOT_USERNAME}" đã vào game! (lần kết nối thứ ${this.stats.connects})`, 'success');
    
    this.mcData = minecraftData(this.bot.version);
    this.configureMovements();
    
    this.bot.pathfinder.thinkTimeout = CONFIG.PATHFINDER_TIMEOUT;
    this.bot.pathfinder.tickTimeout = 20;
    
    this.startAntiAfk();
    
    setTimeout(() => {
      this.bot.chat('🤖 Bot thông minh đã sẵn sàng! Gõ !bot help');
    }, 1000);
  }

  configureMovements() {
    this.movements = new Movements(this.bot, this.mcData);
    
    this.movements.canDig = false;
    this.movements.allow1by1towers = true;
    this.movements.allowFreeMotion = true;
    this.movements.allowParkour = true;
    
    this.movements.maxDropDown = 4;
    this.movements.liquidCost = 3;
    this.movements.scafoldingBlocks = [];
    
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.lava.id);
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.fire.id);
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.sweet_berry_bush.id);
    
    this.bot.pathfinder.setMovements(this.movements);
    this.log('Đã cấu hình movements nâng cao', 'success');
  }

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
        else this.bot.chat('❓ Cú pháp: !bot đi tới <x> <y> <z>');
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
      case 'settings':
        this.cmdSettings();
        break;
      case 'parkour':
        this.toggleParkour();
        break;
      case 'help':
      case 'giúp':
        this.cmdHelp();
        break;
      default:
        this.bot.chat('❓ Lệnh không hợp lệ. Gõ !bot help để xem danh sách.');
    }
  }

  cmdGoto(args, requester) {
    if (args.length < 3) {
      this.bot.chat(`⚠️ Thiếu tọa độ! Dùng: !bot goto <x> <y> <z>`);
      return;
    }

    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);

    if ([x, y, z].some(isNaN)) {
      this.bot.chat('❌ Tọa độ không hợp lệ! Vui lòng nhập số.');
      return;
    }

    this.stopAllMovement();
    this.log(`Nhận lệnh đi tới ${x} ${y} ${z} từ ${requester}`, 'path');
    
    const goal = new goals.GoalNear(x, y, z, CONFIG.GOAL_RANGE);
    this.startPathfinding(goal, `Đang di chuyển tới ${x} ${y} ${z}...`);
  }

  cmdCome(targetName, requester) {
    const name = targetName || requester;
    const target = this.bot.players[name]?.entity;
    
    if (!target) {
      this.bot.chat(`❌ Không tìm thấy người chơi "${name}"!`);
      return;
    }
    
    this.stopAllMovement();
    const pos = target.position;
    this.log(`${requester} yêu cầu đến chỗ ${name}`, 'path');
    
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
    this.startPathfinding(goal, `Đang đến chỗ ${name}...`);
  }

  cmdFollow(targetName, requester) {
    const name = targetName || requester;
    const target = this.bot.players[name]?.entity;
    
    if (!target) {
      this.bot.chat(`❌ Không thấy ${name}. Người chơi phải ở gần bot.`);
      return;
    }
    
    this.stopAllMovement();
    this.isFollowing = true;
    this.followTarget = name;
    
    this.bot.chat(`👀 Đang theo sau ${name}... (gõ !bot stop để dừng)`);
    this.log(`Bắt đầu follow ${name}`, 'path');
    
    const goal = new goals.GoalFollow(target, 2);
    this.bot.pathfinder.setGoal(goal, true);
  }

  cmdStop() {
    const wasMoving = this.isMoving || this.isFollowing;
    this.stopAllMovement();
    if (wasMoving) {
      this.bot.chat('🛑 Đã dừng mọi hoạt động!');
    } else {
      this.bot.chat('ℹ️ Bot hiện không làm gì cả.');
    }
  }

  cmdInfo() {
    const pos = this.bot.entity.position;
    const health = Math.floor(this.bot.health || 0);
    const food = Math.floor(this.bot.food || 0);
    this.bot.chat(
      `📍 X=${Math.floor(pos.x)} Y=${Math.floor(pos.y)} Z=${Math.floor(pos.z)} | ` +
      `❤️${health} 🍗${food}`
    );
  }

  cmdStats() {
    this.bot.chat(
      `📊 Kết nối: ${this.stats.connects} | ` +
      `Lệnh: ${this.stats.commands} | ` +
      `Thành công: ${this.stats.pathsCompleted} | ` +
      `Thất bại: ${this.stats.pathsFailed}`
    );
  }

  cmdSettings() {
    const m = this.movements;
    this.bot.chat(
      `⚙️ Parkour:${m.allowParkour} Drop:${m.maxDropDown} ` +
      `Dig:${m.canDig} LiquidCost:${m.liquidCost}`
    );
  }

  toggleParkour() {
    this.movements.allowParkour = !this.movements.allowParkour;
    this.bot.pathfinder.setMovements(this.movements);
    this.bot.chat(this.movements.allowParkour ? '✅ Parkour: BẬT' : '❌ Parkour: TẮT');
  }

  cmdHelp() {
    const helps = [
      '!bot goto <x> <y> <z> - Đi tới tọa độ',
      '!bot come [tên] - Đến chỗ người chơi',
      '!bot follow [tên] - Theo sau người chơi',
      '!bot stop - Dừng di chuyển',
      '!bot info - Xem tọa độ & máu',
      '!bot stats - Thống kê bot',
      '!bot parkour - Bật/tắt parkour',
      '!bot settings - Cấu hình movements',
    ];
    helps.forEach((h, i) => setTimeout(() => this.bot.chat(h), i * 300));
  }

  startPathfinding(goal, announceMsg) {
    this.isMoving = true;
    this.moveStartTime = Date.now();
    this.stuckCounter = 0;
    this.lastPos = this.bot.entity.position.clone();
    this.pendingGoal = goal;
    
    this.bot.chat(announceMsg);
    this.bot.pathfinder.setGoal(goal);
    
    this.startStuckMonitor();
  }

  startStuckMonitor() {
    this.clearTimer('stuck');
    
    this.timers.set('stuck', setInterval(() => {
      if (!this.isMoving || !this.bot?.entity) return;
      
      const currentPos = this.bot.entity.position;
      const dist = currentPos.distanceTo(this.lastPos);
      
      if (dist < 0.3) {
        this.stuckCounter++;
        
        if (this.stuckCounter === 3) {
          this.attemptUnstuck();
        }
        else if (this.stuckCounter >= CONFIG.STUCK_THRESHOLD) {
          this.log('Bot bị kẹt quá lâu, hủy nhiệm vụ', 'warn');
          this.stopAllMovement();
          this.stats.pathsFailed++;
          this.bot.chat('❌ Không tìm được đường đi! (Bị kẹt)');
          return;
        }
      } else {
        this.stuckCounter = 0;
      }
      
      this.lastPos = currentPos.clone();
    }, 1000));
  }

  attemptUnstuck() {
    this.log('Thử thoát kẹt...', 'warn');
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 500);
  }

  onGoalReached() {
    if (!this.isMoving) return;
    this.log('Đã đến đích!', 'success');
    this.stopAllMovement();
    this.stats.pathsCompleted++;
    this.pendingGoal = null;
    this.bot.chat('✅ Đã đến nơi!');
  }

  onPathStop() {
    if (!this.isMoving) return;
    this.log('Pathfinder dừng lại (không tìm được đường)', 'warn');
    this.stopAllMovement();
    this.stats.pathsFailed++;
    this.pendingGoal = null;
    this.bot.chat('❌ Không tìm được đường đi!');
  }

  onPathUpdate(result) {
    if (result.status === 'noPath') {
      this.log('Không tìm thấy đường đi tới đích', 'warn');
    }
  }

  onDeath() {
    this.log('Bot đã chết!', 'error');
    this.stopAllMovement();
    this.bot.chat('💀 Tôi đã chết... Đang hồi sinh...');
  }

  onRespawn() {
    this.log('Bot đã hồi sinh', 'success');
    
    setTimeout(() => {
      this.configureMovements();
      
      if (this.pendingGoal && !this.isFollowing) {
        this.bot.chat('♻️ Đã hồi sinh! Nhiệm vụ cũ đã bị hủy.');
        this.pendingGoal = null;
      }
    }, 1000);
  }

  stopAllMovement() {
    this.isMoving = false;
    this.isFollowing = false;
    this.followTarget = null;
    this.pendingGoal = null;
    this.stuckCounter = 0;
    
    if (this.bot?.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }
    
    if (this.bot) {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sprint', false);
    }
    
    this.clearTimer('stuck');
  }

  startAntiAfk() {
    this.clearTimer('afk');
    this.timers.set('afk', setInterval(() => {
      if (this.isMoving || this.isFollowing) return;
      if (this.bot?.entity) {
        this.bot.look(this.bot.entity.yaw + 0.5, this.bot.entity.pitch, true);
      }
    }, CONFIG.ANTI_AFK_INTERVAL));
  }

  onKicked(reason) {
    this.log(`Bị kick: ${reason}`, 'error');
    this.cleanup();
    this.scheduleReconnect();
  }

  onEnd() {
    this.log('Mất kết nối tới server', 'warn');
    this.cleanup();
    this.scheduleReconnect();
  }

  onError(err) {
    this.log(`Lỗi: ${err.message}`, 'error');
  }

  scheduleReconnect() {
    if (this.timers.has('reconnect')) return;
    this.log(`Thử kết nối lại sau ${CONFIG.RECONNECT_DELAY / 1000}s...`, 'warn');
    
    this.timers.set('reconnect', setTimeout(() => {
      this.timers.delete('reconnect');
      this.connect();
    }, CONFIG.RECONNECT_DELAY));
  }

  cleanup() {
    this.stopAllMovement();
    this.clearTimer('afk');
    
    if (this.bot) {
      try { this.bot.end(); } catch (e) {}
      this.bot = null;
    }
  }

  clearTimer(name) {
    if (this.timers.has(name)) {
      clearInterval(this.timers.get(name));
      clearTimeout(this.timers.get(name));
      this.timers.delete(name);
    }
  }

  gracefulShutdown() {
    this.log('Đang tắt bot...', 'info');
    this.cleanup();
    this.clearTimer('reconnect');
    process.exit(0);
  }
}

// ============================================
// KHỞI CHẠY
// ============================================
const botApp = new MinecraftBot();
botApp.connect();

process.on('SIGINT', () => botApp.gracefulShutdown());
process.on('SIGTERM', () => botApp.gracefulShutdown());
