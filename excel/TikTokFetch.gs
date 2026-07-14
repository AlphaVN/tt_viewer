/**
 * TikTok User Stats — Google Apps Script (Google Sheets)
 *
 * Triggers:
 *   1. Khi mở file   → fetchTikTokStats() toàn bộ
 *   2. Cột K thay đổi → chỉ fetch đúng hàng đó
 *
 * Chạy setupTriggers() 1 lần duy nhất để kích hoạt cả 2 trigger.
 *
 * Layout (1-indexed):
 *   C(3)=Followers  D(4)=Likes  E(5)=Videos  F(6)=Views  G(7)=Avatar
 *   I(9)=Trạng thái dùng để bỏ qua (chỉ đọc)
 *   K(11)=Username (chỉ đọc)  R(18)=Status (đọc/ghi)
 *
 * Script chỉ ghi dữ liệu thống kê vào C:G và trạng thái/note vào R của sheet
 * "Account". Không ghi vào ô nào khác.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

var API_BASE_URL = "https://tt-viewer.onrender.com";
var SHEET_NAME = "Accounts";
var DATA_START_ROW = 2;
var OUTPUT_START_COLUMN = 3; // C
var OUTPUT_COLUMN_COUNT = 5; // C:G

var COL = {
  USERNAME: 11, // K
  SKIP_STATUS: 9, // I (chỉ đọc để quyết định bỏ qua hàng)
  STATUS: 18,     // R (đọc/ghi trạng thái kết quả)
  FOLLOWERS: 3, // C
  LIKES: 4,     // D
  VIDEOS: 5,   // E
  VIEWS: 6,    // F — Tổng view (30 video gần nhất)
  AVATAR: 7,   // G
};

var SKIP_STATUSES = ["BỊ BAN", "Loại bảo mật", "Outr beta"];

// ─── TRIGGER SETUP (chỉ chạy 1 lần) ───────────────────────────────────────

/**
 * Xoá toàn bộ trigger cũ và tạo lại 2 trigger mới.
 * Vào Apps Script → chọn hàm này → Run
 */
