// memory.js
const firebase = require('./firebase');
const { isSimilarQuestion } = require('./persona');

class MemoryManager {
  constructor() {
    this.memory = {
      facts: [],
      events: [],
      questionsAsked: [], // Lưu câu hỏi đã hỏi
      totalWheatGiven: 0,
      lastDeathReason: null,
      deathNotified: false,
      lastInteraction: Date.now(),
      affection: 50,
      // Thêm các thuộc tính mới
      totalHarvests: 0,
      lastHarvestTime: null,
      totalChats: 0,
      favoriteTopics: {},
    };
    
    this.isLoaded = false;
    this.lastSave = Date.now();
    this.saveInterval = null;
    
    // Tự động lưu mỗi 5 phút
    setInterval(() => this.saveMemory(), 5 * 60 * 1000);
  }

  // ========== KHỞI TẠO ==========
  async init() {
    try {
      await this.loadMemory();
      this.isLoaded = true;
      console.log('[Memory] Loaded successfully');
    } catch (error) {
      console.error('[Memory] Failed to load:', error);
      this.isLoaded = false;
    }
  }

  // ========== LƯU & LOAD ==========
  async loadMemory() {
    try {
      const data = await firebase.loadMemory();
      if (data) {
        // Merge cẩn thận để không mất dữ liệu mới
        this.memory = { ...this.memory, ...data };
        
        // Đảm bảo các mảng tồn tại
        if (!this.memory.facts) this.memory.facts = [];
        if (!this.memory.events) this.memory.events = [];
        if (!this.memory.questionsAsked) this.memory.questionsAsked = [];
        if (!this.memory.favoriteTopics) this.memory.favoriteTopics = {};
        
        console.log(`[Memory] Loaded: ${this.memory.facts.length} facts, ${this.memory.events.length} events, ${this.memory.questionsAsked.length} questions`);
      }
    } catch (error) {
      console.error('[Memory] Load error:', error);
      throw error;
    }
  }

  async saveMemory() {
    try {
      // Chỉ lưu khi đã load và có thay đổi
      if (!this.isLoaded) return;
      
      const now = Date.now();
      if (now - this.lastSave < 10000) return; // Không lưu quá thường xuyên
      
      await firebase.saveMemory(this.memory);
      this.lastSave = now;
      console.log('[Memory] Saved successfully');
    } catch (error) {
      console.error('[Memory] Save error:', error);
    }
  }

  // ========== QUẢN LÝ TÌNH CẢM ==========
  getAffection() {
    return Math.min(100, Math.max(0, this.memory.affection || 50));
  }

  setAffection(value) {
    this.memory.affection = Math.min(100, Math.max(0, value));
    this.memory.lastInteraction = Date.now();
    this.saveMemory();
  }

  changeAffection(delta) {
    const current = this.getAffection();
    const newValue = Math.min(100, Math.max(0, current + delta));
    this.memory.affection = newValue;
    this.memory.lastInteraction = Date.now();
    this.saveMemory();
    return newValue;
  }

  // ========== QUẢN LÝ CÂU HỎI ==========
  addQuestionAsked(question) {
    if (!question || typeof question !== 'string') return;
    
    const q = question.trim();
    if (q.length < 3) return;
    
    // Không lưu câu hỏi quá chung chung
    const genericQuestions = ['sao', 'chi', 'răng', 'hả', 'nhỉ', 'không', 'hông'];
    if (genericQuestions.some(g => q.toLowerCase() === g)) return;
    
    // Kiểm tra trùng lặp gần đây
    const isDuplicate = this.memory.questionsAsked.some(item => {
      const timeDiff = Date.now() - item.askedAt;
      if (timeDiff > 30 * 60 * 1000) return false; // Quá 30p thì bỏ qua
      return isSimilarQuestion(q, item.question);
    });
    
    if (isDuplicate) {
      console.log(`[Memory] Question duplicate: "${q}"`);
      return;
    }
    
    this.memory.questionsAsked.push({
      question: q,
      askedAt: Date.now(),
      // Lưu thêm context
      context: {
        affection: this.getAffection(),
        mood: 'current_mood' // Sẽ được cập nhật từ bên ngoài
      }
    });
    
    // Giữ tối đa 20 câu hỏi
    if (this.memory.questionsAsked.length > 20) {
      this.memory.questionsAsked = this.memory.questionsAsked.slice(-20);
    }
    
    // Cập nhật thống kê
    this.memory.totalChats = (this.memory.totalChats || 0) + 1;
    this.saveMemory();
    
    console.log(`[Memory] Added question: "${q}" (total: ${this.memory.questionsAsked.length})`);
  }

  getRecentQuestions(limit = 5) {
    if (!this.memory.questionsAsked || this.memory.questionsAsked.length === 0) {
      return [];
    }
    
    // Lọc câu hỏi trong 30 phút gần đây
    const cutoff = Date.now() - 30 * 60 * 1000;
    const recent = this.memory.questionsAsked
      .filter(item => item.askedAt > cutoff)
      .slice(-limit)
      .map(item => item.question);
    
    return recent;
  }

  getAllQuestions(limit = 10) {
    if (!this.memory.questionsAsked) return [];
    return this.memory.questionsAsked
      .slice(-limit)
      .map(item => item.question);
  }

  hasAskedQuestion(question, timeWindow = 30 * 60 * 1000) {
    if (!question || !this.memory.questionsAsked) return false;
    
    const q = question.trim();
    const cutoff = Date.now() - timeWindow;
    
    return this.memory.questionsAsked.some(item => {
      if (item.askedAt < cutoff) return false;
      return isSimilarQuestion(q, item.question);
    });
  }

