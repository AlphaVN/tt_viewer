# Hướng dẫn cài Telegram Bot cập nhật tài khoản theo Máy

Tài liệu này áp dụng cho Google Sheet `QUẢN LÝ TK TT GIANG`, tab `Accounts`,
và mã nguồn trong repository này.

Khi bất kỳ người dùng nào gửi riêng một mã máy hợp lệ như `M001` hoặc `m001`
trong private chat, bot sẽ:

1. tìm động các dòng có cột J (`Máy`) bằng `M001`;
2. bỏ qua từng dòng có cột I (`Tình trạng`) là `BỊ BAN` hoặc `Outr beta`;
3. gọi API TikTok và cập nhật các dòng còn lại;
4. trả về username, thống kê và trạng thái của các account hợp lệ;
5. không đọc hoặc gửi mật khẩu/email qua Telegram.

Danh sách máy không bị hard-code ở M001–M013. Mã mới như M014 hoặc M1000 sẽ
hoạt động ngay khi được thêm vào cột J; định dạng hợp lệ là `M` và 3–6 chữ số.

## 1. Cảnh báo bắt buộc xử lý trước

### Sheet public đang làm lộ thông tin đăng nhập

Link hiện tại cho phép người không đăng nhập export cả các cột K–N, trong đó có
username, mật khẩu, email và mật khẩu email. Trước khi triển khai bot:

1. vào **Share** của Google Sheet;
2. đổi **General access** từ “Anyone with the link” thành **Restricted**;
3. thu hồi/đổi toàn bộ mật khẩu và thông tin đăng nhập từng xuất hiện trong
   bản public; chỉ đổi quyền chia sẻ không làm các credential cũ an toàn lại;
4. kiểm tra danh sách người đang được chia sẻ và gỡ người không cần thiết;
5. vào **File > Version history > Name current version**, đặt tên mốc trước cài
   bot, rồi tạo thêm một bản sao/backup độc lập trước khi chạy script.

Bot không cần sheet ở chế độ public. Apps Script Web App chạy bằng tài
khoản deploy khi chọn **Execute as Me**; tài khoản này phải còn quyền truy cập
sheet. Server gọi Web App qua request được ký HMAC.

### Bot Telegram đang ở chế độ public

`TELEGRAM_ALLOW_ALL_USERS=true` cho phép mọi Telegram user dùng bot trong
private chat. Họ có thể đoán mã máy và xem username/thống kê được bot trả về,
đồng thời tiêu tốn quota Apps Script/TikTok. Bot vẫn không đọc/trả L:N, vẫn lọc
`BỊ BAN`/`Outr beta`, giới hạn một job mỗi user, tối đa 20 job và xử lý tuần tự.
Chỉ bật chế độ này khi bạn chấp nhận phạm vi truy cập trên.

### Không dùng cột R làm trạng thái API

Header thật của cột R là `Chủ đề`. Script cũ trong repository từng coi R là
status, nên có nguy cơ ghi đè dữ liệu chủ đề. Bản mới:

- giữ nguyên cột R;
- dùng cột AX (`Trạng thái API`);
- nếu sheet mới chỉ có 49 cột đến AW, append AX ở cuối rồi tạo header;
- nếu AX1 đã là `Trạng thái API`, tái sử dụng cột và giữ dữ liệu cũ;
- nếu AX1 trống, chỉ nhận cột khi value, formula và note bên dưới đều
  trống;
- dừng ngay nếu AX đang có header khác hoặc các header quan trọng bị đổi.

Hãy mở **File > Version history > See version history** và kiểm tra cột R. Nếu
dữ liệu chủ đề đã bị thay bằng các giá trị như `HOẠT ĐỘNG`, khôi phục từ phiên
bản đúng hoặc từ backup trước khi tiếp tục.

## 2. Luồng hệ thống

```text
Telegram
  │ HTTPS webhook + secret header
  ▼
Node.js/Express trên Render
  │ public user, chỉ private chat, chống update trùng/spam hàng đợi
  │ HMAC-SHA256 + timestamp + nonce
  ▼
Google Apps Script Web App /exec
  │ ScriptLock, lọc I/J/K, gọi API TikTok
  ▼
Google Sheet Accounts
  └─ ghi C:G, T:AW và AX; không ghi R hoặc L:N
```

