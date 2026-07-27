// index.js
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const Movements = require('mineflayer-pathfinder').Movements;
const { GoalNear, GoalBlock, GoalXZ } = require('mineflayer-pathfinder').goals;
const config = require('./config');
const { askBrain } = require('./brain');
const getMemoryManager = require('./memory');
const getWorkingMemory = require('./workingMemory');
const getMoodEngine = require('./moodEngine');
const proactive = require('./proactive');
const garden = require('./garden');

// ========== KHỞI TẠO ==========
console.log('🤖 Bot Ông Tư v9 starting...');

// Khởi tạo các module
const memoryManager = getMemoryManager();
const workingMemory = getWorkingMemory();
const moodEngine = getMoodEngine();

let bot = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;
let isConnected = false;
let isProcessing = false;
let lastChatTime = 0;
const CHAT_COOLDOWN = 3000;
let farmInterval = null;
let checkInterval = null;
let botReady = false;
let ownerName = config.OWNER_NAME || 'chủ';
let gardenCenter = {
  x: config.GARDEN_X || 0,
  z: config.GARDEN_Z || 0
};
const GARDEN_RADIUS = config.GARDEN_RADIUS || 20;
let deathCount = 0;

// ========== TẠO BOT ==========
function createBot() {
  const botConfig = {
    host: config.MC_HOST,
    port: config.MC_PORT,
    username: config.BOT_USERNAME,
    version: config.MC_VERSION || '1.19.2',
    auth: 'offline',
    viewDistance: 'tiny',
    chatLengthLimit: 256,
    keepAlive: true,
    checkTimeoutInterval: 60000,
  };

  bot = mineflayer.createBot(botConfig);
  
  // Load plugins
  bot.loadPlugin(pathfinder);
  
  // Setup pathfinder
  bot.once('spawn', () => {
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.scafoldingBlocks = [];
    defaultMove.allowParkour = false;
    defaultMove.allow1by1towers = false;
    defaultMove.canDig = false;
    bot.pathfinder.setMovements(defaultMove);
  });

  // ========== EVENT: SPAWN ==========
  bot.once('spawn', async () => {
    console.log(`✅ Bot đã vào server! Tên: ${bot.username}`);
    isConnected = true;
    reconnectAttempts = 0;
    botReady = true;
    
    try {
      // Khởi tạo memory
      await memoryManager.init();
      console.log('📦 Memory loaded');
      
      // Khởi tạo mood
      moodEngine.init(bot);
      console.log('😊 Mood engine started');
      
      // Đăng ký sự kiện
      registerEvents();
      
      // Bắt đầu farming loop
      startFarmingLoop();
      
      // Bắt đầu check interval
      startCheckInterval();
      
      // Bắt đầu proactive chat
      proactive.init(bot);
      
      console.log('🚀 Bot ready!');
      bot.chat('/me đã vào vườn!');
      
      // Move về vườn
      moveToGarden();
      
    } catch (error) {
      console.error('❌ Init error:', error);
    }
  });

  // ========== EVENT: ERROR ==========
  bot.on('error', (err) => {
    console.error('❌ Bot error:', err.message);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      handleDisconnect();
    }
  });

  // ========== EVENT: END ==========
  bot.on('end', (reason) => {
    console.log(`🔴 Bot disconnected: ${reason || 'Unknown reason'}`);
    handleDisconnect();
  });

  // ========== EVENT: KICK ==========
  bot.on('kicked', (reason) => {
    console.log(`👢 Bot kicked: ${reason}`);
    handleDisconnect();
  });

  return bot;
}

