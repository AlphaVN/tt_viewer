# TikTok User API + Telegram Machine Bot

API Node.js nhẹ để lấy thống kê profile TikTok, tổng view của các video công
khai gần nhất và trạng thái truy cập của tài khoản.

Repository cũng có Telegram bot: gửi `M001` (hoặc máy thêm sau này) để cập nhật
các account có cùng mã ở cột J của Google Sheet rồi nhận kết quả. Xem toàn bộ
các bước bảo mật, cài BotFather, Apps Script, Render và webhook tại
**[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)**.

> Cảnh báo: sheet từng được chia sẻ public trong khi có cột mật khẩu/email. Hãy
> chuyển sheet về Restricted và đổi toàn bộ credential từng bị lộ trước khi
> triển khai bot.

API **không dùng Chromium/Playwright**. Thông tin profile được đọc trực tiếp từ
JSON nhúng trong trang TikTok; API JSON nhẹ được dùng làm fallback và để lấy
recent views. Các request ra provider được xếp hàng và retry để phù hợp với
server ít RAM.

## Khởi động

Yêu cầu Node.js 18 trở lên.

```bash
npm ci
cp -n .env.example .env
npm start
```

Mặc định server chạy tại `http://localhost:3000`.

## Endpoints

| Method | Path | Dữ liệu |
| --- | --- | --- |
| GET | `/api/user/:username/followers` | Followers |
| GET | `/api/user/:username/likes` | Tổng likes |
| GET | `/api/user/:username/videos` | Số video |
| GET | `/api/user/:username/profile` | Toàn bộ profile + sức khỏe tài khoản |
| GET | `/api/user/:username/profile?views=1` | Profile + recent views |
| GET | `/api/user/:username/views` | Recent views + phạm vi tính |
| GET | `/api/user/:username/health` | Sức khỏe/trạng thái truy cập tài khoản |
| GET | `/health` | Health check của server |

Ví dụ:

```bash
curl "http://localhost:3000/api/user/tiktok/profile?views=1"
```

Response rút gọn:

```json
{
  "success": true,
  "data": {
    "username": "tiktok",
    "followers": 94757116,
    "likes": 461573652,
    "videoCount": 1547,
    "totalViews": 272340735,
    "viewsVideoCount": 30,
    "viewsLimit": 30,
    "viewsScope": "recent_public_videos",
    "accountHealth": {
      "status": "ACTIVE",
      "label": "HOẠT ĐỘNG",
      "isAccessible": true,
      "isPublic": true,
      "canReadViews": true,
      "lastVideoAt": "2026-07-08T01:02:43.000Z"
    }
  }
}
```

### Ý nghĩa `totalViews`

TikTok không hiển thị một chỉ số tổng view toàn tài khoản trên profile.
`totalViews` của API này là tổng `play_count` của tối đa 30 video công khai gần
nhất. Response luôn kèm `viewsVideoCount`, `viewsLimit` và `viewsScope` để không
nhầm với số all-time. Giới hạn hiện được cố định là 30 video gần nhất (tối đa
35 cho mỗi lần gọi nguồn dữ liệu hiện tại).

Nếu tài khoản private, `totalViews` là `null` và trạng thái là
`ACTIVE_PRIVATE`; API không ghi số 0 giả. Nếu tài khoản công khai có video nhưng
nguồn không trả danh sách video, request trả lỗi thay vì báo tổng view bằng 0.

### Trạng thái sức khỏe tài khoản

| `status` | `label` | Ý nghĩa |
| --- | --- | --- |
| `ACTIVE` | `HOẠT ĐỘNG` | Profile công khai truy cập được |
| `ACTIVE_PRIVATE` | `HOẠT ĐỘNG (RIÊNG TƯ)` | Tài khoản tồn tại nhưng private |
| `ACTIVE_NO_VIDEOS` | `HOẠT ĐỘNG (CHƯA CÓ VIDEO)` | Tài khoản tồn tại, chưa có video công khai |
| `NOT_FOUND` | `KHÔNG TÌM THẤY` | Username không tồn tại hoặc profile đã bị vô hiệu hóa |

