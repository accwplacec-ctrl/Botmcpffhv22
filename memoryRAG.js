const { createClient } = require('@supabase/supabase-js');

/**
 * MemoryRAG – Quản lý trí nhớ dài hạn với Supabase
 * - Sử dụng Full-Text Search (tsvector) để tìm kiếm thông minh
 * - Fallback sang ilike nếu textSearch lỗi
 * - Hỗ trợ tiếng Việt (nếu có cấu hình) hoặc dùng 'simple'
 */
class MemoryRAG {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.table = 'rag_documents';
    this.fallbackMode = false; // Chuyển sang true nếu textSearch liên tục lỗi
    console.log(`📚 RAG: Kết nối tới Supabase, bảng: ${this.table}`);
  }

  /**
   * Thêm một đoạn văn bản vào bộ nhớ
   * @param {string} text - Nội dung cần nhớ
   * @param {object} metadata - Thông tin bổ sung (username, type, timestamp...)
   */
  async addDocument(text, metadata = {}) {
    if (!text || text.trim().length === 0) return;
    
    try {
      const { error } = await this.supabase
        .from(this.table)
        .insert({ 
          content: text, 
          metadata: metadata || {} 
        });
      
      if (error) {
        console.error('[RAG] Lỗi insert:', error.message, error.details || '');
      }
    } catch (err) {
      console.error('[RAG] Ngoại lệ insert:', err.message);
    }
  }

  /**
   * Tìm kiếm các đoạn văn bản liên quan tới truy vấn
   * @param {string} query - Câu hỏi / từ khóa
   * @param {number} topK - Số lượng kết quả tối đa
   * @returns {Promise<string[]>} - Mảng các nội dung tìm được
   */
  async search(query, topK = 5) {
    if (!query || query.trim().length === 0) return [];

    // Nếu đã chuyển sang fallback, dùng ilike luôn
    if (this.fallbackMode) {
      return this.searchILike(query, topK);
    }

    try {
      // Dùng textSearch với cột tsv
      const { data, error } = await this.supabase
        .from(this.table)
        .select('content, created_at')
        .textSearch('tsv', query, {
          config: 'simple', // Dùng 'simple' để hỗ trợ Unicode, không cần cấu hình tiếng Việt
          type: 'websearch'  // Cho phép tìm kiếm tự nhiên: "tặng lúa" hoặc "tặng & lúa"
        })
        .order('created_at', { ascending: false })
        .limit(topK);

      if (error) {
        // Nếu lỗi, chuyển sang fallback và ghi log
        console.warn('[RAG] textSearch lỗi, chuyển sang fallback ilike:', error.message);
        this.fallbackMode = true;
        return this.searchILike(query, topK);
      }

      if (!data || data.length === 0) {
        // Không tìm thấy với textSearch, thử ilike
        return this.searchILike(query, topK);
      }

      return data.map(row => row.content);
    } catch (err) {
      console.error('[RAG] search exception:', err.message);
      this.fallbackMode = true;
      return this.searchILike(query, topK);
    }
  }

  /**
   * Fallback: Tìm kiếm đơn giản bằng ilike (giống như phiên bản cũ)
   * @param {string} query - Từ khóa
   * @param {number} topK - Số lượng kết quả
   * @returns {Promise<string[]>}
   */
  async searchILike(query, topK = 5) {
    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('content')
        .ilike('content', `%${query}%`)
        .limit(topK);
      
      if (error) {
        console.error('[RAG] ilike lỗi:', error.message);
        return [];
      }
      
      return data.map(row => row.content);
    } catch (err) {
      console.error('[RAG] ilike exception:', err.message);
      return [];
    }
  }

  /**
   * Lấy ngữ cảnh cho một câu hỏi
   * @param {string} query - Câu hỏi
   * @param {number} topK - Số lượng kết quả
   * @returns {Promise<string[]>}
   */
  async getContext(query, topK = 5) {
    return await this.search(query, topK);
  }
}

module.exports = MemoryRAG;
