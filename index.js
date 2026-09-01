// ============================================
// MINECRAFT BOT NÂNG CẤP - Mineflayer Pathfinder
// ES Module | Class-based | Tối ưu tìm đường
// ============================================

import mineflayer from 'mineflayer';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

// ============================================
// CẤU HÌNH
// ============================================
const CONFIG = {
  SERVER_IP: process.env.SERVER_IP || 'localhost',
  SERVER_PORT: parseInt(process.env.SERVER_PORT) || 25565,
  BOT_USERNAME: process.env.BOT_USERNAME || 'SmartBot',
  // auth: 'offline' cho cracked, 'microsoft' cho premium
  AUTH: process.env.BOT_AUTH || 'offline',
  
  // Cấu hình pathfinder
  PATHFINDER_TIMEOUT: 10000,      // ms tối đa để tính 1 lộ trình
  STUCK_THRESHOLD: 10,            // số giây đứng yên coi là kẹt
  GOAL_RANGE: 1,                  // khoảng cách coi là "đã đến nơi" (tránh kẹt do cố đứng chính xác 1 block)
  RECONNECT_DELAY: 5000,          // ms chờ reconnect
  ANTI_AFK_INTERVAL: 30000,       // ms mỗi lần anti-afk
};

// ============================================
// CLASS QUẢN LÝ BOT
// ============================================
class MinecraftBot {
  constructor() {
    this.bot = null;
    this.mcData = null;
    this.movements = null;
    
    // Quản lý timers
    this.timers = new Map();
    
    // Trạng thái di chuyển
    this.isMoving = false;
    this.isFollowing = false;
    this.followTarget = null;
    this.moveStartTime = 0;
    this.lastPos = null;
    this.stuckCounter = 0;
    this.pendingGoal = null; // Lưu nhiệm vụ để làm lại sau respawn
    
    // Thống kê
    this.stats = {
      connects: 0,
      commands: 0,
      pathsCompleted: 0,
      pathsFailed: 0,
    };
  }