Đây là trạng thái quan sát được từ dữ liệu công khai, không phải thông tin vi
phạm nội bộ hay “account check” trong ứng dụng TikTok.

Với tài khoản không tồn tại, lỗi `404 USER_NOT_FOUND` vẫn kèm
`error.details.accountHealth` để client có thể nhận biết chính xác lỗi này.

## Google Sheet

File [excel/TikTokFetch.gs](excel/TikTokFetch.gs) ghi dữ liệu vào sheet
`Accounts`, với bố cục:

- C: followers
- D: likes
- E: số video
- F: recent views
- G: avatar
- I: trạng thái dùng để bỏ qua hàng (chỉ đọc)
- J: mã Máy (chỉ đọc)
- K: username (chỉ đọc)
- R: Chủ đề (không ghi)
- T:AW: chi tiết 30 video
- AX: trạng thái API và note lỗi

Đặt `API_BASE_URL`, chạy `verifyTelegramBridgeSetup()` rồi deploy Web App theo
[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md). Script sẽ:

- kiểm tra đúng header trước khi ghi và dừng nếu layout đã đổi;
- chỉ thay đổi C:G, T:AW và trạng thái/note ở AX;
- không ghi vào cột I, J, K, R hoặc các cột credential L:N;
- khôi phục nội dung C:G cũ khi gặp lỗi mạng/provider;
- chỉ ghi `0` vào C:F và `—` vào G khi API xác nhận `USER_NOT_FOUND`.

`setupTriggers()` chỉ cần nếu vẫn muốn chế độ cũ onOpen/onEdit; Telegram Web App
hoạt động không cần hai trigger này.

## Telegram bot

Luồng production:

```text
Telegram -> POST /telegram/webhook -> Apps Script doPost() -> sheet Accounts
```

Bot có các lớp bảo vệ sau:

- Telegram webhook secret header;
- public cho mọi Telegram user trong private chat bằng flag tường minh; có thể
  chuyển lại allowlist bằng một biến môi trường;
- chỉ nhận mã máy thuần dạng `M` + 3–6 chữ số; command và input sai trả lỗi
  chung trước khi gọi Apps Script/TikTok API;
- một job mỗi user, tối đa 20 job và xử lý tuần tự để hạn chế spam/quota;
- HMAC-SHA256 + timestamp + nonce giữa Node.js và Apps Script;
- ScriptLock chống ghi đồng thời;
- lọc theo từng dòng ở cột I; `BỊ BAN` và `Outr beta` không được cập nhật hoặc
  trả về;
- response chỉ allowlist username và thống kê, không chứa password/email;
- chia message dài và xử lý Telegram rate limit.

Các file Apps Script cần cài cùng project:

- [excel/TikTokFetch.gs](excel/TikTokFetch.gs)
- [excel/TelegramBridge.gs](excel/TelegramBridge.gs)

Sau khi cấu hình `.env`, đăng ký webhook bằng:

```bash
npm run telegram:set-webhook
```

Chi tiết đầy đủ: [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

## Cấu hình cố định trong mã nguồn

| Vị trí | Giá trị | Mô tả |
| --- | --- | --- |
| Runtime Render | `PORT` | Port do nền tảng cấp khi chạy |
| [src/app.js](src/app.js) | `TRUST_PROXY_HOPS = 1` | Một Render reverse proxy |
| [src/services/tiktok-scraper.js](src/services/tiktok-scraper.js) | TikTok, TikWM, 1.100 ms, 5.000 ms, 3 lần thử, 30 video | Cấu hình scraper production |

`axios` được đặt `proxy: false`; biến proxy từ môi trường không được dùng.

## Deploy Render

`render.yaml` chỉ chạy `npm ci --omit=dev`; không tải browser binary hoặc system
dependencies. Health check là `/health`.

## Kiểm thử

```bash
npm test
```

Test dùng trang TikTok và HTTP provider giả lập cục bộ nên không phụ thuộc mạng ngoài.