// ========== ĐĂNG KÝ SỰ KIỆN ==========
function registerEvents() {
  if (!bot) return;

  // ===== CHAT =====
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    if (isProcessing) return;
    
    // Cooldown
    const now = Date.now();
    if (now - lastChatTime < CHAT_COOLDOWN) return;
    lastChatTime = now;

    // Kiểm tra khoảng cách
    const player = bot.players[username];
    if (!player || !player.entity) {
      // Nếu không thấy player, vẫn reply nhưng ít nhiệt tình hơn
      console.log(`💬 [${username}] (không thấy): ${message}`);
    } else {
      const dist = bot.entity.position.distanceTo(player.entity.position);
      if (dist > GARDEN_RADIUS * 2) {
        console.log(`💬 [${username}] (xa ${Math.round(dist)} blocks): ${message}`);
        // Không reply nếu quá xa
        return;
      }
      console.log(`💬 [${username}] (${Math.round(dist)} blocks): ${message}`);
    }

    // Chỉ tương tác với owner hoặc người trong vườn
    if (username !== ownerName) {
      const player = bot.players[username];
      if (player && player.entity) {
        const dist = bot.entity.position.distanceTo(player.entity.position);
        if (dist > GARDEN_RADIUS) {
          return; // Không reply với người ngoài vườn
        }
      }
    }

    // Xử lý chat
    isProcessing = true;
    try {
      await handleChat(username, message);
    } catch (error) {
      console.error('❌ Chat handler error:', error);
    } finally {
      isProcessing = false;
    }
  });

  // ===== WHISPER =====
  bot.on('whisper', async (username, message) => {
    if (username === bot.username) return;
    if (isProcessing) return;
    
    console.log(`🤫 [${username}] whisper: ${message}`);
    isProcessing = true;
    try {
      await handleChat(username, message, true);
    } catch (error) {
      console.error('❌ Whisper handler error:', error);
    } finally {
      isProcessing = false;
    }
  });

  // ===== PLAYER JOIN =====
  bot.on('playerJoined', (player) => {
    if (player.username === bot.username) return;
    console.log(`👤 ${player.username} joined`);
    
    // Nếu là owner, chào hỏi
    if (player.username === ownerName) {
      setTimeout(() => {
        const greetings = [
          `Chào anh ${ownerName}! Vào vườn chơi đi!`,
          `Ê anh ${ownerName}, vô đây coi lúa tui nè!`,
          `Ủa anh ${ownerName} đó hả? Vô đây chơi!`
        ];
        bot.chat(greetings[Math.floor(Math.random() * greetings.length)]);
      }, 2000);
    }
  });

  // ===== PLAYER LEFT =====
  bot.on('playerLeft', (player) => {
    if (player.username === bot.username) return;
    console.log(`👋 ${player.username} left`);
    if (player.username === ownerName) {
      workingMemory.setFlag('owner_left', true, 60000);
    }
  });

  // ===== PHYSICS =====
  bot.on('physicTick', () => {
    // Kiểm tra nếu bot bị rơi khỏi thế giới
    if (bot.entity.position.y < -50) {
      console.log('⚠️ Bot falling! Trying to recover...');
      bot.chat('/spawn');
    }
  });

  // ===== ITEM DROP =====
  bot.on('itemDrop', (entity) => {
    if (!entity || !entity.position) return;
    // Check if item is in garden
    if (garden.isInGarden(entity.position, gardenCenter, GARDEN_RADIUS)) {
      console.log(`📦 Item dropped in garden: ${entity.name || 'unknown'}`);
      workingMemory.setFlag('item_dropped', true, 60000);
    }
  });

  // ===== BLOCK UPDATE =====
  bot.on('blockUpdate', (oldBlock, newBlock) => {
    // Phát hiện phá hoại vườn
    if (oldBlock && newBlock) {
      // Kiểm tra farmland bị phá
      if (oldBlock.name === 'farmland' && newBlock.name !== 'farmland') {
        const pos = oldBlock.position;
        const dist = Math.sqrt(
          Math.pow(pos.x - gardenCenter.x, 2) + 
          Math.pow(pos.z - gardenCenter.z, 2)
        );
        if (dist < GARDEN_RADIUS) {
          console.log(`⚠️ Farmland broken at ${pos.x}, ${pos.z}`);
          workingMemory.setFlag('farmland_broken', true, 60000);
          
          // Lưu vào memory dài hạn
          memoryManager.addEvent(`Có người phá ruộng tại (${pos.x}, ${pos.z})`, 3);
          
          // Phản ứng nếu đang ở gần
          if (workingMemory.getFlag('owner_nearby')) {
            setTimeout(() => {
              const reactions = [
                'Ai phá ruộng tui đó hả?',
                'Trời ơi, đừng phá ruộng tui!',
                'Tui mần cực lắm đó nghen!'
              ];
              bot.chat(reactions[Math.floor(Math.random() * reactions.length)]);
            }, 1000);
          }
        }
      }
    }
  });

  // ===== DEATH =====
  bot.on('death', () => {
    deathCount++;
    console.log(`💀 Bot died (${deathCount} times)`);
    memoryManager.setLastDeath(`Chết lần ${deathCount} tại vườn`);
    workingMemory.setFlag('just_died', true, 120000);
    
    // Tự động respawn
    setTimeout(() => {
      bot.chat('/spawn');
      console.log('🔄 Respawning...');
    }, 3000);
  });

  // ===== RESPAWN =====
  bot.on('respawn', () => {
    console.log('🔄 Respawned');
    setTimeout(() => {
      moveToGarden();
    }, 2000);
  });

  // ===== HEALTH =====
  bot.on('health', () => {
    if (bot.health < 5 && bot.food < 5) {
      console.log('⚠️ Low health and food!');
      workingMemory.setFlag('low_health', true, 60000);
    }
  });

  console.log('✅ Events registered');
}

