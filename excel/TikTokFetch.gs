/**
 * TikTok User Stats — Google Apps Script (Google Sheets)
 *
 * Triggers:
 *   1. Mỗi 10 phút   → fetchTikTokStats() toàn bộ
 *   2. Khi mở file   → fetchTikTokStats() toàn bộ
 *   3. Cột K thay đổi → chỉ fetch đúng hàng đó
 *
 * Chạy setupTriggers() 1 lần duy nhất để kích hoạt cả 3 trigger.
 *
 * Layout (1-indexed):
 *   C(3)=Followers  D(4)=Likes  E(5)=Videos  F(6)=Views  G(7)=Avatar
 *   I(9)=Tình trạng  K(11)=Username
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

var API_BASE_URL = "API CUA BAN";
var SHEET_NAME = "Accounts";
var DATA_START_ROW = 2;

var COL = {
  USERNAME: 11, // K
  STATUS: 9,   // I — Tình trạng
  FOLLOWERS: 3, // C
  LIKES: 4,    // D
  VIDEOS: 5,   // E
  VIEWS: 6,    // F — Tổng view (30 video gần nhất)
  AVATAR: 7,   // G
};

var SKIP_STATUSES = ["BỊ BAN", "Loại bảo mật", "Outr beta"];

// ─── TRIGGER SETUP (chỉ chạy 1 lần) ───────────────────────────────────────

/**
 * Xoá toàn bộ trigger cũ và tạo lại 3 trigger mới.
 * Vào Apps Script → chọn hàm này → Run
 */
function setupTriggers() {
  // Xoá tất cả trigger cũ của project này
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });

  var ss = SpreadsheetApp.getActive();

  // 1️⃣ Mỗi 10 phút — fetch toàn bộ
  ScriptApp.newTrigger("fetchTikTokStats")
    .timeBased()
    .everyMinutes(10)
    .create();

  // 2️⃣ Khi ai đó mở file — fetch toàn bộ
  // (Phải là installable trigger mới gọi được UrlFetchApp)
  ScriptApp.newTrigger("onOpenTrigger").forSpreadsheet(ss).onOpen().create();

  // 3️⃣ Khi chỉnh sửa — chỉ fetch hàng vừa thay đổi nếu là cột K
  ScriptApp.newTrigger("onEditTrigger").forSpreadsheet(ss).onEdit().create();

  // Rebuild menu (onOpen simple trigger vẫn cần cho menu)
  try {
    SpreadsheetApp.getUi().alert(
      "✅ Đã cài 3 trigger:\n" +
        "• ⏰ Mỗi 10 phút\n" +
        "• 📂 Khi mở file\n" +
        "• ✏️  Khi thay đổi cột K",
    );
  } catch (e) {
    /* chạy từ trigger không có UI */
  }
}

// ─── TRIGGER HANDLERS ──────────────────────────────────────────────────────

/** Trigger: khi mở file */
function onOpenTrigger() {
  var sheet = getSheet();
  if (!sheet) return;
  fetchAllRows(sheet, false); // false = không show alert popup
}

/** Trigger: khi edit ô bất kỳ — chỉ xử lý nếu cột K thay đổi */
function onEditTrigger(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== SHEET_NAME) return;
  if (range.getColumn() !== COL.USERNAME) return;

  var row = range.getRow();
  if (row < DATA_START_ROW) return;

  Logger.log("✏️ Cột K thay đổi tại hàng " + row + " → fetch riêng hàng này");
  fetchSingleRow(sheet, row);
}

// ─── HÀM CHÍNH ─────────────────────────────────────────────────────────────

/** Hàm gọi thủ công hoặc từ trigger 10 phút */
function fetchTikTokStats() {
  var sheet = getSheet();
  if (!sheet) return;
  fetchAllRows(sheet, true); // true = show alert khi xong
}

/** Fetch toàn bộ các hàng có username */
function fetchAllRows(sheet, showAlert) {
  var lastRow = sheet.getLastRow();
  var success = 0,
    skipped = 0,
    failed = 0;

  for (var row = DATA_START_ROW; row <= lastRow; row++) {
    var processed = fetchSingleRow(sheet, row);
    if (processed === "success") success++;
    else if (processed === "error") failed++;
    else skipped++;
  }

  Logger.log(
    "✅ " + success + " OK  ❌ " + failed + " lỗi  ⏩ " + skipped + " bỏ qua",
  );

  if (showAlert) {
    try {
      SpreadsheetApp.getUi().alert(
        "Hoàn tất!\n✅ " +
          success +
          " thành công\n❌ " +
          failed +
          " lỗi (= 0)\n⏩ " +
          skipped +
          " bỏ qua",
      );
    } catch (e) {
      /* trigger không có UI */
    }
  }
}