  // ============================================
  // LOGGING
  // ============================================
  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', path: '📍' };
    console.log(`[${time}] ${icons[type] || '•'} ${msg}`);
  }

  // ============================================
  // KHỞI TẠO BOT
  // ============================================
  connect() {
    this.log(`Đang kết nối tới ${CONFIG.SERVER_IP}:${CONFIG.SERVER_PORT}...`, 'info');
    
    this.bot = mineflayer.createBot({
      host: CONFIG.SERVER_IP,
      port: CONFIG.SERVER_PORT,
      username: CONFIG.BOT_USERNAME,
      auth: CONFIG.AUTH,
    });

    this.bot.loadPlugin(pathfinder);
    this.stats.connects++;

    this.setupEvents();
  }

  // ============================================
  // THIẾT LẬP SỰ KIỆN
  // ============================================
  setupEvents() {
    // --- Spawn ---
    this.bot.once('spawn', () => this.onSpawn());
    
    // --- Chat ---
    this.bot.on('chat', (username, msg) => this.onChat(username, msg));
    
    // --- Pathfinder Events ---
    this.bot.on('goal_reached', () => this.onGoalReached());
    this.bot.on('path_stop', () => this.onPathStop());
    this.bot.on('path_update', (r) => this.onPathUpdate(r));
    
    // --- Sinh tồn ---
    this.bot.on('death', () => this.onDeath());
    this.bot.on('respawn', () => this.onRespawn());
    
    // --- Kết nối ---
    this.bot.on('kicked', (reason) => this.onKicked(reason));
    this.bot.on('end', () => this.onEnd());
    this.bot.on('error', (err) => this.onError(err));
  }

  // ============================================
  // SỰ KIỆN: SPAWN
  // ============================================
  onSpawn() {
    this.log(`Bot "${CONFIG.BOT_USERNAME}" đã vào game! (lần kết nối thứ ${this.stats.connects})`, 'success');
    
    // Khởi tạo minecraft-data và movements
    this.mcData = minecraftData(this.bot.version);
    this.configureMovements();
    
    // Cấu hình pathfinder nâng cao
    this.bot.pathfinder.thinkTimeout = CONFIG.PATHFINDER_TIMEOUT;
    this.bot.pathfinder.tickTimeout = 20; // ticks tối đa mỗi lần tính
    
    // Bắt đầu anti-afk
    this.startAntiAfk();
    
    // Thông báo sẵn sàng
    setTimeout(() => {
      this.bot.chat('🤖 Bot thông minh đã sẵn sàng! Gõ !bot help');
    }, 1000);
  }

  // ============================================
  // CẤU HÌNH MOVEMENTS NÂNG CAO
  // ============================================
  configureMovements() {
    this.movements = new Movements(this.bot, this.mcData);
    
    // --- Cơ bản ---
    this.movements.canDig = false;           // Không tự đào block (tránh phá map)
    this.movements.allow1by1towers = true;   // Cho phép xây cột 1x1 để leo
    this.movements.allowFreeMotion = true;   // Cho phép rơi tự do
    this.movements.allowParkour = true;      // Cho phép parkour nhảy
    
    // --- Địa hình ---
    this.movements.maxDropDown = 4;          // Nhảy xuống tối đa 4 block
    this.movements.liquidCost = 3;           // Chi phí đi trên nước/lava cao hơn (bot sẽ tránh nếu được)
    this.movements.scafoldingBlocks = [];    // Không tự đặt block làm thang
    
    // --- Tránh nguy hiểm ---
    // Block bot sẽ cố gắng không đi vào
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.lava.id);
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.fire.id);
    this.movements.blocksToAvoid.add(this.mcData.blocksByName.sweet_berry_bush.id);
    
    // --- Cập nhật ---
    this.bot.pathfinder.setMovements(this.movements);
    this.log('Đã cấu hình movements nâng cao', 'success');
  }

  // ============================================
  // SỰ KIỆN: CHAT & LỆNH
  // ============================================
  onChat(username, message) {
    if (username === CONFIG.BOT_USERNAME) return;
    
    const msg = message.trim();
    if (!msg.startsWith('!bot ')) return;
    
    this.stats.commands++;
    const args = msg.slice(5).trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    
    // Routing lệnh
    switch (cmd) {
      // --- Di chuyển ---
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
        
      // --- Dừng ---
      case 'dừng':
      case 'stop':
      case 'unfollow':
        this.cmdStop();
        break;
        
      // --- Thông tin ---
      case 'info':
        this.cmdInfo();
        break;
      case 'stats':
        this.cmdStats();
        break;
        
      // --- Cấu hình ---
      case 'settings':
        this.cmdSettings();
        break;
      case 'parkour':
        this.toggleParkour();
        break;
        
      // --- Trợ giúp ---
      case 'help':
      case 'giúp':
        this.cmdHelp();
        break;
        
      default:
        this.bot.chat('❓ Lệnh không hợp lệ. Gõ !bot help để xem danh sách.');
    }
  }

  // ============================================
  // LỆNH: GOTO (Đi tới tọa độ)
  // ============================================
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
    
    // Sử dụng GoalNear thay vì GoalBlock để bot không bị kẹt vì cố đứng chính xác 1 block
    const goal = new goals.GoalNear(x, y, z, CONFIG.GOAL_RANGE);
    this.startPathfinding(goal, `Đang di chuyển tới ${x} ${y} ${z}...`);
  }

  // ============================================
  // LỆNH: COME (Đến chỗ người chơi)
  // ============================================
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

  // ============================================
  // LỆNH: FOLLOW (Theo sau người chơi)
  // ============================================
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
    
    // GoalFollow: theo sau với khoảng cách 2 block
    const goal = new goals.GoalFollow(target, 2);
    this.bot.pathfinder.setGoal(goal, true); // true = dynamic goal (cập nhật liên tục)
  }

  // ============================================
  // LỆNH: STOP
  // ============================================
  cmdStop() {
    const wasMoving = this.isMoving || this.isFollowing;
    this.stopAllMovement();
    if (wasMoving) {
      this.bot.chat('🛑 Đã dừng mọi hoạt động!');
    } else {
      this.bot.chat('ℹ️ Bot hiện không làm gì cả.');
    }
  }

  // ============================================
  // LỆNH: INFO
  // ============================================
  cmdInfo() {
    const pos = this.bot.entity.position;
    const health = Math.floor(this.bot.health || 0);
    const food = Math.floor(this.bot.food || 0);
    this.bot.chat(
      `📍 X=${Math.floor(pos.x)} Y=${Math.floor(pos.y)} Z=${Math.floor(pos.z)} | ` +
      `❤️${health} 🍗${food}`
    );
  }

  // ============================================
  // LỆNH: STATS
  // ============================================
  cmdStats() {
    this.bot.chat(
      `📊 Kết nối: ${this.stats.connects} | ` +
      `Lệnh: ${this.stats.commands} | ` +
      `Thành công: ${this.stats.pathsCompleted} | ` +
      `Thất bại: ${this.stats.pathsFailed}`
    );
  }

  // ============================================
  // LỆNH: SETTINGS
  // ============================================
  cmdSettings() {
    const m = this.movements;
    this.bot.chat(
      `⚙️ Parkour:${m.allowParkour} Drop:${m.maxDropDown} ` +
      `Dig:${m.canDig} LiquidCost:${m.liquidCost}`
    );
  }

  // ============================================
  // LỆNH: TOGGLE PARKOUR
  // ============================================
  toggleParkour() {
    this.movements.allowParkour = !this.movements.allowParkour;
    this.bot.pathfinder.setMovements(this.movements);
    this.bot.chat(this.movements.allowParkour ? '✅ Parkour: BẬT' : '❌ Parkour: TẮT');
  }

  // ============================================
  // LỆNH: HELP
  // ============================================
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
    // Gửi từng dòng để không bị cắt tin nhắn
    helps.forEach((h, i) => setTimeout(() => this.bot.chat(h), i * 300));
  }

  // ============================================
  // PATHFINDING CORE
  // ============================================
  startPathfinding(goal, announceMsg) {
    this.isMoving = true;
    this.moveStartTime = Date.now();
    this.stuckCounter = 0;
    this.lastPos = this.bot.entity.position.clone();
    this.pendingGoal = goal; // Lưu lại để respawn có thể tiếp tục
    
    this.bot.chat(announceMsg);
    this.bot.pathfinder.setGoal(goal);
    
    // Bắt đầu giám sát bị kẹt
    this.startStuckMonitor();
  }

  // ============================================
  // GIÁM SÁT BỊ KẸT NÂNG CAO
  // ============================================
  startStuckMonitor() {
    this.clearTimer('stuck');
    
    this.timers.set('stuck', setInterval(() => {
      if (!this.isMoving || !this.bot?.entity) return;
      
      const currentPos = this.bot.entity.position;
      const dist = currentPos.distanceTo(this.lastPos);
      const elapsed = (Date.now() - this.moveStartTime) / 1000;
      
      // Nếu di chuyển < 0.3 block trong 1 giây -> có khả năng kẹt
      if (dist < 0.3) {
        this.stuckCounter++;
        
        // Thử tự thoát kẹt sau 3 giây
        if (this.stuckCounter === 3) {
          this.attemptUnstuck();
        }
        // Báo thất bại sau threshold
        else if (this.stuckCounter >= CONFIG.STUCK_THRESHOLD) {
          this.log('Bot bị kẹt quá lâu, hủy nhiệm vụ', 'warn');
          this.stopAllMovement();
          this.stats.pathsFailed++;
          this.bot.chat('❌ Không tìm được đường đi! (Bị kẹt)');
          return;
        }
      } else {
        // Đang di chuyển tốt -> reset counter
        this.stuckCounter = 0;
      }
      
      this.lastPos = currentPos.clone();
    }, 1000));
  }

  // ============================================
  // TỰ THOÁT KẸT (NUDGE)
  // ============================================
  attemptUnstuck() {
    this.log('Thử thoát kẹt...', 'warn');
    // Thử nhảy + đi ngẫu nhiên để thoát khỏi block bị bug
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 500);
  }

  // ============================================
  // SỰ KIỆN: ĐẾN NƠI
  // ============================================
  onGoalReached() {
    if (!this.isMoving) return;
    this.log('Đã đến đích!', 'success');
    this.stopAllMovement();
    this.stats.pathsCompleted++;
    this.pendingGoal = null;
    this.bot.chat('✅ Đã đến nơi!');
  }

  // ============================================
  // SỰ KIỆN: PATH STOP
  // ============================================
  onPathStop() {
    if (!this.isMoving) return;
    this.log('Pathfinder dừng lại (không tìm được đường)', 'warn');
    this.stopAllMovement();
    this.stats.pathsFailed++;
    this.pendingGoal = null;
    this.bot.chat('❌ Không tìm được đường đi!');
  }

  // ============================================
  // SỰ KIỆN: PATH UPDATE (log debug)
  // ============================================
  onPathUpdate(result) {
    if (result.status === 'noPath') {
      this.log('Không tìm thấy đường đi tới đích', 'warn');
    }
  }

  // ============================================
  // SỰ KIỆN: DEATH & RESPAWN
  // ============================================
  onDeath() {
    this.log('Bot đã chết!', 'error');
    this.stopAllMovement();
    this.bot.chat('💀 Tôi đã chết... Đang hồi sinh...');
  }

  onRespawn() {
    this.log('Bot đã hồi sinh', 'success');
    
    // Cấu hình lại movements sau respawn (bị reset)
    setTimeout(() => {
      this.configureMovements();
      
      // Nếu đang có nhiệm vụ dở, hỏi người chơi có muốn tiếp tục không
      if (this.pendingGoal && !this.isFollowing) {
        this.bot.chat('♻️ Đã hồi sinh! Nhiệm vụ cũ đã bị hủy.');
        this.pendingGoal = null;
      }
    }, 1000);
  }

  // ============================================
  // DỪNG MỌI HOẠT ĐỘNG
  // ============================================
  stopAllMovement() {
    this.isMoving = false;
    this.isFollowing = false;
    this.followTarget = null;
    this.pendingGoal = null;
    this.stuckCounter = 0;
    
    if (this.bot?.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Tắt các control state
    if (this.bot) {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sprint', false);
    }
    
    this.clearTimer('stuck');
  }

  // ============================================
  // ANTI-AFK
  // ============================================
  startAntiAfk() {
    this.clearTimer('afk');
    this.timers.set('afk', setInterval(() => {
      if (this.isMoving || this.isFollowing) return;
      // Xoay nhẹ người để tránh bị kick AFK
      if (this.bot?.entity) {
        this.bot.look(this.bot.entity.yaw + 0.5, this.bot.entity.pitch, true);
      }
    }, CONFIG.ANTI_AFK_INTERVAL));
  }

  // ============================================
  // XỬ LÝ KẾT NỐI
  // ============================================
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

  // ============================================
  // RECONNECT
  // ============================================
  scheduleReconnect() {
    if (this.timers.has('reconnect')) return;
    this.log(`Thử kết nối lại sau ${CONFIG.RECONNECT_DELAY / 1000}s...`, 'warn');
    
    this.timers.set('reconnect', setTimeout(() => {
      this.timers.delete('reconnect');
      this.connect();
    }, CONFIG.RECONNECT_DELAY));
  }

  // ============================================
  // DỌN DẸP
  // ============================================
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

  // ============================================
  // THOÁT SẠCH SẼ (SIGINT)
  // ============================================
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

// Xử lý tắt chương trình sạch sẽ
process.on('SIGINT', () => botApp.gracefulShutdown());
process.on('SIGTERM', () => botApp.gracefulShutdown());