Không thể gọi một installable trigger của Google Sheet trực tiếp từ Internet.
`doPost(e)` trong `excel/TelegramBridge.gs` là HTTP trigger đúng cho tác vụ này;
nó gọi lại trực tiếp logic `fetchSingleRow()` đang có.

## 3. Các cột được sử dụng

| Cột | Header hiện tại | Cách bot sử dụng |
| --- | --- | --- |
| C:G | Folow, Tym, Video, Views, Ảnh | Ghi thống kê TikTok |
| H | Quốc gia | Chỉ đọc để trả kết quả |
| I | Tình trạng | Chỉ đọc; lọc `BỊ BAN`, `Outr beta` |
| J | Máy | Chỉ đọc; so khớp mã máy |
| K | Usename | Chỉ đọc; account cần cập nhật |
| L:N | Pass, Hotmail, Pass hotmail | Không đọc, không trả, không log |
| R | Chủ đề | Không ghi |
| T:AW | Video 1–30 | Ghi chi tiết video từ logic có sẵn |
| AX | Trạng thái API | Ghi trạng thái API; tự tạo header nếu trống |

Việc loại trừ được thực hiện theo từng dòng, không phải loại cả máy. Ví dụ một
máy có thể chứa đồng thời account hợp lệ và account `BỊ BAN`; chỉ account hợp lệ
được cập nhật/trả về.

## 4. Chuẩn bị

Bạn cần:

- quyền Owner hoặc Editor của Google Sheet và Apps Script; tài khoản
  deploy Web App phải giữ quyền này;
- một Telegram account;
- Node.js 18 trở lên;
- một URL HTTPS chạy repository này, ví dụ Render;
- API TikTok trong repository đang hoạt động qua `API_BASE_URL`.

Các file chính:

- `excel/TikTokFetch.gs`: cập nhật TikTok và bảo vệ layout sheet;
- `excel/TelegramBridge.gs`: Web App, HMAC, lọc/cập nhật theo máy;
- `src/routes/telegram.routes.js`: nhận webhook Telegram;
- `src/services/telegram-bot.js`: quyền truy cập và điều phối;
- `scripts/get-telegram-ids.js`: đọc user/chat ID mà không in nội dung message;
- `scripts/set-telegram-webhook.js`: đăng ký webhook;
- `scripts/delete-telegram-webhook.js`: dừng webhook;
- `.env.example`: danh sách biến môi trường.

## 5. Tạo Telegram bot

1. Mở cuộc trò chuyện với tài khoản chính thức **@BotFather**.
2. Gửi `/newbot`.
3. Nhập tên hiển thị và username kết thúc bằng `bot`.
4. Lưu token BotFather trả về. Token này tương đương mật khẩu; không đưa vào
   source code, ảnh chụp màn hình hoặc commit Git.
5. Khuyến nghị vào `/mybots` > chọn bot > **Bot Settings** > **Allow Groups?**
   và tắt group. Code cũng mặc định chỉ cho phép private chat.
6. Không khai báo command để bot không hiển thị hướng dẫn sử dụng. Nếu trước đó
   đã khai báo, gửi `/deletecommands` cho BotFather, chọn bot và xác nhận xóa
   command. Code cố ý từ chối `/start`, `/help`, `/machine ...` và chỉ trả lỗi
   chung, không tiết lộ định dạng hợp lệ.