/**
 * Fetch và ghi dữ liệu cho 1 hàng.
 * @returns "success" | "error" | "skipped"
 */
function fetchSingleRow(sheet, row) {
  var rawUsername = sheet
    .getRange(row, COL.USERNAME)
    .getValue()
    .toString()
    .trim();

  // Bỏ qua nếu không có username
  if (!rawUsername) return "skipped";

  // Bỏ qua nếu tình trạng thuộc danh sách cấm
  var status = sheet.getRange(row, COL.STATUS).getValue().toString().trim();
  if (SKIP_STATUSES.indexOf(status) !== -1) {
    Logger.log("⏭ Hàng " + row + ': bỏ qua vì trạng thái = "' + status + '"');
    return "skipped";
  }

  var username = rawUsername.replace(/^@/, "");
  Logger.log("▶ Hàng " + row + ": @" + username);

  // Loading
  sheet.getRange(row, COL.FOLLOWERS).setValue("⏳");
  sheet.getRange(row, COL.LIKES).setValue("⏳");
  sheet.getRange(row, COL.VIDEOS).setValue("⏳");
  sheet.getRange(row, COL.VIEWS).setValue("⏳");

  sheet.getRange(row, COL.AVATAR).setValue("⏳");
  SpreadsheetApp.flush();

  // Gọi API
  var result = callApi(username);

  if (result.error) {
    sheet.getRange(row, COL.FOLLOWERS).setValue(0);
    sheet.getRange(row, COL.LIKES).setValue(0);
    sheet.getRange(row, COL.VIDEOS).setValue(0);
    sheet.getRange(row, COL.VIEWS).setValue(0);
    sheet.getRange(row, COL.AVATAR).setValue(0);
    sheet.getRange(row, COL.VIEWS).setValue("❌ " + result.error);
    Logger.log("  ❌ " + result.error);
    SpreadsheetApp.flush();
    return "error";
  }

  sheet.getRange(row, COL.FOLLOWERS).setValue(result.followers);
  sheet.getRange(row, COL.LIKES).setValue(result.likes);
  sheet.getRange(row, COL.VIDEOS).setValue(result.videoCount);
  sheet.getRange(row, COL.VIEWS).setValue(result.totalViews !== null ? result.totalViews : "N/A");


  if (result.avatarUrl) {
    var safeUrl = result.avatarUrl.replace(/"/g, "'");
    sheet
      .getRange(row, COL.AVATAR)
      .setFormula('=IMAGE("' + safeUrl + '";4;48;48)');
    sheet.setRowHeight(row, 50);
  } else {
    sheet.getRange(row, COL.AVATAR).setValue("—");
  }

  Logger.log(
    "  ✅ " +
      result.followers +
      " followers | " +
      result.likes +
      " likes | " +
      result.videoCount +
      " videos | " +
      result.totalViews +
      " views",
  );
  SpreadsheetApp.flush();
  return "success";
}

// ─── API ───────────────────────────────────────────────────────────────────

function callApi(username) {
  // Dùng endpoint /profile?views=1 để lấy cả views trong 1 request
  var url =
    API_BASE_URL + "/api/user/" + encodeURIComponent(username) + "/profile?views=1";
  try {
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Accept: "application/json" },
      muteHttpExceptions: true,
      followRedirects: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) return { error: "HTTP " + code };

    var json = JSON.parse(response.getContentText());
    if (!json.success || !json.data) {
      return {
        error:
          json.error && json.error.message ? json.error.message : "API error",
      };
    }

    return {
      followers: Number(json.data.followers || 0),
      likes: Number(json.data.likes || 0),
      videoCount: Number(json.data.videoCount || 0),
      totalViews: json.data.totalViews !== null && json.data.totalViews !== undefined
        ? Number(json.data.totalViews)
        : null,
      avatarUrl: json.data.avatarUrl || "",
    };
  } catch (err) {
    return { error: err.message || "Network error" };
  }
}

// ─── UTILS ─────────────────────────────────────────────────────────────────

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) Logger.log('❌ Không tìm thấy sheet "' + SHEET_NAME + '"');
  return sheet;
}

function nowStr() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "dd/MM/yyyy HH:mm:ss",
  );
}

// ─── MENU ──────────────────────────────────────────────────────────────────

/** Simple trigger: tạo menu mỗi khi mở file */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎵 TikTok")
    .addItem("▶ Cập nhật thống kê", "fetchTikTokStats")
    .addSeparator()
    .addItem("⚙️ Cài trigger tự động", "setupTriggers")
    .addToUi();
}
