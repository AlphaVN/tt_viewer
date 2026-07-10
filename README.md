# TikTok User API

API Node.js nhẹ để lấy thống kê profile TikTok, tổng view của các video công
khai gần nhất và trạng thái truy cập của tài khoản.

API **không dùng Chromium/Playwright**. Dữ liệu được lấy qua HTTP JSON, các
request ra nguồn dữ liệu được xếp hàng và retry để phù hợp với server ít RAM.

## Khởi động

Yêu cầu Node.js 18 trở lên.

```bash
npm ci
cp .env.example .env
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
nhầm với số all-time. Có thể đổi giới hạn bằng `TIKTOK_VIEWS_LIMIT` (tối đa 35
cho mỗi lần gọi nguồn dữ liệu hiện tại).

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
`error.details.accountHealth`, nhờ đó Google Sheet có thể cập nhật cột tình
trạng chính xác.

## Google Sheet

File [excel/TikTokFetch.gs](excel/TikTokFetch.gs) dùng bố cục:

- C: followers
- D: likes
- E: số video
- F: recent views
- G: avatar
- I: tình trạng/sức khỏe tài khoản
- K: username

Đặt `API_BASE_URL` trong file rồi chạy `setupTriggers()` một lần. Script sẽ:

- ghi `accountHealth.label` vào cột I;
- kiểm tra lại tài khoản từng được đánh dấu không tồn tại;
- giữ nguyên dữ liệu cũ khi chỉ gặp lỗi mạng/provider;
- chỉ ghi số 0 khi API xác nhận `USER_NOT_FOUND`.

## Cấu hình

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `PORT` | `3000` | Port lắng nghe |
| `TIKTOK_HTTP_API_URL` | `https://www.tikwm.com` | HTTP JSON provider |
| `TIKTOK_REQUEST_INTERVAL_MS` | `1100` | Khoảng cách tối thiểu giữa hai request provider |
| `TIKTOK_HTTP_RETRIES` | `3` | Số lần thử lại, từ 1 đến 5 |
| `TIKTOK_VIEWS_LIMIT` | `30` | Số video gần nhất dùng để cộng view, tối đa 35 |
| `HTTPS_PROXY` | trống | Proxy HTTP(S) tùy chọn |

Không giảm `TIKTOK_REQUEST_INTERVAL_MS` nếu dùng endpoint miễn phí; provider có
thể trả lỗi giới hạn tần suất.

## Deploy Render

`render.yaml` chỉ chạy `npm ci --omit=dev`; không tải browser binary hoặc system
dependencies. Health check là `/health`.

## Kiểm thử

```bash
npm test
```

Test dùng HTTP provider giả lập cục bộ nên không phụ thuộc TikTok hay mạng ngoài.
