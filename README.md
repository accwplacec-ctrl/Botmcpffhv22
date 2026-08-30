# Ông Tư — Bot Minecraft nhân cách hoá

Bot Minecraft đóng vai **Ông Tư**, một lão nông dân sống cố định trong khu vườn lúa mì trên server
`rune.pikamc.vn`. Bot được điều khiển bởi mineflayer, chạy trên **Railway**, và "bộ não" ra quyết
định/hội thoại là **Gemma qua Gemini API** chạy trong một server **Google Colab** có sẵn (không nằm
trong repo này — repo chỉ gọi đúng định dạng payload/response mà Colab đang dùng).

## Kiến trúc

```
Railway (Node.js/mineflayer)  <-- WS không dùng ở đây, gọi HTTP -->  Colab (Gemma/Gemini, expose qua ngrok)
            |                                                                 |
            |-------------------------- Firebase Realtime DB ---------------|
            (đọc URL ngrok mới nhất + đọc/ghi trí nhớ dài hạn)
```

- Railway **POST** payload đầy đủ (system prompt, prompt, emotional_state, memory_context, wheatCount)
  tới endpoint `/generate` của Colab, xác thực bằng header `X-Brain-Token`.
- Colab tự ghi URL ngrok mới nhất của nó lên Firebase (`FIREBASE_RELAY_PATH`); Railway đọc URL này
  realtime mỗi lượt gọi (có cache 5s) thay vì hardcode — chống việc ngrok đổi URL khi Colab restart.
- Firebase Realtime DB (`FIREBASE_MEMORY_PATH`) lưu trí nhớ **dài hạn**: affection, tổng lúa mì đã
  tặng, các facts, sự kiện, hội thoại gần đây, lý do chết gần nhất.

## Hệ thống cảm xúc 2 tầng

1. **Affection (0-100, lưu Firebase, đổi chậm)** — quyết định giọng điệu nền (thân thiết / lịch sự /
   trống không / dỗi hờn), tăng khi chat (tối đa +15/ngày) hoặc nhận quà, giảm ~1 điểm/giờ không tương tác.
2. **Mood tức thời (Tired/Scared/Happy, 0-100, chỉ in-memory, reset mỗi lần bot khởi động lại)** —
   tính toán độc lập bằng `moodEngine.js` chạy `setInterval` riêng, ưu tiên **Sợ > Mệt > Affection**
   khi ghép system prompt và khi tự động chọn hành động trong `farming loop`.

Mood **không** tự ý gọi Colab — nó chỉ được gửi kèm khi có một lượt gọi thật (chat của chủ hoặc lượt
proactive), đúng như yêu cầu tránh spam API.

## Hệ thống trí nhớ 2 loại

- **Ngắn hạn** (`workingMemory.js`): flags in-memory tự hết hạn sau ~12 phút, ví dụ `ruong_bi_pha`
  khi phát hiện chủ phá farmland/wheat trong lúc đứng sát bên (không tính nếu chỉ đi ngang qua).
- **Dài hạn** (`memory.js` + `firebase.js`): facts, events, tổng lúa mì đã tặng, mốc tròn, lý do chết
  gần nhất (chỉ nhắc 1 lần rồi thôi).

## Cấu trúc file

| File | Vai trò |
|---|---|
| `config.js` | Toàn bộ cấu hình tĩnh đọc từ `.env` |
| `firebase.js` | Kết nối Firebase Admin SDK, load/save memory, đọc relay URL |
| `memory.js` | Quản lý trí nhớ dài hạn + affection |
| `workingMemory.js` | Trí nhớ ngắn hạn in-memory, tự hết hạn |
| `moodEngine.js` | Mood tức thời (Tired/Scared/Happy), chạy interval riêng |
| `persona.js` | Ghép system prompt tiếng Việt đầy đủ cho Colab |
| `brain.js` | Gọi endpoint Colab, timeout 15s, parse an toàn, fallback |
| `garden.js` | Tiện ích bounding box khu vườn |
| `proactive.js` | Vòng lặp chủ động bắt chuyện (5-15 phút, chỉ khi chủ trong vườn) |
| `index.js` | File chính: kết nối, event, farming loop thật, dispatcher action, gift, reconnect |
| `pathing.js` | Pathfinder dùng chung: Movements, timeout, gỡ kẹt, wander gần |

## Cài đặt

```bash
npm install
cp .env.example .env
# điền đầy đủ .env: toạ độ vườn, Firebase, BRAIN_TOKEN...
npm start
```

## Action set mà Colab có thể trả về

`idle | wander | till | plant | harvest | sit | wave | look_owner | deliver_gift | rest | goto | follow_owner | come_here | stop | chop_wood | mine`

`rest`, `avoid_owner`, `avoid_monster` là 3 action mới so với bản trước, ánh xạ animation:
- `rest`: đứng yên/sneak lâu (~8s)
- `avoid_owner`: quay lưng lại hướng chủ
- `avoid_monster`: pathfind lùi xa quái vật gần nhất, vẫn giữ trong phạm vi vườn

## Lệnh di chuyển (chat trong game)

Bot **không chờ AI** — nhận lệnh là đi ngay. Không cần gọi tên nếu câu nói đúng lệnh:

| Chat | Việc bot làm |
|---|---|
| `đi theo tao` / `follow` | Đi theo người gọi (phải đứng trong tầm nhìn) |
| `ra đây` / `lại đây` / `tới đây` | Pathfind tới chỗ người gọi |
| `đi 100 64 -20` | Đi tới tọa độ x y z |
| `đi 100 -20` | Đi tới x z, giữ nguyên y hiện tại |
| `dừng` / `đứng yên` / `stop` | Hủy path, đứng im |

Nếu bot k thấy entity của bạn (đứng quá xa, chunk chưa load) nó sẽ chat `k thấy mày đâu, lại gần đi`.

Có thể set `MC_LOGIN_PASSWORD` trên Railway nếu server PikaMC yêu cầu `/login`.

## Pathfinding

`pathing.js` gom toàn bộ di chuyển:

- Không đào block, không đặt block; sprint + parkour khi đi xa; đi trong vườn thì chậm hơn, không parkour.
- Né lava / lửa / xương rồng / magma / cobweb.
- Timeout theo khoảng cách (tối thiểu 8s, tối đa 90s). Fail lần 1 thì thử `GoalNearXZ` (bỏ Y).
- Đứng im > 3.5s khi đang có goal → nhảy + lùi + tính lại path.
- Wander chỉ chọn điểm trong ~14 block, đã có mặt đất, chunk đã load.
- Lệnh mới không làm lệnh cũ chat "đi lỗi" (generation token).

## Lưu ý triển khai trên Railway

- Không commit `.env` — khai báo toàn bộ biến môi trường trong Railway dashboard.
- `FIREBASE_SERVICE_ACCOUNT_JSON` nên dán nguyên JSON service account trên 1 dòng (escape ký tự xuống
  dòng trong private key thành `\n`), hoặc dùng `FIREBASE_SERVICE_ACCOUNT_PATH` nếu mount file riêng.
- Bot tự reconnect với exponential backoff (tối đa 120s) khi mất kết nối server Minecraft, và không
  bao giờ crash tiến trình vì lỗi gọi Firebase/Colab/pathfinder (đều được try/catch + fallback).
