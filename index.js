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
const { notifyNewMessage } = require('./reasoner');

console.log('🤖 Bot Ông Tư v9 starting...');

// ========== KHỞI TẠO MODULE ==========
const memoryManager = getMemoryManager();
const workingMemory = getWorkingMemory();
const moodEngine = getMoodEngine();

// ========== BIẾN TOÀN CỤC ==========
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

// ========== BIẾN CHO LUỒNG HỘI THOẠI ==========
const CONVERSATION_TIMEOUT = 30 * 1000; // 30 giây giữ luồng
const REPLY_COOLDOWN = 2000; // 2 giây giữa các reply
let activeConversation = {
    username: null,
    expiry: 0,
    lastReplyTime: 0
};

// ========== HÀM KIỂM TRA CÂU HỎI ==========
function isQuestion(text) {
    if (!text) return false;
    if (text.includes('?')) return true;
    const questionWords = ['sao', 'thế nào', 'là gì', 'ở đâu', 'khi nào', 'tại sao', 
                           'có...không', 'không', 'hả', 'nhỉ', 'chứ', 'à', 'ư', 'hở'];
    const lower = text.toLowerCase();
    return questionWords.some(word => lower.includes(word));
}

// ========== HÀM KIỂM TRA ĐƯỢC GỌI TÊN ==========
function isMentioned(message, botName) {
    if (!message || !botName) return false;
    const msgLower = message.toLowerCase();
    const nameTriggers = [
        botName.toLowerCase(),
        'ông tư',
        'khoa',
        'lão nông',
        'bác tư',
        'chú tư',
        'bố già'
    ];
    return nameTriggers.some(name => msgLower.includes(name));
}

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
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        defaultMove.scafoldingBlocks = [];
        defaultMove.allowParkour = false;
        defaultMove.allow1by1towers = false;
        defaultMove.canDig = false;
        bot.pathfinder.setMovements(defaultMove);
    });

    bot.once('spawn', async () => {
        console.log(`✅ Bot đã vào server! Tên: ${bot.username}`);
        isConnected = true;
        reconnectAttempts = 0;
        botReady = true;

        try {
            await memoryManager.init();
            console.log('📦 Memory loaded');
            moodEngine.init(bot);
            console.log('😊 Mood engine started');
            registerEvents();
            startFarmingLoop();
            startCheckInterval();
            proactive.init(bot);
            console.log('🚀 Bot ready!');
            bot.chat('/me đã vào vườn!');
            moveToGarden();
        } catch (error) {
            console.error('❌ Init error:', error);
        }
    });

    bot.on('error', (err) => {
        console.error('❌ Bot error:', err.message);
        if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
            handleDisconnect();
        }
    });

    bot.on('end', (reason) => {
        console.log(`🔴 Bot disconnected: ${reason || 'Unknown reason'}`);
        handleDisconnect();
    });

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

        // Cooldown chung
        const now = Date.now();
        if (now - lastChatTime < CHAT_COOLDOWN) return;
        lastChatTime = now;

        // Kiểm tra khoảng cách
        const player = bot.players[username];
        if (!player || !player.entity) {
            console.log(`💬 [${username}] (không thấy): ${message}`);
        } else {
            const dist = bot.entity.position.distanceTo(player.entity.position);
            if (dist > GARDEN_RADIUS * 2) {
                console.log(`💬 [${username}] (xa ${Math.round(dist)} blocks): ${message}`);
                return;
            }
            console.log(`💬 [${username}] (${Math.round(dist)} blocks): ${message}`);
        }

        // Nếu không phải owner và ở xa vườn thì bỏ qua
        if (username !== ownerName) {
            const player = bot.players[username];
            if (player && player.entity) {
                const dist = bot.entity.position.distanceTo(player.entity.position);
                if (dist > GARDEN_RADIUS) {
                    return;
                }
            }
        }

        // ========== LUỒNG HỘI THOẠI ==========
        const botName = bot.username;
        const mentioned = isMentioned(message, botName);
        const isActive = activeConversation.username === username && Date.now() < activeConversation.expiry;
        const hasQuestion = isQuestion(message);
        const canReply = (Date.now() - activeConversation.lastReplyTime) > REPLY_COOLDOWN;

        // Nếu được gọi tên, kích hoạt luồng hội thoại
        if (mentioned) {
            activeConversation.username = username;
            activeConversation.expiry = Date.now() + CONVERSATION_TIMEOUT;
            activeConversation.lastReplyTime = 0;
            console.log(`🔗 Active conversation with ${username} (triggered by mention)`);
            workingMemory.setFlag('active_conversation', true, CONVERSATION_TIMEOUT);
            workingMemory.setFlag('conversation_partner', username, CONVERSATION_TIMEOUT);
        }

        // Quyết định có trả lời hay không
        const shouldReply = (isActive || hasQuestion || mentioned) && canReply;

        if (shouldReply) {
            // Cập nhật thời gian reply cuối
            activeConversation.lastReplyTime = Date.now();

            // Gia hạn luồng nếu đang active
            if (isActive) {
                activeConversation.expiry = Date.now() + CONVERSATION_TIMEOUT;
                workingMemory.setFlag('active_conversation', true, CONVERSATION_TIMEOUT);
                workingMemory.setFlag('conversation_partner', username, CONVERSATION_TIMEOUT);
            }

            // Gọi Reasoner B để đếm tin nhắn
            notifyNewMessage();

            // Xử lý chat
            isProcessing = true;
            try {
                await handleChat(username, message);
            } catch (error) {
                console.error('❌ Chat handler error:', error);
            } finally {
                isProcessing = false;
            }
        } else {
            // Log tin nhắn bị bỏ qua
            if (!canReply) {
                console.log(`⏳ Ignored (cooldown): ${username}: ${message}`);
            } else {
                console.log(`⏭️ Ignored (no trigger): ${username}: ${message}`);
            }
        }
    });

    // ===== WHISPER =====
    bot.on('whisper', async (username, message) => {
        if (username === bot.username) return;
        if (isProcessing) return;

        console.log(`🤫 [${username}] whisper: ${message}`);

        // Whisper luôn được trả lời
        notifyNewMessage();

        // Kích hoạt luồng cho whisper
        activeConversation.username = username;
        activeConversation.expiry = Date.now() + CONVERSATION_TIMEOUT;
        activeConversation.lastReplyTime = Date.now();

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
        if (bot.entity.position.y < -50) {
            console.log('⚠️ Bot falling! Trying to recover...');
            bot.chat('/spawn');
        }
    });

    // ===== ITEM DROP =====
    bot.on('itemDrop', (entity) => {
        if (!entity || !entity.position) return;
        if (garden.isInGarden(entity.position, gardenCenter, GARDEN_RADIUS)) {
            console.log(`📦 Item dropped in garden: ${entity.name || 'unknown'}`);
            workingMemory.setFlag('item_dropped', true, 60000);
        }
    });

    // ===== BLOCK UPDATE =====
    bot.on('blockUpdate', (oldBlock, newBlock) => {
        if (oldBlock && newBlock) {
            if (oldBlock.name === 'farmland' && newBlock.name !== 'farmland') {
                const pos = oldBlock.position;
                const dist = Math.sqrt(
                    Math.pow(pos.x - gardenCenter.x, 2) +
                    Math.pow(pos.z - gardenCenter.z, 2)
                );
                if (dist < GARDEN_RADIUS) {
                    console.log(`⚠️ Farmland broken at ${pos.x}, ${pos.z}`);
                    workingMemory.setFlag('farmland_broken', true, 60000);
                    memoryManager.addEvent(`Có người phá ruộng tại (${pos.x}, ${pos.z})`, 3);
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
    if (isProcessing) return;

    workingMemory.addConversation(username, message);

    if (!ownerName || ownerName === 'chủ') {
        ownerName = username;
        console.log(`👤 Owner set to: ${ownerName}`);
    }

    memoryManager.changeAffection(0.5);

    const affection = memoryManager.getAffection();
    const mood = moodEngine.getCurrentMood();
    const memory = memoryManager.getMemorySummary();
    const workingMem = workingMemory.getSummary();
    const recentChats = workingMemory.getRecentConversations(3);
    const questionsAsked = memoryManager.getRecentQuestions(5);
    const inventory = getInventorySummary();

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

    if (result.questions && result.questions.length > 0) {
        result.questions.forEach(q => {
            memoryManager.addQuestionAsked(q);
        });
    }

    const words = message.toLowerCase().split(' ');
    const importantWords = words.filter(w => w.length > 3);
    importantWords.forEach(word => {
        memoryManager.addFavoriteTopic(word);
    });

    const reply = result.reply || 'Tui hông biết nói gì nữa!';

    if (isWhisper) {
        bot.whisper(username, reply);
    } else {
        bot.chat(`[Ông Tư] ${reply}`);
    }

    console.log(`🤖 Reply to ${username}: ${reply}`);

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
        setTimeout(() => {
            if (bot && bot.pathfinder) {
                const current = bot.entity.position;
                const dist = Math.sqrt(
                    Math.pow(current.x - pos.x, 2) +
                    Math.pow(current.z - pos.z, 2)
                );
                if (dist > 5) {
                    console.log(`⚠️ Still far from garden: ${Math.round(dist)} blocks`);
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
            if (garden.isInGarden(bot.entity.position, gardenCenter, GARDEN_RADIUS)) {
                workingMemory.setFlag('in_garden', true);
                autoHarvest();
                autoPlant();
            }
        } catch (error) {
            console.error('❌ Farming error:', error);
        }
    }, 5000);
}

// ========== AUTO HARVEST ==========
function autoHarvest() {
    if (!bot || !bot.inventory) return;
    try {
        const wheatBlocks = bot.findBlocks({
            matching: ['wheat'],
            maxDistance: 5,
            count: 10
        });
        if (wheatBlocks && wheatBlocks.length > 0) {
            for (const pos of wheatBlocks) {
                const block = bot.blockAt(pos);
                if (block && block.metadata === 7) {
                    console.log(`🌾 Harvesting wheat at ${pos.x}, ${pos.z}`);
                    bot.dig(block, (err) => {
                        if (!err) {
                            memoryManager.addHarvest(1);
                            memoryManager.addWheat(1);
                            console.log('✅ Harvested wheat!');
                        }
                    });
                    break;
                }
            }
        }
    } catch (error) {}
}

// ========== AUTO PLANT ==========
function autoPlant() {
    if (!bot || !bot.inventory) return;
    try {
        const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
        if (!seeds) return;
        const farmlandBlocks = bot.findBlocks({
            matching: ['farmland'],
            maxDistance: 5,
            count: 10
        });
        if (farmlandBlocks && farmlandBlocks.length > 0) {
            for (const pos of farmlandBlocks) {
                const above = bot.blockAt({x: pos.x, y: pos.y + 1, z: pos.z});
                if (above && above.name === 'air') {
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
    } catch (error) {}
}

// ========== CHECK INTERVAL ==========
function startCheckInterval() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
        if (!bot || !isConnected) return;
        try {
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
            if (bot.health < 5) {
                console.log('❤️ Low health!');
                const food = bot.inventory.items().find(i => i.name === 'bread');
                if (food) {
                    bot.eat(food);
                }
            }
            const stats = memoryManager.getStats();
            if (Math.random() < 0.01) {
                console.log('📊 Memory stats:', stats);
            }
        } catch (error) {
            console.error('❌ Check interval error:', error);
        }
    }, 30000);
}

// ========== XỬ LÝ DISCONNECT ==========
function handleDisconnect() {
    isConnected = false;
    botReady = false;
    console.log('🔌 Disconnected, attempting to reconnect...');
    if (farmInterval) {
        clearInterval(farmInterval);
        farmInterval = null;
    }
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
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

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled rejection:', reason);
});

console.log('✅ Bot script loaded!');
