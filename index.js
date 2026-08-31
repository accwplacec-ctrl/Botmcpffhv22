// ============================================
// Minecraft Bot - Mineflayer + Pathfinder
// Sử dụng ES Module (import/export)
// ============================================

import mineflayer from 'mineflayer';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

// ============================================
// 1. CẤU HÌNH
// ============================================
// Ưu tiên biến môi trường, nếu không có thì dùng giá trị mặc định bên dưới
const CONFIG = {
  SERVER_IP: process.env.SERVER_IP || 'localhost',
  SERVER_PORT: parseInt(process.env.SERVER_PORT) || 25565,
  BOT_USERNAME: process.env.BOT_USERNAME || 'BotDiChuyen',
};

// ============================================
// BIẾN TRẠNG THÁI TOÀN CỤC
// ============================================
let bot = null;
let reconnectTimeout = null;
let stuckCheckInterval = null;
let lastPosition = null;
let stuckTicks = 0;
let isMoving = false;

// ============================================
// HÀM TẠO VÀ KẾT NỐI BOT
// ============================================
function createBot() {
  console.log(`[${new Date().toLocaleTimeString()}] Đang kết nối tới ${CONFIG.SERVER_IP}:${CONFIG.SERVER_PORT}...`);

  bot = mineflayer.createBot({
    host: CONFIG.SERVER_IP,
    port: CONFIG.SERVER_PORT,
    username: CONFIG.BOT_USERNAME,
    // auth: 'offline' nếu server là cracked/offline
    // Nếu server online (premium), đổi thành 'microsoft' hoặc 'mojang'
    auth: 'offline',
  });

  // Load plugin pathfinder
  bot.loadPlugin(pathfinder);

  // ============================================
  // SỰ KIỆN: KHI BOT SPAWN (VÀO GAME)
  // ============================================
  bot.once('spawn', () => {
    console.log(`[${new Date().toLocaleTimeString()}] Bot "${CONFIG.BOT_USERNAME}" đã vào game!`);
    
    // Thiết lập movements mặc định cho pathfinder
    const mcData = minecraftData(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    bot.chat('Bot đã sẵn sàng! Gõ !bot để xem hướng dẫn.');
  });

  // ============================================
  // SỰ KIỆN: NHẬN TIN NHẮN CHAT
  // ============================================
  bot.on('chat', (username, message) => {
    // Không phản hồi chính mình
    if (username === CONFIG.BOT_USERNAME) return;

    const msg = message.trim();
    
    // Kiểm tra prefix lệnh
    if (!msg.startsWith('!bot ')) return;

    const args = msg.slice(5).trim().split(/\s+/);
    const command = args[0].toLowerCase();

    // ----- LỆNH: ĐI TỚI / GOTO -----
    if (command === 'đi' && args[1] === 'tới') {
      // !bot đi tới <x> <y> <z>
      handleGotoCommand(args.slice(2), username);
    } else if (command === 'goto') {
      // !bot goto <x> <y> <z>
      handleGotoCommand(args.slice(1), username);
    }
    
    // ----- LỆNH: DỪNG / STOP -----
    else if (command === 'dừng' || command === 'stop') {
      stopMoving();
      bot.chat('Đã dừng di chuyển!');
    }
    
    // ----- LỆNH: INFO -----
    else if (command === 'info') {
      const pos = bot.entity.position;
      bot.chat(`Tọa độ hiện tại: X=${Math.floor(pos.x)} Y=${Math.floor(pos.y)} Z=${Math.floor(pos.z)}`);
    }
    
    // ----- LỆNH: TRỢ GIÚP -----
    else if (command === 'help' || command === 'giúp') {
      bot.chat('Lệnh: !bot goto <x> <y> <z> | !bot stop | !bot info');
    }
    
    // ----- LỆNH KHÔNG HỢP LỆ -----
    else {
      bot.chat('Lệnh không hợp lệ. Gõ !bot help để xem hướng dẫn.');
    }
  });

  // ============================================
  // SỰ KIỆN: ĐẾN NƠI (GOAL REACHED)
  // ============================================
  bot.on('goal_reached', () => {
    if (isMoving) {
      isMoving = false;
      clearStuckCheck();
      bot.chat('Đã đến nơi!');
    }
  });

  // ============================================
  // SỰ KIỆN: PATH STOP (Dừng tìm đường)
  // ============================================
  bot.on('path_stop', () => {
    if (isMoving) {
      isMoving = false;
      clearStuckCheck();
      bot.chat('Không tìm được đường đi!');
    }
  });

  // ============================================
  // SỰ KIỆN: BỊ KICK
  // ============================================
  bot.on('kicked', (reason, loggedIn) => {
    console.log(`[${new Date().toLocaleTimeString()}] Bị kick: ${reason} | Đã đăng nhập: ${loggedIn}`);
    cleanupBot();
    scheduleReconnect();
  });

  // ============================================
  // SỰ KIỆN: MẤT KẾT NỐI
  // ============================================
  bot.on('end', () => {
    console.log(`[${new Date().toLocaleTimeString()}] Mất kết nối tới server.`);
    cleanupBot();
    scheduleReconnect();
  });

  // ============================================
  // SỰ KIỆN: LỖI
  // ============================================
  bot.on('error', (err) => {
    console.error(`[${new Date().toLocaleTimeString()}] Lỗi bot:`, err.message);
    // Không gọi cleanupBot() ở đây vì 'end' sẽ được trigger sau error
  });
}

// ============================================
// XỬ LÝ LỆNH GOTO (ĐI TỚI TỌA ĐỘ)
// ============================================
function handleGotoCommand(args, requester) {
  // Kiểm tra đủ 3 tham số
  if (args.length < 3) {
    bot.chat(`Thiếu tọa độ! Cú pháp: !bot goto <x> <y> <z>`);
    return;
  }

  const x = parseFloat(args[0]);
  const y = parseFloat(args[1]);
  const z = parseFloat(args[2]);

  // Kiểm tra tọa độ có phải số hợp lệ không
  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    bot.chat('Tọa độ không hợp lệ! Vui lòng nhập số.');
    return;
  }

  // Dừng di chuyển hiện tại nếu có
  if (isMoving) {
    stopMoving();
  }

  bot.chat(`Đang di chuyển tới ${x} ${y} ${z}...`);
  
  // Thiết lập goal và bắt đầu tìm đường
  const goal = new goals.GoalBlock(x, y, z);
  bot.pathfinder.setGoal(goal);
  
  isMoving = true;
  stuckTicks = 0;
  lastPosition = bot.entity.position.clone();
  
  // Bắt đầu kiểm tra bot có bị kẹt không
  startStuckCheck();
}

