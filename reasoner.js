// reasoner.js - Module Reasoner B (Gemma-4-31b-it) chạy nền
const axios = require('axios');
const firebase = require('./firebase');
const getMemoryManager = require('./memory');

// Cấu hình
const ANALYSIS_INTERVAL = 5;                // Số tin nhắn mới để trigger
const MIN_TIME_BETWEEN_ANALYSIS = 2 * 60 * 1000; // 2 phút
const ANALYSIS_TIMEOUT = 30000;            // 30 giây timeout
const GEMMA_B_URL = process.env.GEMMA_B_URL || 'https://api-inference.huggingface.co/models/google/gemma-4-31b-it';
const GEMMA_B_TOKEN = process.env.GEMMA_B_TOKEN || process.env.BRAIN_TOKEN;

let pendingMessages = 0;
let isAnalyzing = false;
let lastAnalysisTime = 0;
let lastStrategyNotes = null;

/**
 * Gọi khi có tin nhắn mới (từ index.js)
 */
function notifyNewMessage() {
    pendingMessages++;
    console.log(`[ReasonerB] New message (pending: ${pendingMessages})`);

    // Nếu đang phân tích, chỉ đếm và thoát
    if (isAnalyzing) return;

    // Kiểm tra điều kiện trigger
    if (pendingMessages >= ANALYSIS_INTERVAL) {
        const now = Date.now();
        if (now - lastAnalysisTime >= MIN_TIME_BETWEEN_ANALYSIS) {
            triggerAnalysis();
        } else {
            // Lên lịch sau khi đủ thời gian
            const waitTime = MIN_TIME_BETWEEN_ANALYSIS - (now - lastAnalysisTime);
            console.log(`[ReasonerB] Scheduling analysis in ${waitTime/1000}s`);
            setTimeout(() => {
                if (pendingMessages >= ANALYSIS_INTERVAL && !isAnalyzing) {
                    triggerAnalysis();
                }
            }, waitTime + 1000);
        }
    }
}

/**
 * Kích hoạt phân tích nền (fire-and-forget)
 */
function triggerAnalysis() {
    if (isAnalyzing) return;
    isAnalyzing = true;
    const count = pendingMessages;
    pendingMessages = 0;

    console.log(`[ReasonerB] Starting analysis (${count} new messages)`);

    // Chạy bất đồng bộ, không await
    runAnalysis()
        .then(() => {
            console.log('[ReasonerB] Analysis completed');
        })
        .catch((err) => {
            console.error('[ReasonerB] Analysis error:', err.message);
            // Khôi phục số tin nhắn nếu lỗi (tùy chọn)
            pendingMessages += count;
        })
        .finally(() => {
            isAnalyzing = false;
            lastAnalysisTime = Date.now();
            // Nếu có tin nhắn mới trong lúc phân tích, kích hoạt lại
            if (pendingMessages >= ANALYSIS_INTERVAL) {
                setTimeout(() => triggerAnalysis(), 5000);
            }
        });
}

/**
 * Phân tích thực tế
 */
async function runAnalysis() {
    const memoryManager = getMemoryManager();
    const memory = memoryManager.memory;
    const affection = memoryManager.getAffection();

    // Đọc dữ liệu từ Firebase (để có đầy đủ)
    const firebaseData = await firebase.loadMemory();
    const fullMemory = firebaseData || memory;

    // Xây dựng prompt
    const prompt = buildPrompt(fullMemory, affection);

    // Gọi Gemma B
    const analysis = await callGemmaB(prompt);

    // Lưu kết quả vào Firebase
    const strategyNotes = {
        analysis,
        timestamp: Date.now(),
        affection,
        totalChats: fullMemory.totalChats || 0,
        eventsCount: fullMemory.events?.length || 0
    };
    await firebase.saveStrategyNotes(strategyNotes);
    lastStrategyNotes = strategyNotes;
    console.log('[ReasonerB] Strategy notes saved');
}

/**
 * Xây dựng prompt cho Gemma B
 */
