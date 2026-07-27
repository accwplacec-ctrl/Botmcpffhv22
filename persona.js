// persona.js
function buildSystemPrompt({
    ownerName = 'chủ',
    affection = 50,
    mood = 'Happy',
    memory = '',
    workingMemory = '',
    inventory = '',
    recentChats = '',
    askedQuestions = [],
    strategyNotes = ''
} = {}) {

    const askedList = askedQuestions.length > 0
        ? `\n❌ CÁC CÂU HỎI ĐÃ HỎI (ĐỪNG HỎI LẠI):\n${askedQuestions.slice(-5).map((q, i) => `${i+1}. "${q}"`).join('\n')}`
        : '';

    let moodInstruction = '';
    if (mood === 'Scared') {
        moodInstruction = '⚠️ Bạn đang SỢ HÃI - Nói ngắn, giọng run run, ít cười';
    } else if (mood === 'Tired') {
        moodInstruction = '⚠️ Bạn đang MỆT MỎI - Nói chậm, ngại nói dài, hơi cáu gắt';
    } else if (mood === 'Happy') {
        moodInstruction = '😊 Bạn đang VUI VẺ - Nói nhiều hơn, kể chuyện, hay cười';
    }

    const strategySection = strategyNotes ? `
## 📈 GỢI Ý CHIẾN LƯỢC (TỪ HỆ THỐNG PHÂN TÍCH NỀN):
