// brain.js - thêm hàm getStrategyNotesForBrain và sửa askBrain
const axios = require('axios');
const firebase = require('./firebase');
const { buildSystemPrompt, extractQuestions } = require('./persona');
const getMemoryManager = require('./memory');

let cachedNgrokUrl = null;
let lastUrlFetch = 0;
const URL_CACHE_TTL = 5000;

// Cache strategy notes (1 phút)
let cachedStrategy = null;
let lastStrategyFetch = 0;
const STRATEGY_CACHE_TTL = 60000;

async function getNgrokUrl() {
    const now = Date.now();
    if (cachedNgrokUrl && (now - lastUrlFetch) < URL_CACHE_TTL) return cachedNgrokUrl;
    try {
        const url = await firebase.getRelayUrl();
        if (url) {
            cachedNgrokUrl = url;
            lastUrlFetch = now;
            return url;
        }
    } catch (e) { console.error('[Brain] Fetch URL error:', e); }
    if (cachedNgrokUrl) {
        console.warn('[Brain] Using stale cached URL');
        return cachedNgrokUrl;
    }
    throw new Error('No ngrok URL');
}

/**
 * Lấy strategy notes từ Firebase (có cache)
 */
async function getStrategyNotesForBrain() {
    const now = Date.now();
    if (cachedStrategy && (now - lastStrategyFetch) < STRATEGY_CACHE_TTL) {
        return cachedStrategy;
    }
    try {
        const notes = await firebase.loadStrategyNotes();
        if (notes && (now - notes.timestamp) < 60 * 60 * 1000) { // không quá 1 giờ
            cachedStrategy = notes;
            lastStrategyFetch = now;
            console.log('[Brain] Loaded strategy notes');
            return notes;
        } else {
            cachedStrategy = null;
            return null;
        }
    } catch (e) {
        console.error('[Brain] Load strategy error:', e);
        return null;
    }
}

async function callBrainAPI(prompt, userMessage) {
    const url = await getNgrokUrl();
    const token = process.env.BRAIN_TOKEN || 'botmcp';
    try {
        const response = await axios.post(url, {
            prompt,
            message: userMessage,
            token
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.data && response.data.reply) return response.data.reply;
        throw new Error('Invalid response');
    } catch (e) {
        console.error('[Brain] API call error:', e.message);
        throw e;
    }
}

async function askBrain(userMessage, context = {}) {
    const {
        ownerName = 'chủ',
        affection = 50,
        mood = 'Happy',
        memory = '',
        workingMemory = '',
        inventory = '',
        recentChats = '',
        questionsAsked = []
    } = context;

    const fallbacks = [
        "Trời ơi, tui đang bận gì đó, để tui xem lại đã nghen!",
        "Hả? Anh nói gì đó? Tui già rồi nghe không rõ!",
        "Mần ruộng mệt quá, để tui nghỉ xíu rồi nói chuyện tiếp!",
        "Ủa? Sao tự nhiên tui quên mất rồi!",
        "Trời ơi, tui hông biết trả lời sao nữa!"
    ];

    try {
        // Lấy strategy notes
        const strategyData = await getStrategyNotesForBrain();
        let strategyText = '';
        if (strategyData && strategyData.analysis) {
            const a = strategyData.analysis;
            strategyText = `
- Đánh giá mối quan hệ: ${a.relationship_assessment?.level || 'bình_thường'} - ${a.relationship_assessment?.explanation || ''}
- Gợi ý giọng điệu: ${a.tone_suggestion?.style || 'lịch_sự'} - ${a.tone_suggestion?.description || ''}
- Nên nói về: ${a.conversation_strategy?.topics_to_encourage?.join(', ') || 'chủ đề chung'}
- Tránh: ${a.conversation_strategy?.topics_to_avoid?.join(', ') || 'chủ đề nhạy cảm'}
- Facts quan trọng: ${a.important_facts?.slice(0, 3).join('; ') || 'Chưa có'}
`;
            console.log('[Brain] Using strategy notes in prompt');
        }

        const prompt = buildSystemPrompt({
            ownerName,
            affection,
            mood,
            memory,
            workingMemory,
            inventory,
            recentChats,
            askedQuestions,
            strategyNotes: strategyText  // Truyền vào
        });

        const reply = await callBrainAPI(prompt, userMessage);
        const newQuestions = extractQuestions(reply);
        if (newQuestions.length > 0) {
            const memoryManager = getMemoryManager();
            newQuestions.forEach(q => memoryManager.addQuestionAsked(q));
        }

        return {
            reply: reply || fallbacks[Math.floor(Math.random() * fallbacks.length)],
            questions: newQuestions
        };
    } catch (error) {
        console.error('[Brain] Error:', error);
        return {
            reply: fallbacks[Math.floor(Math.random() * fallbacks.length)],
            questions: []
        };
    }
}

function getFallbackResponse() {
    const fallbacks = [
        "Trời ơi, tui đang bận gì đó, để tui xem lại đã nghen!",
        "Hả? Anh nói gì đó? Tui già rồi nghe không rõ!",
        "Mần ruộng mệt quá, để tui nghỉ xíu rồi nói chuyện tiếp!"
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

module.exports = { askBrain, getFallbackResponse };
