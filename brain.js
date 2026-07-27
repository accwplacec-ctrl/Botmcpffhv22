// brain.js
const axios = require('axios');
const firebase = require('./firebase');
const { buildSystemPrompt, extractQuestions } = require('./persona');
const getMemoryManager = require('./memory');

// Cache URL ngrok để tránh gọi Firebase quá nhiều
let cachedNgrokUrl = null;
let lastUrlFetch = 0;
const URL_CACHE_TTL = 5000; // 5 giây

async function getNgrokUrl() {
  const now = Date.now();
  if (cachedNgrokUrl && (now - lastUrlFetch) < URL_CACHE_TTL) {
    return cachedNgrokUrl;
  }
  
  try {
    const url = await firebase.getRelayUrl();
    if (url) {
      cachedNgrokUrl = url;
      lastUrlFetch = now;
      console.log(`[Brain] Fetched ngrok URL: ${url}`);
      return url;
    }
  } catch (error) {
    console.error('[Brain] Failed to fetch ngrok URL:', error);
  }
  
  // Fallback về URL cũ nếu có
  if (cachedNgrokUrl) {
    console.warn('[Brain] Using cached URL (stale)');
    return cachedNgrokUrl;
  }
  
  throw new Error('No ngrok URL available');
}

async function callBrainAPI(prompt, userMessage) {
  const url = await getNgrokUrl();
  const brainToken = process.env.BRAIN_TOKEN || 'botmcp';
  
  try {
    const response = await axios.post(url, {
      prompt: prompt,
      message: userMessage,
      token: brainToken
    }, {
      timeout: 15000, // 15 giây timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.reply) {
      return response.data.reply;
    }
    
    throw new Error('Invalid response from brain');
    
  } catch (error) {
    console.error('[Brain] API call failed:', error.message);
    throw error;
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

  // Fallback responses khi không thể kết nối
  const fallbacks = [
    "Trời ơi, tui đang bận gì đó, để tui xem lại đã nghen!",
    "Hả? Anh nói gì đó? Tui già rồi nghe không rõ!",
    "Mần ruộng mệt quá, để tui nghỉ xíu rồi nói chuyện tiếp!",
    "Ủa? Sao tự nhiên tui quên mất rồi!",
    "Trời ơi, tui hông biết trả lời sao nữa!"
  ];

  try {
    // Build system prompt
    const prompt = buildSystemPrompt({
      ownerName,
      affection,
      mood,
      memory,
      workingMemory,
      inventory,
      recentChats,
      askedQuestions: questionsAsked
    });

    // Gọi API
    const reply = await callBrainAPI(prompt, userMessage);
    
    // Trích xuất câu hỏi từ reply
    const newQuestions = extractQuestions(reply);
    
    // Lưu câu hỏi vào memory nếu có
    if (newQuestions.length > 0) {
      const memoryManager = getMemoryManager();
      newQuestions.forEach(q => {
        memoryManager.addQuestionAsked(q);
      });
    }
    
    return {
      reply: reply || fallbacks[Math.floor(Math.random() * fallbacks.length)],
      questions: newQuestions
    };
    
  } catch (error) {
    console.error('[Brain] Error:', error);
    
    // Trả về fallback
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
    "Mần ruộng mệt quá, để tui nghỉ xíu rồi nói chuyện tiếp!",
    "Ủa? Sao tự nhiên tui quên mất rồi!",
    "Trời ơi, tui hông biết trả lời sao nữa!"
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

module.exports = { askBrain, getFallbackResponse };
