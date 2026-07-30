import dotenv from "dotenv";
dotenv.config();

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

// ============================================================================
// 1. KHỞI TẠO VÀ NẠP DỮ LIỆU VÀO VECTOR STORE
// ============================================================================
async function setupVectorStore() {
  console.log("🔄 Đang khởi tạo Vector Store...");
  
  // Dữ liệu tài liệu mẫu (Thực tế bạn có thể load từ file PDF, TXT, JSON...)
  const docs = [
    new Document({
      pageContent: "Dự án Alpha là một hệ thống quản lý kho thông minh sử dụng trí tuệ nhân tạo (AI).",
      metadata: { source: "overview.pdf" },
    }),
    new Document({
      pageContent: "Dự án Alpha được phát triển bằng Node.js ở Backend, React ở Frontend và PostgreSQL làm Database.",
      metadata: { source: "tech_stack.pdf" },
    }),
    new Document({
      pageContent: "Ngân sách của dự án Alpha là 50,000 USD và dự kiến hoàn thành vào tháng 12 năm 2026.",
      metadata: { source: "budget.pdf" },
    }),
  ]);

  // Tạo Embeddings và lưu vào In-Memory Vector DB (HNSWLib)
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
  console.log("✅ Vector Store đã sẵn sàng!");
  return vectorStore;
}

// ============================================================================
// 2. KHỞI TẠO RAG CHAIN CÓ BỘ NHỚ (MEMORY)
// ============================================================================
async function createMemoryRAGChain(vectorStore) {
  // Model LLM chính
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.2,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const retriever = vectorStore.asRetriever({ k: 2 });

  // A. Prompt & Chain viết lại câu hỏi dựa trên lịch sử (History-Aware Retriever)
  // Giúp chuyển câu thiếu ngữ cảnh (vd: "Nó dùng DB gì?") thành câu độc lập (vd: "Dự án Alpha dùng DB gì?")
  const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Given a chat history and the latest user question which might reference context in the chat history, " +
      "formulate a standalone question which can be understood without the chat history. " +
      "Do NOT answer the question, just reformulate it if needed and otherwise return it as is.",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const historyAwareRetriever = await createHistoryAwareRetriever({
    llm,
    retriever,
    rephrasePrompt: contextualizeQPrompt,
  });

  // B. Prompt & Chain tổng hợp câu trả lời dựa trên Context trả về
  const qaPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Bạn là một trợ lý AI thông minh. Hãy trả lời câu hỏi của người dùng dựa vào tài liệu được cung cấp dưới đây.\n" +
      "Nếu không tìm thấy thông tin trong tài liệu, hãy nói rõ là bạn không biết, đừng tự suy đoán.\n\n" +
      "Tài liệu tham khảo:\n{context}",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const questionAnswerChain = await createStuffDocumentsChain({
    llm,
    prompt: qaPrompt,
  });

  // C. Kết hợp thành RAG Chain hoàn chỉnh
  const ragChain = await createRetrievalChain({
    retriever: historyAwareRetriever,
    combineDocsChain: questionAnswerChain,
  });

  // D. Quản lý Bộ nhớ Chat History theo từng Session ID
  const messageHistories = {};

  const conversationalRagChain = new RunnableWithMessageHistory({
    runnable: ragChain,
    getMessageHistory: async (sessionId) => {
      if (messageHistories[sessionId] === undefined) {
        messageHistories[sessionId] = new ChatMessageHistory();
      }
      return messageHistories[sessionId];
    },
    inputMessagesKey: "input",
    historyMessagesKey: "chat_history",
    outputMessagesKey: "answer",
  });

  return conversationalRagChain;
}

// ============================================================================
// 3. HÀM CHẠY THỬ VÀ TEST CONVERSATION
// ============================================================================
async function main() {
  try {
    const vectorStore = await setupVectorStore();
    const ragChain = await createMemoryRAGChain(vectorStore);

    // Cấu hình ID phiên làm việc của user (Session ID)
    const sessionConfig = {
      configurable: { sessionId: "user_session_001" },
    };

    console.log("\n--- BẮT ĐẦU HỘI THOẠI ---\n");

    // Lần 1: Hỏi về Dự án Alpha
    const q1 = "Dự án Alpha là gì và công nghệ sử dụng là gì?";
    console.log(`👤 User: ${q1}`);
    const res1 = await ragChain.invoke({ input: q1 }, sessionConfig);
    console.log(`🤖 AI: ${res1.answer}\n`);

    // Lần 2: Hỏi tham chiếu ("Nó") - LLM sẽ hiểu nhờ Memory
    const q2 = "Ngân sách của nó là bao nhiêu?";
    console.log(`👤 User: ${q2}`);
    const res2 = await ragChain.invoke({ input: q2 }, sessionConfig);
    console.log(`🤖 AI: ${res2.answer}\n`);

    // Lần 3: Hỏi thông tin không có trong tài liệu
    const q3 = "Ai là trưởng dự án Alpha?";
    console.log(`👤 User: ${q3}`);
    const res3 = await ragChain.invoke({ input: q3 }, sessionConfig);
    console.log(`🤖 AI: ${res3.answer}\n`);

  } catch (error) {
    console.error("❌ Có lỗi xảy ra:", error);
  }
}

main();