// ========== XỬ LÝ CHAT ==========
async function handleChat(username, message, isWhisper = false) {
  // Kiểm tra spam
  if (isProcessing) return;
  
  // Lưu vào working memory
  workingMemory.addConversation(username, message);
  
  // Update owner name nếu chưa có
  if (!ownerName || ownerName === 'chủ') {
    ownerName = username;
    console.log(`👤 Owner set to: ${ownerName}`);
  }

  // Cập nhật tình cảm - mỗi lần chat tăng 0.5
  memoryManager.changeAffection(0.5);

  // Lấy context
  const affection = memoryManager.getAffection();
  const mood = moodEngine.getCurrentMood();
  const memory = memoryManager.getMemorySummary();
  const workingMem = workingMemory.getSummary();
  const recentChats = workingMemory.getRecentConversations(3);
  const questionsAsked = memoryManager.getRecentQuestions(5);
  
  // Lấy inventory
  const inventory = getInventorySummary();

  // Gọi brain
  const result = await askBrain(message, {
    ownerName: ownerName,
    affection: affection,
    mood: mood,
    memory: memory,
    workingMemory: workingMem,
    inventory: inventory,
    recentChats: recentChats,
    questionsAsked: questionsAsked
  });

  // Lưu câu hỏi mới (nếu có)
  if (result.questions && result.questions.length > 0) {
    result.questions.forEach(q => {
      memoryManager.addQuestionAsked(q);
    });
  }

  // Lưu topic yêu thích
  const words = message.toLowerCase().split(' ');
  const importantWords = words.filter(w => w.length > 3);
  importantWords.forEach(word => {
    memoryManager.addFavoriteTopic(word);
  });

  // Gửi phản hồi
  const reply = result.reply || 'Tui hông biết nói gì nữa!';
  
  if (isWhisper) {
    bot.whisper(username, reply);
  } else {
    bot.chat(`[Ông Tư] ${reply}`);
  }

  console.log(`🤖 Reply to ${username}: ${reply}`);

  // Xử lý action
  await handleActions(username);

  // Cập nhật lần tương tác cuối
  memoryManager.memory.lastInteraction = Date.now();
}