  // ========== QUẢN LÝ SỰ KIỆN ==========
  addEvent(event, importance = 1) {
    if (!event) return;
    
    this.memory.events.push({
      event: event,
      time: Date.now(),
      importance: Math.min(5, Math.max(1, importance))
    });
    
    // Giữ tối đa 50 sự kiện
    if (this.memory.events.length > 50) {
      this.memory.events = this.memory.events.slice(-50);
    }
    
    this.saveMemory();
  }

  getRecentEvents(limit = 5) {
    if (!this.memory.events) return [];
    return this.memory.events
      .slice(-limit)
      .map(e => e.event);
  }

  // ========== QUẢN LÝ FACT ==========
  addFact(fact) {
    if (!fact) return;
    
    // Kiểm tra trùng lặp
    const isDuplicate = this.memory.facts.some(f => 
      f.toLowerCase().includes(fact.toLowerCase()) || 
      fact.toLowerCase().includes(f.toLowerCase())
    );
    
    if (isDuplicate) return;
    
    this.memory.facts.push(fact);
    
    // Giữ tối đa 20 facts
    if (this.memory.facts.length > 20) {
      this.memory.facts = this.memory.facts.slice(-20);
    }
    
    this.saveMemory();
  }

  getFacts() {
    return this.memory.facts || [];
  }

  // ========== QUẢN LÝ LÚA ==========
  addWheat(count = 1) {
    this.memory.totalWheatGiven = (this.memory.totalWheatGiven || 0) + count;
    this.saveMemory();
    return this.memory.totalWheatGiven;
  }

  getTotalWheat() {
    return this.memory.totalWheatGiven || 0;
  }

  // ========== QUẢN LÝ CHẾT ==========
  setLastDeath(reason) {
    this.memory.lastDeathReason = reason;
    this.memory.deathNotified = false;
    this.saveMemory();
  }

  getLastDeath() {
    return {
      reason: this.memory.lastDeathReason,
      notified: this.memory.deathNotified || false
    };
  }

  markDeathNotified() {
    this.memory.deathNotified = true;
    this.saveMemory();
  }

  // ========== QUẢN LÝ CHỦ ĐỀ YÊU THÍCH ==========
  addFavoriteTopic(topic) {
    if (!topic) return;
    
    const key = topic.toLowerCase().trim();
    this.memory.favoriteTopics[key] = (this.memory.favoriteTopics[key] || 0) + 1;
    
    // Tự động lưu khi thay đổi
    this.saveMemory();
  }

  getFavoriteTopics(limit = 5) {
    if (!this.memory.favoriteTopics) return [];
    
    return Object.entries(this.memory.favoriteTopics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic, count]) => ({ topic, count }));
  }

  // ========== QUẢN LÝ THU HOẠCH ==========
  addHarvest(count = 1) {
    this.memory.totalHarvests = (this.memory.totalHarvests || 0) + count;
    this.memory.lastHarvestTime = Date.now();
    this.saveMemory();
  }

  getHarvestStats() {
    return {
      total: this.memory.totalHarvests || 0,
      lastHarvest: this.memory.lastHarvestTime || null
    };
  }

  // ========== LẤY TÓM TẮT ==========
  getMemorySummary() {
    const parts = [];
    
    // Facts
    if (this.memory.facts && this.memory.facts.length > 0) {
      parts.push(`- Bạn nhớ: ${this.memory.facts.slice(-5).join('. ')}`);
    }
    
    // Events
    if (this.memory.events && this.memory.events.length > 0) {
      const recent = this.memory.events.slice(-3).map(e => e.event);
      parts.push(`- Gần đây: ${recent.join('. ')}`);
    }
    
    // Wheat
    const wheat = this.getTotalWheat();
    if (wheat > 0) {
      parts.push(`- Đã tặng ${wheat} cục lúa cho chủ`);
    }
    
    // Harvest
    const harvest = this.getHarvestStats();
    if (harvest.total > 0) {
      parts.push(`- Đã thu hoạch ${harvest.total} vụ lúa`);
    }
    
    return parts.length > 0 ? parts.join('\n') : 'Chưa có nhiều kỷ niệm';
  }

  // ========== TOOL ==========
  getStats() {
    return {
      affection: this.getAffection(),
      totalWheat: this.getTotalWheat(),
      totalEvents: this.memory.events?.length || 0,
      totalFacts: this.memory.facts?.length || 0,
      totalQuestions: this.memory.questionsAsked?.length || 0,
      totalChats: this.memory.totalChats || 0,
      totalHarvests: this.memory.totalHarvests || 0,
      lastInteraction: this.memory.lastInteraction || null,
      lastSave: this.lastSave
    };
  }

  // ========== RESET ==========
  async reset() {
    this.memory = {
      facts: [],
      events: [],
      questionsAsked: [],
      totalWheatGiven: 0,
      lastDeathReason: null,
      deathNotified: false,
      lastInteraction: Date.now(),
      affection: 50,
      totalHarvests: 0,
      lastHarvestTime: null,
      totalChats: 0,
      favoriteTopics: {},
    };
    await this.saveMemory();
    console.log('[Memory] Reset complete');
  }
}

// Singleton
let instance = null;

function getMemoryManager() {
  if (!instance) {
    instance = new MemoryManager();
  }
  return instance;
}

module.exports = getMemoryManager;