// ============================================
// DỪNG DI CHUYỂN
// ============================================
function stopMoving() {
  if (bot && bot.pathfinder) {
    bot.pathfinder.setGoal(null);
  }
  isMoving = false;
  clearStuckCheck();
}

// ============================================
// KIỂM TRA BOT BỊ KẸT
// ============================================
function startStuckCheck() {
  clearStuckCheck(); // Xóa interval cũ nếu có
  
  stuckCheckInterval = setInterval(() => {
    if (!isMoving || !bot || !bot.entity) return;
    
    const currentPos = bot.entity.position;
    
    // Tính khoảng cách di chuyển từ lần check trước
    const distance = currentPos.distanceTo(lastPosition);
    
    if (distance < 0.5) {
      // Bot di chuyển rất ít hoặc không di chuyển
      stuckTicks++;
      
      // Nếu kẹt quá 15 giây (15 lần check, mỗi lần 1 giây)
      if (stuckTicks >= 15) {
        stopMoving();
        bot.chat('Không tìm được đường đi! (Bot bị kẹt)');
        return;
      }
    } else {
      // Bot đang di chuyển bình thường, reset counter
      stuckTicks = 0;
    }
    
    lastPosition = currentPos.clone();
  }, 1000); // Kiểm tra mỗi 1 giây
}

function clearStuckCheck() {
  if (stuckCheckInterval) {
    clearInterval(stuckCheckInterval);
    stuckCheckInterval = null;
  }
  stuckTicks = 0;
}

// ============================================
// DỌN DẸP VÀ RECONNECT
// ============================================
function cleanupBot() {
  clearStuckCheck();
  isMoving = false;
  if (bot) {
    try {
      bot.end();
    } catch (e) {
      // Bỏ qua lỗi khi end bot
    }
    bot = null;
  }
}

function scheduleReconnect() {
  // Tránh tạo nhiều timeout cùng lúc
  if (reconnectTimeout) return;
  
  console.log(`[${new Date().toLocaleTimeString()}] Sẽ thử kết nối lại sau 5 giây...`);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    createBot();
  }, 5000);
}

// ============================================
// KHỞI ĐỘNG BOT
// ============================================
createBot();