function buildPrompt(memory, affection) {
    const facts = memory.facts || [];
    const events = (memory.events || []).slice(-10).map(e => typeof e === 'string' ? e : e.event).join('\n- ');
    const questions = memory.questionsAsked || [];
    const topics = memory.favoriteTopics || {};
    const topTopics = Object.entries(topics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t, c]) => `${t} (${c})`).join(', ');

    return `
Bạn là nhà phân tích tâm lý, đánh giá dữ liệu về ông Tư - nông dân Minecraft.

DỮ LIỆU:
- Affection: ${affection}/100
- Sự kiện gần đây:
${events || 'Không có'}
- Facts:
${facts.slice(-5).map(f => '- ' + f).join('\n') || 'Không có'}
- Số câu hỏi đã hỏi: ${questions.length}
- Chủ đề yêu thích: ${topTopics || 'Chưa có'}
- Tổng chat: ${memory.totalChats || 0}
- Lúa tặng: ${memory.totalWheatGiven || 0}

YÊU CẦU: Đưa ra phân tích dạng JSON:
{
  "relationship_assessment": { "level": "thân_thiết|bình_thường|xa_cách", "explanation": "...", "suggestion": "..." },
  "important_facts": ["fact1", "fact2", "fact3"],
  "tone_suggestion": { "style": "thân_mật|lịch_sự|vui_vẻ|trầm_tư", "description": "...", "example_phrases": ["..."] },
  "conversation_strategy": { "topics_to_encourage": ["..."], "topics_to_avoid": ["..."], "strategy": "..." },
  "memory_highlights": { "most_memorable_moments": ["..."], "recent_impact": "..." }
}
Chỉ trả về JSON hợp lệ, dùng tiếng Việt.
`;
}

/**
 * Gọi API Gemma B
 */
async function callGemmaB(prompt) {
    try {
        const response = await axios.post(GEMMA_B_URL, {
            inputs: prompt,
            parameters: {
                max_new_tokens: 600,
                temperature: 0.7,
                top_p: 0.9,
                do_sample: true,
                return_full_text: false
            }
        }, {
            timeout: ANALYSIS_TIMEOUT,
            headers: {
                'Authorization': `Bearer ${GEMMA_B_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        let text = response.data?.[0]?.generated_text || response.data;
        if (typeof text !== 'string') text = JSON.stringify(text);
        return parseAnalysis(text);
    } catch (err) {
        console.error('[ReasonerB] API error:', err.message);
        throw err;
    }
}

/**
 * Parse JSON từ response
 */
function parseAnalysis(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return getDefaultAnalysis();
        const parsed = JSON.parse(match[0]);
        // Kiểm tra cấu trúc cơ bản
        if (parsed.relationship_assessment && parsed.important_facts) {
            return parsed;
        }
        return getDefaultAnalysis();
    } catch {
        return getDefaultAnalysis();
    }
}

/**
 * Phân tích mặc định khi lỗi
 */
function getDefaultAnalysis() {
    return {
        relationship_assessment: {
            level: 'bình_thường',
            explanation: 'Chưa đủ dữ liệu',
            suggestion: 'Tiếp tục trò chuyện'
        },
        important_facts: ['Chưa có sự kiện nổi bật'],
        tone_suggestion: {
            style: 'lịch_sự',
            description: 'Giọng điệu thân thiện',
            example_phrases: ['Chào anh', 'Cảm ơn']
        },
        conversation_strategy: {
            topics_to_encourage: ['Vườn tược', 'Cuộc sống'],
            topics_to_avoid: ['Chủ đề nhạy cảm'],
            strategy: 'Tạo không khí thoải mái'
        },
        memory_highlights: {
            most_memorable_moments: ['Lần đầu gặp'],
            recent_impact: 'Chưa có tác động lớn'
        }
    };
}

/**
 * Lấy strategy notes từ cache (cho brain.js dùng)
 */
function getStrategyNotesCache() {
    return lastStrategyNotes;
}

/**
 * Reset trạng thái (cho test)
 */
function resetReasoner() {
    pendingMessages = 0;
    isAnalyzing = false;
    lastAnalysisTime = 0;
    lastStrategyNotes = null;
}

module.exports = {
    notifyNewMessage,
    getStrategyNotesCache,
    resetReasoner,
    // Export cho test
    _triggerAnalysis: triggerAnalysis,
    _runAnalysis: runAnalysis
};
