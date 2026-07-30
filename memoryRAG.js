'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

// Khởi tạo Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Khởi tạo Google Gen AI SDK chuẩn mới
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Hàm lưu một đoạn ký ức mới vào Supabase Vector RAG
 * @param {string} content - Nội dung cần nhớ
 */
async function saveMemoryRAG(content) {
  try {
    if (!supabase || !process.env.GEMINI_API_KEY || !content) return;

    // 1. Tạo embedding cho nội dung bằng mô hình text-embedding-004
    const embeddingResult = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: content,
    });

    const embedding = embeddingResult.embedding.values;

    // 2. Insert vào bảng bot_rag_memories
    const { error } = await supabase
      .from('bot_rag_memories')
      .insert([{ content: content, embedding: embedding }]);

    if (error) {
      console.error('❌ Lỗi khi lưu RAG memory vào Supabase:', error.message);
    } else {
      console.log('🧠 Đã ghi nhớ vào Supabase RAG:', content);
    }
  } catch (err) {
    console.error('❌ Lỗi ngoại lệ khi saveMemoryRAG:', err.message);
  }
}

/**
 * Hàm truy vấn RAG kết hợp trí nhớ cũ từ Supabase Vector
 * @param {string} userQuery - Câu chat hiện tại của người chơi
 * @returns {Promise<string>} - Trả về chuỗi kiến thức nền để gieo vào prompt
 */
async function queryMemoryRAG(userQuery) {
  try {
    if (!supabase || !process.env.GEMINI_API_KEY) {
      return '';
    }

    // 1. Tạo embedding cho câu hỏi của người chơi bằng mô hình text-embedding-004 của Gemini
    const embeddingResult = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: userQuery,
    });

    const embedding = embeddingResult.embedding.values;

    // 2. Tìm kiếm các đoạn ký ức/tài liệu tương đồng trong Supabase thông qua hàm RPC match_memories
    const { data: matches, error } = await supabase.rpc('match_memories', {
      query_embedding: embedding,
      match_threshold: 0.5, // Ngưỡng tương đồng
      match_count: 3,        // Lấy tối đa 3 kết quả phù hợp nhất
    });

    if (error || !matches || matches.length === 0) {
      return '';
    }

    // 3. Tổng hợp lại thành đoạn kiến thức nền để nhét vào prompt của bot
    const contextText = matches.map((m) => m.content).join('\n- ');
    return `\n(Hệ thống cung cấp kiến thức nền liên quan:\n- ${contextText})\n`;
    
  } catch (err) {
    console.error('Lỗi khi truy vấn memoryRAG:', err.message);
    return '';
  }
}

module.exports = { saveMemoryRAG, queryMemoryRAG };
