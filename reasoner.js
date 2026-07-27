// reasoner.js - Module Reasoner B chạy nền
const axios = require('axios');
const firebase = require('./firebase');
const getMemoryManager = require('./memory');

// Cấu hình
const ANALYSIS_INTERVAL = 5;
const MIN_TIME_BETWEEN_ANALYSIS = 2 * 60 * 1000;
const ANALYSIS_TIMEOUT = 30000;
const GEMMA_B_URL = process.env.GEMMA_B_URL || null;
const BRAIN_TOKEN = process.env.BRAIN_TOKEN || '';

let pendingMessages = 0;
let isAnalyzing = false;
let lastAnalysisTime = 0;
let lastStrategyNotes = null;

function notifyNewMessage() {
    pendingMessages++;
    if (isAnalyzing) return;
    const now = Date.now();
    if (pendingMessages >= ANALYSIS_INTERVAL && (now - lastAnalysisTime) >= MIN_TIME_BETWEEN_ANALYSIS) {
        triggerAnalysis();
    } else if (pendingMessages >= ANALYSIS_INTERVAL) {
        const waitTime = MIN_TIME_BETWEEN_ANALYSIS - (now - lastAnalysisTime);
        setTimeout(() => {
            if (pendingMessages >= ANALYSIS_INTERVAL && !isAnalyzing) triggerAnalysis();
        }, waitTime + 1000);
    }
}

function triggerAnalysis() {
    if (isAnalyzing) return;
    isAnalyzing = true;
    const count = pendingMessages;
    pendingMessages = 0;
    runAnalysis()
        .then(() => console.log('[ReasonerB] Analysis completed'))
        .catch(err => {
            console.error('[ReasonerB] Analysis error:', err.message);
            pendingMessages += count;
        })
        .finally(() => {
            isAnalyzing = false;
            lastAnalysisTime = Date.now();
            if (pendingMessages >= ANALYSIS_INTERVAL) {
                setTimeout(() => triggerAnalysis(), 5000);
            }
        });
}

async function runAnalysis() {
    const memoryManager = getMemoryManager();
    const memory = memoryManager.memory;
    const affection = memoryManager.getAffection();
    const firebaseData = await firebase.loadMemory();
    const fullMemory = firebaseData || memory;
    const prompt = buildPrompt(fullMemory, affection);
    const analysis = await callGemmaB(prompt);
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

async function callGemmaB(prompt) {
    let url = GEMMA_B_URL;
    if (!url) {
        const relay = await firebase.getRelayUrl();
        if (relay) {
            url = relay;
            console.log('[ReasonerB] Using relay URL from Firebase');
        } else {
            url = 'https://api-inference.huggingface.co/models/google/gemma-4-31b-it';
        }
    }
    if (url.includes('huggingface.co')) {
        return callHuggingFace(url, prompt);
    } else {
        return callCustomEndpoint(url, prompt);
    }
}

async function callHuggingFace(url, prompt) {
    try {
        const response = await axios.post(url, {
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
                'Authorization': `Bearer ${BRAIN_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        let text = response.data?.[0]?.generated_text || response.data;
        if (typeof text !== 'string') text = JSON.stringify(text);
        return parseAnalysis(text);
    } catch (err) {
        console.error('[ReasonerB] HuggingFace error:', err.message);
        throw err;
    }
}

async function callCustomEndpoint(url, prompt) {
    try {
        const payload = { prompt, message: '', token: BRAIN_TOKEN };
        const response = await axios.post(url, payload, {
            timeout: ANALYSIS_TIMEOUT,
            headers: { 'Content-Type': 'application/json' }
        });
        let text = response.data?.reply || response.data?.generated_text || response.data;
        if (typeof text !== 'string') text = JSON.stringify(text);
        return parseAnalysis(text);
    } catch (err) {
        console.error('[ReasonerB] Custom endpoint error:', err.message);
        throw err;
    }
}

function parseAnalysis(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return getDefaultAnalysis();
        const parsed = JSON.parse(match[0]);
        if (parsed.relationship_assessment && parsed.important_facts) return parsed;
        return getDefaultAnalysis();
    } catch {
        return getDefaultAnalysis();
    }
}

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

function getStrategyNotesCache() {
    return lastStrategyNotes;
}

function resetReasoner() {
    pendingMessages = 0;
    isAnalyzing = false;
    lastAnalysisTime = 0;
    lastStrategyNotes = null;
}

module.exports = {
    notifyNewMessage,
    getStrategyNotesCache,
    resetReasoner
};
