# TikTok User API

REST API để tra cứu thông tin TikTok user — **không cần API key**, scrape trực tiếp từ trang profile TikTok.

## 🚀 Khởi động

```bash
# Cài dependencies
npm install

# Tạo file .env
cp .env.example .env

# Chạy development (auto-reload)
npm run dev

# Hoặc production
npm start
```

## 📡 Các API Endpoints

Base URL: `http://localhost:3000`

### 1. Lấy số Followers

```
GET /api/user/:username/followers
```

**Ví dụ:**

```bash
curl http://localhost:3000/api/user/cristiano/followers
```

**Response:**

```json
{
  "success": true,
  "data": {
    "username": "cristiano",
    "followers": 82300000
  },
  "meta": {
    "timestamp": "2024-07-09T03:00:00.000Z",
    "fromCache": false
  }
}
```

---

### 2. Lấy tổng số Likes

```
GET /api/user/:username/likes
```

**Ví dụ:**

```bash
curl http://localhost:3000/api/user/cristiano/likes
```

**Response:**

```json
{
  "success": true,
  "data": {
    "username": "cristiano",
    "likes": 420000000
  },
  "meta": {
    "timestamp": "2024-07-09T03:00:00.000Z",
    "fromCache": true,
    "cachedAt": "2024-07-09T02:59:00.000Z"
  }
}
```

---

### 3. Lấy số lượng Video

```
GET /api/user/:username/videos
```

**Ví dụ:**

```bash
curl http://localhost:3000/api/user/cristiano/videos
```

**Response:**

```json
{
  "success": true,
  "data": {
    "username": "cristiano",
    "videoCount": 312
  },
  "meta": {
    "timestamp": "2024-07-09T03:00:00.000Z",
    "fromCache": true
  }
}
```

---

### 4. Lấy toàn bộ thông tin Profile

```
GET /api/user/:username/profile
```

**Ví dụ:**

```bash
curl http://localhost:3000/api/user/cristiano/profile
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "6820082583",
    "username": "cristiano",
    "nickname": "Cristiano Ronaldo",
    "bio": "⚽️",
    "verified": true,
    "privateAccount": false,
    "avatarUrl": "https://p16-sign-va.tiktokcdn.com/...",
    "followers": 82300000,
    "following": 5,
    "likes": 420000000,
    "videoCount": 312,
    "friendCount": 0
  },
  "meta": {
    "timestamp": "2024-07-09T03:00:00.000Z",
    "fromCache": false
  }
}
```

---

### 5. Health Check

```
GET /health
```

```json
{
  "status": "ok",
  "uptime": 142.5,
  "cache": {
    "totalKeys": 3,
    "activeKeys": 3
  },
  "timestamp": "2024-07-09T03:00:00.000Z"
}
```

---

## ⚙️ Cấu hình

| Biến       | Mặc định      | Mô tả          |
| ---------- | ------------- | -------------- |
| `PORT`     | `3000`        | Port lắng nghe |
| `NODE_ENV` | `development` | Môi trường     |

## 🛡️ Rate Limiting

- **30 requests / phút / IP** để tránh bị block bởi TikTok
- Dữ liệu được **cache 5 phút** — gọi lại cùng username sẽ không tốn request mới đến TikTok

## ⚠️ Lưu ý

- API scrape trực tiếp từ TikTok, **không cần API key**
- TikTok có thể thay đổi cấu trúc trang → cần cập nhật parser
- Nếu chạy nhiều request, nên dùng **proxy** để tránh bị block (thêm `PROXY_URL` vào `.env`)
- Kết quả `fromCache: true` nghĩa là lấy từ cache, nhanh hơn và không tốn request

## 📁 Cấu trúc

```
tiktok-user-api/
├── src/
│   ├── index.js                    # Entry point
│   ├── app.js                      # Express setup
│   ├── controllers/
│   │   └── user.controller.js      # Business logic
│   ├── routes/
│   │   └── user.routes.js          # Route definitions
│   └── services/
│       ├── tiktok-scraper.js       # TikTok HTML scraper
│       └── cache.js                # In-memory cache
├── .env.example
├── package.json
└── README.md
```