Telegram hướng dẫn tạo token bằng `/newbot` và yêu cầu coi token như mật khẩu
tại [Telegram Bot Tutorial](https://core.telegram.org/bots/tutorial).

## 6. Lấy Telegram user_id (chỉ khi dùng allowlist)

Với `TELEGRAM_ALLOW_ALL_USERS=true`, bỏ qua mục này. Nếu sau này chuyển flag về
`false`, thực hiện các bước dưới đây để lập allowlist.

Thực hiện bước này trước khi đăng ký webhook:

1. mở bot vừa tạo và gửi một tin nhắn bất kỳ;
2. tạo `.env` local nếu chưa có và điền duy nhất `TELEGRAM_BOT_TOKEN` trước:

```bash
cp -n .env.example .env
# Mở .env bằng editor và điền TELEGRAM_BOT_TOKEN; .env đã được gitignore.
npm run telegram:get-ids
```

3. script chỉ in `user_id`, `chat_id`, `chat_type`, không in nội dung tin nhắn;
4. dùng `user_id` làm `TELEGRAM_ALLOWED_USER_IDS`;
5. trong private chat, `chat_id` thường trùng user ID. Chỉ cần đặt
   `TELEGRAM_ALLOWED_CHAT_IDS` nếu muốn khóa thêm theo chat cụ thể.

Không dùng Telegram username (`@ten`) làm quyền truy cập vì username có thể đổi.
Code kiểm tra ID số từ payload Telegram.

Nên dùng bot mới và bảo đảm chỉ bạn gửi tin nhắn trước lần chạy helper.
Nếu helper in nhiều ID không xác định được, không copy đoán một ID vào
allowlist; hãy xóa pending update hoặc tạo bot/token mới rồi gửi lại.

Sau khi webhook đã được đăng ký, Telegram không cho dùng `getUpdates` đồng thời.
Nếu cần lấy lại ID, tạm chạy `npm run telegram:delete-webhook`, gửi một tin nhắn,
rồi chạy lại `npm run telegram:get-ids`.

## 7. Tạo hai secret khác nhau

Chạy lệnh sau hai lần và lưu hai kết quả riêng:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

- Kết quả 1: `TELEGRAM_WEBHOOK_SECRET` — Telegram gửi trong header webhook.
- Kết quả 2: `TELEGRAM_APPS_SCRIPT_SECRET` — server dùng ký HMAC sang Apps
  Script.

Không dùng chung hai secret và không đặt chúng trong URL/query string.

## 8. Cài Apps Script vào Google Sheet

### 8.1 Thêm mã nguồn

1. Mở Google Sheet.
2. Chọn **Extensions > Apps Script**.
3. Backup code cũ trong Apps Script project.
4. Thay nội dung file cập nhật TikTok bằng nội dung của
   `excel/TikTokFetch.gs`.
5. Tạo file script mới tên `TelegramBridge`, rồi dán toàn bộ nội dung
   `excel/TelegramBridge.gs`.
6. Không giữ một bản cũ khác có cùng tên hàm như `doPost`, `fetchSingleRow`,
   `getSheet`; hàm trùng tên có thể làm Apps Script chạy nhầm bản.
7. Trong `TikTokFetch.gs`, kiểm tra:

```javascript
var API_BASE_URL = "https://URL-API-TIKTOK-CỦA-BẠN";
var SPREADSHEET_ID = "1JRJ-AsM7qlTfViqYw5j4ZjzlQZRfLrK35HMBGy9DVFw";
var SHEET_NAME = "Accounts";
```

Nếu thử nghiệm trên một bản copy, thay `SPREADSHEET_ID` bằng ID của bản copy.
Không thử lần đầu trên file production nếu chưa có backup.

### 8.2 Thêm Script Property

1. Trong Apps Script, mở **Project Settings**.
2. Tại **Script Properties**, chọn **Add script property**.
3. Property: `TELEGRAM_APPS_SCRIPT_SECRET`.
4. Value: secret thứ hai đã tạo ở bước 7.
5. Chọn **Save script properties**.

Không đặt secret trong file `.gs`. Google hỗ trợ quản lý Script Properties từ
Project Settings như mô tả trong [Properties Service](https://developers.google.com/apps-script/guides/properties#manage_script_properties_manually).

### 8.3 Xác minh layout và cấp quyền

1. Chọn hàm `verifyTelegramBridgeSetup` trong dropdown trên Apps Script editor.
2. Nhấn **Run**.
3. Chấp nhận quyền mà Google yêu cầu bằng đúng tài khoản sở hữu sheet.
4. Mở **Execution log** và kiểm tra dòng bắt đầu bằng `OK:`.
5. Quay lại sheet và xác nhận cột AX đã được append nếu cần, AX1 có header
   `Trạng thái API`, R1 vẫn là `Chủ đề`.

Hàm này không gọi API TikTok và không cập nhật account; nó chỉ đọc/kiểm tra
layout và tạo header AX nếu đang trống.

### 8.4 Trigger onOpen/onEdit là tùy chọn

Bot không cần chạy `setupTriggers()`. Web App `doPost()` tự gọi logic cập nhật.

Chỉ chạy `setupTriggers()` nếu bạn vẫn muốn giữ hành vi cũ:

- mở sheet thì cập nhật toàn bộ;
- sửa username ở cột K thì cập nhật riêng dòng đó.

Lưu ý cập nhật toàn bộ khi mở sheet tốn nhiều thời gian/quota và có thể làm bot
tạm báo `BUSY`. Bản mới chỉ xóa/tạo lại hai trigger do nó quản lý, không xóa
trigger khác trong project.

## 9. Deploy Apps Script Web App

1. Trong Apps Script, chọn **Deploy > New deployment**.
2. Tại **Select type**, chọn **Web app**.
3. Description: ví dụ `Telegram machine bridge v1`.
4. **Execute as**: chọn **Me**.
5. **Who has access**: chọn **Anyone**.
6. Chọn **Deploy**, xác nhận quyền nếu Google hỏi.
7. Sao chép URL kết thúc bằng `/exec`; không dùng URL `/dev`.

Google mô tả các bước deploy tại
[Apps Script Web Apps](https://developers.google.com/apps-script/guides/web#deploy_a_script_as_a_web_app).
Web App phải nhận được request từ server Render không đăng nhập Google; HMAC,
timestamp và nonce trong code là lớp xác thực cho endpoint `Anyone`.

Kiểm tra health endpoint:

```bash
export TASK_APPS_SCRIPT_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
curl --silent --show-error --location "$TASK_APPS_SCRIPT_URL"
unset TASK_APPS_SCRIPT_URL
```

Kết quả mong đợi:

```json
{"success":true,"service":"telegram-sheet-bridge","version":1}
```

Mỗi khi sửa file `.gs`, vào **Deploy > Manage deployments > Edit**, chọn **New
version** rồi deploy lại. Thông thường URL `/exec` vẫn giữ nguyên nếu cập nhật
cùng deployment.

## 10. Cấu hình Node.js

Tại máy local:

```bash
npm ci
cp -n .env.example .env
```

Điền `.env`:

```dotenv
PORT=3000
NODE_ENV=development

TELEGRAM_BOT_TOKEN=token_từ_BotFather
TELEGRAM_WEBHOOK_SECRET=secret_thứ_nhất
TELEGRAM_ALLOW_ALL_USERS=true
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_PRIVATE_ONLY=true
TELEGRAM_TIME_ZONE=Asia/Ho_Chi_Minh

APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
TELEGRAM_APPS_SCRIPT_SECRET=secret_thứ_hai
APPS_SCRIPT_TIMEOUT_MS=330000

PUBLIC_BASE_URL=https://ten-service-cua-ban.onrender.com
TELEGRAM_DROP_PENDING_UPDATES=false
```

Khi muốn quay lại allowlist, đặt `TELEGRAM_ALLOW_ALL_USERS=false` và ngăn
cách các ID được phép bằng dấu phẩy:

```dotenv
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
```

Quy tắc quyền:

- `TELEGRAM_ALLOW_ALL_USERS=true` bỏ qua cả hai allowlist;
- public mode bắt buộc `TELEGRAM_PRIVATE_ONLY=true`; cấu hình public + group
  sẽ làm module tự vô hiệu hóa;
- khi flag là `false`, `TELEGRAM_ALLOWED_USER_IDS` là bắt buộc; nếu
  `TELEGRAM_ALLOWED_CHAT_IDS` có giá trị thì cả hai ID phải khớp;
- không commit `.env`; repository đã ignore file này.

Chạy kiểm thử:

```bash
npm test
```

Chạy server local:

```bash
npm start
```

Khi chưa có đủ biến môi trường, API TikTok vẫn chạy nhưng
`POST /telegram/webhook` trả `503 TELEGRAM_NOT_CONFIGURED`.

## 11. Deploy Node.js lên Render

Repository đã có `render.yaml`. Với Render Blueprint hoặc service hiện có:

1. deploy commit mới;
2. dùng build command `npm ci --omit=dev`;
3. dùng start command `npm start`;
4. health check: `/health`;
5. đặt các biến sau trong **Environment** của Render:

| Biến | Bắt buộc | Giá trị |
| --- | --- | --- |
| TELEGRAM_BOT_TOKEN | Có | Token BotFather |
| TELEGRAM_WEBHOOK_SECRET | Có | Secret thứ nhất |
| TELEGRAM_ALLOW_ALL_USERS | Có | `true` để mọi user private chat được dùng |
| TELEGRAM_ALLOWED_USER_IDS | Không khi public | Fallback khi flag là `false` |
| TELEGRAM_ALLOWED_CHAT_IDS | Không khi public | Fallback khi flag là `false` |
| TELEGRAM_PRIVATE_ONLY | Có | `true` |
| TELEGRAM_TIME_ZONE | Có | `Asia/Ho_Chi_Minh` |
| APPS_SCRIPT_WEB_APP_URL | Có | URL `/exec` |
| TELEGRAM_APPS_SCRIPT_SECRET | Có | Secret thứ hai, giống Script Property |
| APPS_SCRIPT_TIMEOUT_MS | Có | `330000` |

Không cần đặt `PUBLIC_BASE_URL` hoặc `TELEGRAM_DROP_PENDING_UPDATES` trên
Render; hai biến này chỉ được script local dùng để đăng ký webhook.

Sau deploy, mở:

```text
https://ten-service-cua-ban.onrender.com/health
```

Phải nhận JSON có `status: "ok"`, `telegram.configured: true`,
`telegram.accessMode: "public"` và `telegram.privateOnly: true` trước khi đăng
ký webhook. Nếu khác, kiểm tra biến môi trường và Render log.

## 12. Đăng ký webhook Telegram

Đảm bảo `.env` local đã có `PUBLIC_BASE_URL` và toàn bộ cấu hình ở bước 10, rồi
chạy:

```bash
npm run telegram:set-webhook
```

Lần đăng ký đầu tiên, sau khi đã lấy đúng ID và không cần giữ các
message cũ (tin nhắn lấy ID hoặc lệnh test), nên xóa backlog có chủ ý:

```bash
TELEGRAM_DROP_PENDING_UPDATES=true npm run telegram:set-webhook
```

Mặc định là `false` để không làm mất lệnh hợp lệ khi đăng ký lại.
Không bật tùy chọn này nếu pending update còn công việc cần xử lý.

Script sẽ:

- đăng ký `https://<PUBLIC_BASE_URL>/telegram/webhook`;
- gửi `TELEGRAM_WEBHOOK_SECRET` qua tham số `secret_token`;
- chỉ đăng ký loại update `message`;
- giữ pending update theo mặc định, hoặc xóa khi bạn chủ động đặt
  `TELEGRAM_DROP_PENDING_UPDATES=true`;
- gọi `getWebhookInfo` và in URL, số update đang chờ, lỗi gần nhất;
- không in bot token hay secret.

Telegram gửi secret này trong header
`X-Telegram-Bot-Api-Secret-Token`; server so sánh an toàn trước khi nhận update.
Chi tiết chính thức tại [setWebhook](https://core.telegram.org/bots/api#setwebhook).

Sau khi đổi `TELEGRAM_WEBHOOK_SECRET`, phải chạy lại lệnh set webhook. Sau khi
đổi bot token, cũng phải chạy lại bằng token mới.

## 13. Kiểm thử end-to-end

Nên thử trước trên bản copy của sheet.

### Test cơ bản

1. Mở private chat với bot.
2. Gửi `/help`, `/start` và `/machine M001`; mỗi tin chỉ được trả
   `❌ Yêu cầu không hợp lệ.` và không được gọi Apps Script/TikTok API.
3. Gửi `M001 extra`; bot phải trả cùng lỗi chung và không gọi API.
4. Gửi `m001`; bot phải chuẩn hóa thành M001.
5. Bot trả ngay tin `Đang cập nhật...`.
6. Sau khi Apps Script chạy xong, bot trả thống kê account.
7. Kiểm tra C:G, T:AW và AX của các dòng M001 trong sheet.
8. Kiểm tra cột R không thay đổi.

### Test máy có cả account hợp lệ và bị loại

Gửi `M004`. Ở snapshot ngày 22/07/2026, máy này có 13 dòng: 5 hợp lệ và 8 dòng
`BỊ BAN`; dữ liệu thực tế có thể thay đổi. Kết quả đúng là:

- chỉ account hợp lệ được gọi API và xuất hiện trong Telegram;
- account `BỊ BAN` không lộ username trong kết quả;
- C:G, T:AW và AX của các dòng bị loại giữ nguyên;
- bot chỉ báo tổng số dòng bị loại.

Tạo một dòng test `Outr beta` trong bản copy để xác nhận hành vi tương tự, vì
snapshot hiện tại chưa có trạng thái này.

### Test quyền và lỗi input

- một tài khoản Telegram bất kỳ trong private chat phải dùng được bot;
- group vẫn phải bị từ chối khi `TELEGRAM_PRIVATE_ONLY=true`;
- mỗi user chỉ được có một job đang chạy/chờ; job thứ hai phải được yêu cầu đợi;
- `/help`, `/start`, `/machine M001`, `M1`, `M001 extra`, `BỊ BAN` chỉ được trả
  lỗi chung và tuyệt đối không gọi Apps Script/TikTok API;
- một mã hợp lệ nhưng chưa tồn tại, ví dụ M999999, phải báo không tìm thấy;
- gửi hai lần cùng update không được tạo hai lần cập nhật đồng thời.

## 14. Dữ liệu Telegram trả về

Mỗi account có thể gồm:

- username;
- followers;
- tym/likes;
- số video;
- tổng views của tối đa 30 video công khai gần nhất;
- quốc gia nếu có;
- tình trạng kinh doanh từ cột I;
- trạng thái API từ AX;
- cảnh báo dữ liệu cũ nếu lần cập nhật account đó lỗi.

Bot không trả link chứa credential, password, email, password email hoặc note.
Tin nhắn dài được chia theo block account, không cắt đôi account; từng message
được giữ dưới ngưỡng an toàn và bật `protect_content`.

## 15. Thêm máy hoặc thay đổi trạng thái lọc

### Thêm máy

Chỉ cần nhập mã mới vào cột J, ví dụ `M014`. Không sửa Node.js hoặc Apps Script.
Khoảng trắng đầu/cuối và chữ thường được chuẩn hóa khi so khớp.

### Thay danh sách trạng thái bị loại

Apps Script dùng danh sách chính trong `excel/TikTokFetch.gs`:

```javascript
var SKIP_STATUSES = ["BỊ BAN", "Outr beta"];
```

Node còn có lớp lọc phòng thủ trong hàm `isExcludedBusinessStatus()` tại
`src/services/apps-script-client.js`. Khi đổi danh sách, phải sửa cả hai nơi,
chạy test, deploy version Apps Script mới và redeploy Node. Nếu chỉ sửa một nơi,
việc cập nhật và kết quả Telegram có thể lệch nhau.

## 16. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách kiểm tra/xử lý |
| --- | --- | --- |
| Bot không phản hồi | Webhook chưa đăng ký hoặc Render chưa chạy | Mở `/health`, chạy lại `npm run telegram:set-webhook`, xem `Last error` |
| Webhook trả 503 | Thiếu/sai env làm Telegram module không khởi tạo | Kiểm tra toàn bộ biến Render rồi redeploy/restart |
| Webhook trả 401 | `TELEGRAM_WEBHOOK_SECRET` trên Render khác secret đã set | Đồng bộ giá trị rồi set webhook lại |
| User private gửi nhưng bot im lặng | Render chưa có `TELEGRAM_ALLOW_ALL_USERS=true`, chưa redeploy hoặc đang ở allowlist mode | Kiểm tra `/health` có `accessMode: public`; cập nhật env Render rồi redeploy |
| Bot báo cấu hình Apps Script | Thiếu Script Property, sai header/tab hoặc AX đã được dùng | Chạy `verifyTelegramBridgeSetup`, xem Executions trong Apps Script |
| Apps Script trả HTML/không hợp lệ | Dùng URL `/dev`, deployment không cho Anyone, hoặc URL sai | Copy đúng deployed URL `/exec` và cập nhật Render |
| Bot báo BUSY | onOpen/onEdit, instance server khác hoặc request ngoài queue Node đang giữ ScriptLock | Chờ tiến trình kia xong rồi gửi lại |
| Bot báo timeout | Quá nhiều account/API chậm/Apps Script gần giới hạn runtime | Kiểm tra sheet trước khi retry; chia account sang máy nhỏ hơn |
| Một account có cảnh báo dữ liệu cũ | API/provider lỗi cho riêng account đó | Script giữ dữ liệu cũ và tiếp tục account khác; xem note AX |
| Mã máy không tìm thấy | Cột J không có exact machine sau chuẩn hóa | Kiểm tra tab `Accounts`, cột J và định dạng `M` + 3–6 số |
| Dòng BỊ BAN vẫn thay đổi | Status không nằm ở cột I hoặc chữ bị gõ khác | Kiểm tra header/layout và giá trị thực; script chuẩn hóa hoa/thường/khoảng trắng |
| Chủ đề ở R bị mất | Đã từng chạy script cũ ghi status vào R | Dừng deployment cũ và khôi phục Version history/backup |

Trong Apps Script, mở **Executions** để xem lần chạy `doPost` và lỗi. Không thêm
log toàn bộ request/body vì chúng không cần thiết cho vận hành.

## 17. Giới hạn và vận hành

- Apps Script hiện có giới hạn runtime theo execution; cập nhật từng account là
  tuần tự. Nếu số account/máy tăng nhiều, có thể cần queue/chia batch.
- Webhook trả HTTP 200 cho Telegram trước rồi xử lý nền để Telegram không retry
  chỉ vì TikTok chậm. Nếu Render restart đúng lúc đang chạy, có thể không có tin
  cuối; hãy kiểm tra sheet trước khi gửi lại.
- Một Node process xếp tuần tự các máy khác nhau; cùng máy đang chạy không được
  enqueue lần hai. `ScriptLock` tiếp tục bảo vệ giữa Node, onOpen và onEdit.
- Cache chống replay giữ kết quả ngắn hạn 10 phút. Ngoài ra Apps Script lưu
  result đã allowlist (machine, count, username, thống kê, outcome) trong Script
  Properties tối đa 24 giờ khi receipt không vượt 8.000 byte. Nhờ vậy cùng
  `request_id` sẽ trả đúng kết quả lần đầu thay vì đọc snapshot sheet mới;
  receipt không chứa password/email. Kết quả lớn hơn giới hạn này chỉ
  được cache 10 phút và có thể refresh lại sau khi cache hết hạn.
- Webhook vẫn ACK trước khi job được lưu vào một queue bền. Nếu Render crash đúng
  khoảng sau ACK nhưng trước lúc gọi Apps Script, update có thể mất; đây là giới
  hạn của bản hiện tại. Mọi phép ghi là giá trị tuyệt đối nên retry thủ công
  không cộng dồn số liệu.
- Google công bố giới hạn Apps Script có thể thay đổi; xem
  [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

Nếu một máy thường xuyên có quá nhiều account và chạm timeout, bước nâng cấp phù
hợp là queue bền + xử lý batch nhiều execution, không tăng timeout vô hạn.

## 18. Xoay secret, dừng bot và rollback

### Khi bot token bị lộ

1. dùng BotFather để revoke token;
2. cập nhật `TELEGRAM_BOT_TOKEN` trên Render và `.env` local;
3. redeploy/restart Render;
4. chạy lại `npm run telegram:set-webhook`.

### Khi Apps Script secret bị lộ

1. tạo secret mới;
2. cập nhật Script Property `TELEGRAM_APPS_SCRIPT_SECRET`;
3. cập nhật env cùng tên trên Render;
4. restart Render. Không cần đổi URL Web App.

### Dừng webhook

Đảm bảo `.env` local có token hiện tại rồi chạy:

```bash
npm run telegram:delete-webhook
```

Lệnh mặc định giữ các update đang chờ. Trong sự cố bảo mật và muốn bỏ chúng,
chạy `TELEGRAM_DROP_PENDING_UPDATES=true npm run telegram:delete-webhook`.

### Rollback Apps Script

1. vào **Deploy > Manage deployments** và chuyển về version tốt trước đó hoặc
   tạo deployment từ code đã backup;
2. nếu dữ liệu sheet bị ghi sai, dùng Version history để khôi phục;
3. không rollback về bản dùng R làm status;
4. chạy lại `verifyTelegramBridgeSetup` trước khi bật bot.

## 19. Checklist hoàn tất

- [ ] Sheet đã Restricted và credential từng public đã được đổi/revoke.
- [ ] Có backup và đã kiểm tra cột R.
- [ ] BotFather token chỉ nằm trong secret/env.
- [ ] Render có `TELEGRAM_ALLOW_ALL_USERS=true`, `TELEGRAM_PRIVATE_ONLY=true`.
- [ ] Hai secret khác nhau, mỗi secret đủ dài.
- [ ] `verifyTelegramBridgeSetup` chạy thành công; AX1 đúng, R1 không đổi.
- [ ] Apps Script deploy “Execute as me”, URL production kết thúc `/exec`.
- [ ] Render `/health` trả `telegram.configured: true`, `accessMode: public`,
      `privateOnly: true`.
- [ ] `npm test` pass.
- [ ] `npm run telegram:set-webhook` không báo Last error.
- [ ] Test M001 pass.
- [ ] Test máy hỗn hợp như M004 không cập nhật/trả account bị loại.
- [ ] Test một user bất kỳ dùng được private chat và group vẫn bị chặn.