function setupTriggers() {
  // Xoá tất cả trigger cũ của project này
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });

  var ss = SpreadsheetApp.getActive();

  // 1️⃣ Khi ai đó mở file — fetch toàn bộ
  // (Phải là installable trigger mới gọi được UrlFetchApp)
  ScriptApp.newTrigger("onOpenTrigger").forSpreadsheet(ss).onOpen().create();

  // 2️⃣ Khi chỉnh sửa — chỉ fetch hàng vừa thay đổi nếu là cột K
  ScriptApp.newTrigger("onEditTrigger").forSpreadsheet(ss).onEdit().create();

  // Rebuild menu (onOpen simple trigger vẫn cần cho menu)
  try {
    SpreadsheetApp.getUi().alert(
      "✅ Đã cài 2 trigger:\n" +
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

/** Hàm gọi thủ công hoặc từ menu */
function fetchTikTokStats() {
  var sheet = getSheet();
  if (!sheet) return;
  fetchAllRows(sheet, true); // true = show alert khi xong
}

/** Fetch toàn bộ các hàng có username */
function fetchAllRows(sheet, showAlert) {
  if (!isTargetSheet(sheet)) return;

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
          " lỗi\n⏩ " +
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
  if (!isTargetSheet(sheet)) return "skipped";

  var rawUsername = sheet
    .getRange(row, COL.USERNAME)
    .getValue()
    .toString()
    .trim();

  // Bỏ qua nếu không có username
  if (!rawUsername) return "skipped";

  // Cột I chỉ dùng để quyết định bỏ qua, không ghi vào cột I.
  var skipStatus = sheet.getRange(row, COL.SKIP_STATUS).getValue().toString().trim();
  if (SKIP_STATUSES.indexOf(skipStatus) !== -1) {
    Logger.log("⏭ Hàng " + row + ': bỏ qua vì trạng thái = "' + skipStatus + '"');
    return "skipped";
  }

  var username = rawUsername.replace(/^@/, "");
  Logger.log("▶ Hàng " + row + ": @" + username);

  // Giữ dữ liệu cũ để không làm mất số liệu khi API tạm thời lỗi.
  var outputRange = getOutputRange(sheet, row);
  var previous = {
    values: outputRange.getValues()[0],
    formulas: outputRange.getFormulas()[0],
    status: getStatusRange(sheet, row).getValue(),
  };

  // Loading — chỉ ghi C:G.
  writeOutputRow(sheet, row, ["⏳", "⏳", "⏳", "⏳", "⏳"]);
  SpreadsheetApp.flush();

  // Gọi API
  var result = callApi(username);

  if (result.error) {
    if (result.code === "USER_NOT_FOUND") {
      // Chỉ ghi 0 khi đã xác nhận tài khoản không tồn tại/không truy cập được.
      writeOutputRow(sheet, row, [0, 0, 0, 0, "—"]);
      clearVideoColumns(sheet, row);
      getStatusRange(sheet, row).setValue(
        result.accountHealthLabel || "KHÔNG TÌM THẤY",
      );
    } else {
      // Lỗi mạng/provider: khôi phục dữ liệu gần nhất thay vì biến thành 0 giả.
      writeOutputRow(sheet, row, previous.values, previous.formulas);
      getStatusRange(sheet, row).setValue(previous.status);
    }
    getStatusRange(sheet, row).setNote(
      "Lần kiểm tra gần nhất lỗi: " + result.error,
    );
    Logger.log("  ❌ " + result.error);
    SpreadsheetApp.flush();
    return "error";
  }

  var avatarValue = "—";
  var avatarFormula = "";
  if (result.avatarUrl) {
    var safeUrl = result.avatarUrl.replace(/"/g, "'");
    avatarFormula = '=IMAGE("' + safeUrl + '";4;48;48)';
  }

  writeOutputRow(
    sheet,
    row,
    [
      result.followers,
      result.likes,
      result.videoCount,
      result.totalViews !== null ? result.totalViews : "RIÊNG TƯ",
      avatarValue,
    ],
    ["", "", "", "", avatarFormula],
  );

  // Ghi chi tiết 30 video bắt đầu từ cột T (cột 20)
  var videoValues = [];
  var maxVideos = 30;
  var fieldsPerVideo = 8;
  for (var i = 0; i < maxVideos; i++) {
    if (result.videos && i < result.videos.length) {
      var v = result.videos[i];
      videoValues.push(v.link || "");
      videoValues.push(v.region || "");
      videoValues.push(v.play_count !== undefined && v.play_count !== null ? Number(v.play_count) : 0);
      videoValues.push(v.digg_count !== undefined && v.digg_count !== null ? Number(v.digg_count) : 0);
      videoValues.push(v.comment_count !== undefined && v.comment_count !== null ? Number(v.comment_count) : 0);
      videoValues.push(v.share_count !== undefined && v.share_count !== null ? Number(v.share_count) : 0);
      videoValues.push(v.download_count !== undefined && v.download_count !== null ? Number(v.download_count) : 0);
      videoValues.push(v.collect_count !== undefined && v.collect_count !== null ? Number(v.collect_count) : 0);
    } else {
      for (var f = 0; f < fieldsPerVideo; f++) {
        videoValues.push("");
      }
    }
  }
  sheet.getRange(row, 20, 1, maxVideos * fieldsPerVideo).setValues([videoValues]);

  getStatusRange(sheet, row)
    .setValue(result.accountHealthLabel || "KHÔNG XÁC ĐỊNH")
    .clearNote();

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
  // Không flush lần nữa ở đây: công thức IMAGE() tại G tải bất đồng bộ và
  // không được phép giữ luồng cập nhật C:F chờ avatar.
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
    var json = JSON.parse(response.getContentText());
    if (code !== 200) {
      return {
        error:
          json.error && json.error.message
            ? json.error.message
            : "HTTP " + code,
        code: json.error && json.error.code ? json.error.code : "HTTP_" + code,
        accountHealthLabel:
          json.error &&
          json.error.details &&
          json.error.details.accountHealth &&
          json.error.details.accountHealth.label
            ? json.error.details.accountHealth.label
            : "",
      };
    }
    if (!json.success || !json.data) {
      return {
        error:
          json.error && json.error.message ? json.error.message : "API error",
        code: json.error && json.error.code ? json.error.code : "API_ERROR",
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
      videos: json.data.videos || [],
      accountHealthLabel:
        json.data.accountHealth && json.data.accountHealth.label
          ? json.data.accountHealth.label
          : "KHÔNG XÁC ĐỊNH",
    };
  } catch (err) {
    return { error: err.message || "Network error" };
  }
}

// ─── UTILS ─────────────────────────────────────────────────────────────────

function isTargetSheet(sheet) {
  return Boolean(sheet) && sheet.getName() === SHEET_NAME;
}

function getOutputRange(sheet, row) {
  if (!isTargetSheet(sheet)) {
    throw new Error('Chỉ được ghi vào sheet "' + SHEET_NAME + '".');
  }
  return sheet.getRange(row, OUTPUT_START_COLUMN, 1, OUTPUT_COLUMN_COUNT);
}

function getStatusRange(sheet, row) {
  if (!isTargetSheet(sheet)) {
    throw new Error('Chỉ được ghi vào sheet "' + SHEET_NAME + '".');
  }
  return sheet.getRange(row, COL.STATUS);
}

/**
 * Điểm ghi dữ liệu duy nhất: C:G trên sheet Account.
 * formulas là tùy chọn và chỉ được áp dụng trong cùng phạm vi C:G.
 */
function writeOutputRow(sheet, row, values, formulas) {
  if (!values || values.length !== OUTPUT_COLUMN_COUNT) {
    throw new Error("Dữ liệu ghi phải có đúng 5 giá trị cho C:G.");
  }

  getOutputRange(sheet, row).setValues([values]);

  if (formulas) {
    if (formulas.length !== OUTPUT_COLUMN_COUNT) {
      throw new Error("Danh sách công thức phải có đúng 5 phần tử cho C:G.");
    }
    formulas.forEach(function (formula, index) {
      if (formula) {
        sheet.getRange(row, OUTPUT_START_COLUMN + index).setFormula(formula);
      }
    });
  }
}

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
function clearVideoColumns(sheet, row) {
  var emptyValues = [];
  for (var i = 0; i < 240; i++) {
    emptyValues.push("");
  }
  sheet.getRange(row, 20, 1, 240).setValues([emptyValues]);
}