// ========== LẤY INVENTORY SUMMARY ==========
function getInventorySummary() {
  if (!bot || !bot.inventory) return 'Chưa có gì';
  
  try {
    const items = bot.inventory.items();
    const wheats = items.filter(i => i.name === 'wheat');
    const seeds = items.filter(i => i.name === 'wheat_seeds');
    const breads = items.filter(i => i.name === 'bread');
    
    const parts = [];
    if (wheats.length > 0) parts.push(`${wheats.length} cục lúa`);
    if (seeds.length > 0) parts.push(`${seeds.length} hạt giống`);
    if (breads.length > 0) parts.push(`${breads.length} ổ bánh mì`);
    
    return parts.length > 0 ? parts.join(', ') : 'Túi rỗng';
  } catch (error) {
    return 'Không lấy được inventory';
  }
}

// ========== XỬ LÝ ACTIONS ==========
async function handleActions(username) {
  // Actions sẽ được xử lý dựa trên response từ brain
  // Hoặc các sự kiện trong game
}

// ========== DI CHUYỂN VỀ VƯỜN ==========
function moveToGarden() {
  if (!bot || !bot.pathfinder) return;
  
  const pos = {
    x: gardenCenter.x,
    z: gardenCenter.z,
    y: 64
  };
  
  console.log(`🚶 Moving to garden: ${pos.x}, ${pos.z}`);
  
  try {
    const goal = new GoalXZ(pos.x, pos.z);
    bot.pathfinder.setGoal(goal);
    
    // Check after 5 seconds
    setTimeout(() => {
      if (bot && bot.pathfinder) {
        const current = bot.entity.position;
        const dist = Math.sqrt(
          Math.pow(current.x - pos.x, 2) + 
          Math.pow(current.z - pos.z, 2)
        );
        if (dist > 5) {
          console.log(`⚠️ Still far from garden: ${Math.round(dist)} blocks`);
          // Try again
          bot.pathfinder.setGoal(new GoalXZ(pos.x, pos.z));
        } else {
          console.log('✅ Arrived at garden!');
          workingMemory.setFlag('in_garden', true);
        }
      }
    }, 5000);
  } catch (error) {
    console.error('❌ Move error:', error);
  }
}

// ========== FARMING LOOP ==========
function startFarmingLoop() {
  if (farmInterval) clearInterval(farmInterval);
  
  farmInterval = setInterval(() => {
    if (!bot || !botReady || !isConnected) return;
    
    try {
      // Kiểm tra và thực hiện các hoạt động nông nghiệp
      if (garden.isInGarden(bot.entity.position, gardenCenter, GARDEN_RADIUS)) {
        workingMemory.setFlag('in_garden', true);
        
        // Tự động thu hoạch lúa chín
        autoHarvest();
        
        // Tự động trồng lúa
        autoPlant();
      }
    } catch (error) {
      console.error('❌ Farming error:', error);
    }
  }, 5000); // Mỗi 5 giây
}

// ========== AUTO HARVEST ==========
function autoHarvest() {
  if (!bot || !bot.inventory) return;
  
  try {
    // Tìm lúa chín gần đó
    const wheatBlocks = bot.findBlocks({
      matching: ['wheat'],
      maxDistance: 5,
      count: 10
    });
    
    if (wheatBlocks && wheatBlocks.length > 0) {
      // Kiểm tra độ chín (age = 7 là chín)
      for (const pos of wheatBlocks) {
        const block = bot.blockAt(pos);
        if (block && block.metadata === 7) {
          // Thu hoạch
          console.log(`🌾 Harvesting wheat at ${pos.x}, ${pos.z}`);
          bot.dig(block, (err) => {
            if (!err) {
              memoryManager.addHarvest(1);
              memoryManager.addWheat(1);
              console.log('✅ Harvested wheat!');
            }
          });
          break; // Thu hoạch 1 cây mỗi lần để tránh spam
        }
      }
    }
  } catch (error) {
    // Bỏ qua lỗi
  }
}

