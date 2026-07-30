const { createClient } = require('@supabase/supabase-js');

class MemoryRAG {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
    }
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.table = 'rag_documents';
    console.log(`📚 RAG: Kết nối tới Supabase, bảng: ${this.table}`);
  }

  async addDocument(text, metadata = {}) {
    if (!text || text.trim().length === 0) return;
    try {
      const { error } = await this.supabase
        .from(this.table)
        .insert({ content: text, metadata });
      if (error) {
        console.error('[RAG] Lỗi insert:', error.message, error.details);
      }
    } catch (err) {
      console.error('[RAG] Ngoại lệ insert:', err.message);
    }
  }

  async search(query, topK = 5) {
    if (!query || query.trim().length === 0) return [];

    try {
      // Dùng ilike để tìm kiếm đơn giản (không cần full-text)
      const { data, error } = await this.supabase
        .from(this.table)
        .select('content')
        .ilike('content', `%${query}%`)
        .limit(topK);

      if (error) {
        console.error('[RAG] Lỗi search (ilike):', error.message, error.details);
        return [];
      }
      return data.map(row => row.content);
    } catch (err) {
      console.error('[RAG] Ngoại lệ search:', err.message);
      return [];
    }
  }

  async getContext(query, topK = 5) {
    return await this.search(query, topK);
  }
}

module.exports = MemoryRAG;
