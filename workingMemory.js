// workingMemory.js
class WorkingMemory {
  constructor() {
    this.memory = {
      flags: {}, // Cờ sự kiện
      recentTopics: [], // Chủ đề gần đây
      lastActions: [], // Hành động gần đây
      conversations: [], // Cuộc trò chuyện ngắn
      ownerNearby: false,
      lastOwnerPosition: null,
      threats: [], // Mối đe dọa gần đây
    };
    
    // Tự động dọn dẹp mỗi 30 giây
    setInterval(() => this.cleanup(), 30 * 1000);
  }

  // ========== FLAGS ==========
  setFlag(key, value = true, duration = 12 * 60 * 1000) { // 12 phút mặc định
    this.memory.flags[key] = {
      value,
      expiry: Date.now() + duration
    };
    this._log(`Flag set: ${key} = ${value} (expires in ${duration/60000}m)`);
  }

  getFlag(key) {
    const flag = this.memory.flags[key];
    if (!flag) return false;
    if (Date.now() > flag.expiry) {
      delete this.memory.flags[key];
      return false;
    }
    return flag.value;
  }

  clearFlag(key) {
    delete this.memory.flags[key];
    this._log(`Flag cleared: ${key}`);
  }

  // ========== TOPICS ==========
  addTopic(topic, weight = 1) {
    if (!topic) return;
    
    const existing = this.memory.recentTopics.find(
      t => t.topic.toLowerCase() === topic.toLowerCase()
    );
    
    if (existing) {
      existing.weight += weight;
      existing.time = Date.now();
    } else {
      this.memory.recentTopics.push({
        topic: topic.toLowerCase(),
        weight,
        time: Date.now()
      });
    }
    
    // Giới hạn 10 topics
    if (this.memory.recentTopics.length > 10) {
      this.memory.recentTopics = this.memory.recentTopics
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 10);
    }
  }

  getRecentTopics(limit = 5) {
    return this.memory.recentTopics
      .slice(-limit)
      .map(t => t.topic);
  }

  isTopicRecent(topic, minutes = 15) {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.memory.recentTopics.some(
      t => t.topic.includes(topic.toLowerCase()) && t.time > cutoff
    );
  }

  // ========== ACTIONS ==========
  addAction(action) {
    if (!action) return;
    
    this.memory.lastActions.push({
      action,
      time: Date.now()
    });
    
    if (this.memory.lastActions.length > 10) {
      this.memory.lastActions.shift();
    }
  }

  getRecentActions(limit = 5) {
    return this.memory.lastActions
      .slice(-limit)
      .map(a => a.action);
  }

  // ========== CONVERSATIONS ==========
  addConversation(speaker, message) {
    if (!message) return;
    
    this.memory.conversations.push({
      speaker,
      message: message.substring(0, 100), // Giới hạn độ dài
      time: Date.now()
    });
    
    if (this.memory.conversations.length > 20) {
      this.memory.conversations.shift();
    }
  }

  getRecentConversations(limit = 5) {
    return this.memory.conversations
      .slice(-limit)
      .map(c => `${c.speaker}: ${c.message}`);
  }

  getSummary() {
    const parts = [];
    
    // Flags
    const activeFlags = Object.entries(this.memory.flags)
      .filter(([_, flag]) => Date.now() < flag.expiry)
      .map(([key]) => key);
    
    if (activeFlags.length > 0) {
      parts.push(`- Đang nhớ: ${activeFlags.join(', ')}`);
    }
    
    // Topics
    const topics = this.getRecentTopics(3);
    if (topics.length > 0) {
      parts.push(`- Vừa nói về: ${topics.join(', ')}`);
    }
    
    // Owner
    if (this.memory.ownerNearby) {
      parts.push(`- Chủ đang ở gần đây`);
    }
    
    return parts.length > 0 ? parts.join('\n') : 'Không có gì đặc biệt';
  }

  // ========== OWNER ==========
  setOwnerNearby(nearby) {
    this.memory.ownerNearby = nearby;
    if (nearby) {
      this.memory.lastOwnerPosition = Date.now();
    }
  }

  isOwnerNearby() {
    // Tự động hết hạn sau 30 giây không cập nhật
    if (this.memory.ownerNearby) {
      if (Date.now() - (this.memory.lastOwnerPosition || 0) > 30 * 1000) {
        this.memory.ownerNearby = false;
        return false;
      }
    }
    return this.memory.ownerNearby;
  }

  // ========== THREATS ==========
  addThreat(type, position) {
    this.memory.threats.push({
      type,
      position,
      time: Date.now()
    });
    
    if (this.memory.threats.length > 5) {
      this.memory.threats.shift();
    }
  }

  getThreats() {
    const cutoff = Date.now() - 30 * 1000; // 30 giây
    return this.memory.threats
      .filter(t => t.time > cutoff)
      .map(t => t.type);
  }

  // ========== CLEANUP ==========
  cleanup() {
    const now = Date.now();
    
    // Dọn flags hết hạn
    Object.entries(this.memory.flags).forEach(([key, flag]) => {
      if (now > flag.expiry) {
        delete this.memory.flags[key];
      }
    });
    
    // Dọn topics cũ (15 phút)
    const topicCutoff = now - 15 * 60 * 1000;
    this.memory.recentTopics = this.memory.recentTopics
      .filter(t => t.time > topicCutoff);
    
    // Dọn conversations cũ (10 phút)
    const convCutoff = now - 10 * 60 * 1000;
    this.memory.conversations = this.memory.conversations
      .filter(c => c.time > convCutoff);
  }

  // ========== TOOL ==========
  _log(msg) {
    console.log(`[WorkingMemory] ${msg}`);
  }

  reset() {
    this.memory = {
      flags: {},
      recentTopics: [],
      lastActions: [],
      conversations: [],
      ownerNearby: false,
      lastOwnerPosition: null,
      threats: [],
    };
    this._log('Reset complete');
  }
}

// Singleton
let instance = null;

function getWorkingMemory() {
  if (!instance) {
    instance = new WorkingMemory();
  }
  return instance;
}

module.exports = getWorkingMemory;