// ========== AUTO PLANT ==========
function autoPlant() {
  if (!bot || !bot.inventory) return;
  
  try {
    // Tìm seeds trong inventory
    const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
    if (!seeds) return;
    
    // Tìm đất trồng trống
    const farmlandBlocks = bot.findBlocks({
      matching: ['farmland'],
      maxDistance: 5,
      count: 10
    });
    
    if (farmlandBlocks && farmlandBlocks.length > 0) {
      for (const pos of farmlandBlocks) {
        const above = bot.blockAt({x: pos.x, y: pos.y + 1, z: pos.z});
        if (above && above.name === 'air') {
          // Trồng lúa
          console.log(`🌱 Planting wheat at ${pos.x}, ${pos.z}`);
          bot.placeBlock(above, seeds, (err) => {
            if (!err) {
              console.log('✅ Planted wheat!');
              memoryManager.addEvent('Trồng một cây lúa mới', 1);
            }
          });
          break;
        }
      }
    }
  } catch (error) {
    // Bỏ qua lỗi
  }
}

// ========== CHECK INTERVAL ==========
function startCheckInterval() {
  if (checkInterval) clearInterval(checkInterval);
  
  checkInterval = setInterval(() => {
    if (!bot || !isConnected) return;
    
    try {
      // Kiểm tra vị trí
      if (bot.entity) {
        const pos = bot.entity.position;
        const dist = Math.sqrt(
          Math.pow(pos.x - gardenCenter.x, 2) + 
          Math.pow(pos.z - gardenCenter.z, 2)
        );
        
        if (dist > GARDEN_RADIUS * 1.5) {
          console.log(`🚶 Bot outside garden (${Math.round(dist)} blocks), moving back...`);
          moveToGarden();
        }
      }
      
      // Kiểm tra owner
      if (ownerName) {
        const player = bot.players[ownerName];
        if (player && player.entity) {
          const dist = bot.entity.position.distanceTo(player.entity.position);
          if (dist < GARDEN_RADIUS) {
            if (!workingMemory.getFlag('owner_nearby')) {
              workingMemory.setFlag('owner_nearby', true, 30000);
              console.log('👤 Owner is nearby!');
            }
          } else {
            workingMemory.setFlag('owner_nearby', false);
          }
        }
      }
      
      // Kiểm tra health
      if (bot.health < 5) {
        console.log('❤️ Low health!');
        const food = bot.inventory.items().find(i => i.name === 'bread');
        if (food) {
          bot.eat(food);
        }
      }
      
      // Check memory stats
      const stats = memoryManager.getStats();
      if (Math.random() < 0.01) { // 1% chance
        console.log('📊 Memory stats:', stats);
      }
      
    } catch (error) {
      console.error('❌ Check interval error:', error);
    }
  }, 30000); // Mỗi 30 giây
}

// ========== XỬ LÝ DISCONNECT ==========
function handleDisconnect() {
  isConnected = false;
  botReady = false;
  console.log('🔌 Disconnected, attempting to reconnect...');
  
  // Clear intervals
  if (farmInterval) {
    clearInterval(farmInterval);
    farmInterval = null;
  }
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  // Reconnect
  setTimeout(() => {
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), 120000);
      console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay/1000}s`);
      setTimeout(() => {
        createBot();
      }, delay);
    } else {
      console.log('❌ Max reconnect attempts reached. Exiting...');
      process.exit(1);
    }
  }, 2000);
}

// ========== START BOT ==========
createBot();

// ========== CLEAN SHUTDOWN ==========
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (farmInterval) clearInterval(farmInterval);
  if (checkInterval) clearInterval(checkInterval);
  if (bot) {
    bot.end();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Terminating...');
  if (farmInterval) clearInterval(farmInterval);
  if (checkInterval) clearInterval(checkInterval);
  if (bot) {
    bot.end();
  }
  process.exit(0);
});

// ========== UNHANDLED ERRORS ==========
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  // Don't exit, just log
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  // Don't exit, just log
});

console.log('✅ Bot script loaded!');
