// memoryRAG.js
const { createClient } = require('@supabase/supabase-js');

/**
 * MemoryRAG – quản lý trí nhớ dài hạn với Supabase
 * - Lưu các đoạn văn bản (tin nhắn, sự kiện) vào bảng `rag_documents`
 * - Tìm kiếm bằng full‑text search (có fallback LIKE)
 * - Hỗ trợ thêm metadata (username, timestamp,...)
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
  }

  /**
   * Thêm một đoạn văn bản vào bộ nhớ
   * @param {string} text        - Nội dung cần nhớ
   * @param {object} metadata    - Thông tin bổ sung (ví dụ: { username, timestamp })
   */
  async addDocument(text, metadata = {}) {
    if (!text || text.trim().length === 0) return;
    try {
      const { error } = await this.supabase
        .from(this.table)
        .insert({ content: text, metadata });
      if (error) {
        console.error('[RAG] Lỗi khi thêm document:', error.message);
      }
    } catch (err) {
      console.error('[RAG] Ngoại lệ khi thêm document:', err);
    }
  }

  /**
   * Tìm kiếm các đoạn văn bản liên quan tới truy vấn
   * @param {string} query  - Câu hỏi / từ khoá
   * @param {number} topK   - Số lượng kết quả tối đa (mặc định 5)
   * @returns {Promise<string[]>} - Mảng các nội dung tìm được
   */
  async search(query, topK = 5) {
    if (!query || query.trim().length === 0) return [];

    try {
      // Sử dụng full‑text search (cần cột tsvector hoặc dùng hàm có sẵn)
      // Hàm textSearch của Supabase hỗ trợ sẵn
      const { data, error } = await this.supabase
        .from(this.table)
        .select('content')
        .textSearch('content', query, { config: 'vietnamese' }) // nếu có cấu hình tiếng Việt
        .limit(topK);

      if (error) {
        // Fallback: LIKE đơn giản nếu full‑text bị lỗi (ví dụ chưa tạo index)
        console.warn('[RAG] textSearch lỗi, chuyển sang LIKE fallback:', error.message);
        const { data: fallbackData, error: fallbackError } = await this.supabase
          .from(this.table)
          .select('content')
          .ilike('content', `%${query}%`)
          .limit(topK);
        if (fallbackError) throw fallbackError;
        return fallbackData.map(row => row.content);
      }

      return data.map(row => row.content);
    } catch (err) {
      console.error('[RAG] Lỗi tìm kiếm:', err);
      return [];
    }
  }

  /**
   * Lấy ngữ cảnh (context) cho một câu hỏi
   * @param {string} query  - Câu hỏi
   * @param {number} topK   - Số lượng kết quả
   * @returns {Promise<string[]>} - Mảng nội dung ngữ cảnh
   */
  async getContext(query, topK = 5) {
    return await this.search(query, topK);
  }
}

module.exports = MemoryRAG;
