/**
 * TikTok User Stats — Google Apps Script (Google Sheets)
 *
 * Triggers:
 *   1. Khi mở file   → fetchTikTokStats() toàn bộ
 *   2. Cột K thay đổi → chỉ fetch đúng hàng đó
 *
 * Chỉ chạy setupTriggers() nếu muốn kích hoạt 2 trigger cũ; Telegram Web App
 * không cần các installable trigger này.
 *
 * Layout (1-indexed):
 *   C(3)=Followers  D(4)=Likes  E(5)=Videos  F(6)=Views  G(7)=Avatar
 *   I(9)=Trạng thái dùng để bỏ qua (chỉ đọc)
 *   J(10)=Máy (chỉ đọc)  K(11)=Username (chỉ đọc)
 *   AX(50)=Trạng thái API (đọc/ghi)
 *
 * Script chỉ ghi dữ liệu thống kê vào C:G, trạng thái/note vào AX và chi tiết
 * video vào T:AW của sheet "Accounts". Không ghi vào cột R vì cột đó là
 * "Chủ đề" trong sheet thật.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

var API_BASE_URL = "https://tt-viewer.onrender.com";
var SPREADSHEET_ID = "1JRJ-AsM7qlTfViqYw5j4ZjzlQZRfLrK35HMBGy9DVFw";
var SHEET_NAME = "Accounts";
var DATA_START_ROW = 2;
var OUTPUT_START_COLUMN = 3; // C
var OUTPUT_COLUMN_COUNT = 5; // C:G
var API_STATUS_HEADER = "Trạng thái API";

var COL = {
  USERNAME: 11, // K
  MACHINE: 10, // J (chỉ đọc)
  SKIP_STATUS: 9, // I (chỉ đọc để quyết định bỏ qua hàng)
  STATUS: 50, // AX (đọc/ghi trạng thái kết quả)
  FOLLOWERS: 3, // C
  LIKES: 4, // D
  VIDEOS: 5, // E
  VIEWS: 6, // F — Tổng view (30 video gần nhất)
  AVATAR: 7, // G
};

// Một danh sách dùng chung cho cập nhật toàn sheet, onEdit và bot Telegram.
// So sánh không phân biệt hoa/thường và khoảng trắng thừa.
var SKIP_STATUSES = ["BỊ BAN", "Outr beta"];

// Đánh dấu layout đã được kiểm tra trong execution hiện tại để tránh đọc header
// lặp lại hàng trăm lần khi cập nhật toàn sheet.
var VALIDATED_LAYOUT_SHEET_ID = null;

// ─── TRIGGER SETUP (chỉ chạy 1 lần) ───────────────────────────────────────

/**
 * Xoá đúng các trigger do script quản lý và tạo lại 2 trigger.
 * Vào Apps Script → chọn hàm này → Run
 */
function setupTriggers() {
  // Chỉ xoá trigger do hàm này quản lý; không đụng vào trigger khác của project.
  var managedHandlers = {
    onOpenTrigger: true,
    onEditTrigger: true,
  };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (managedHandlers[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
    }
  });

  var ss = getSpreadsheet();

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
  withScriptLock(function () {
    var sheet = getSheet();
    if (!sheet) return;
    fetchAllRows(sheet, false); // false = không show alert popup
  });
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
  withScriptLock(function () {
    fetchSingleRow(sheet, row);
  });
}

// ─── HÀM CHÍNH ─────────────────────────────────────────────────────────────

/** Hàm gọi thủ công hoặc từ menu */
function fetchTikTokStats() {
  withScriptLock(function () {
    var sheet = getSheet();
    if (!sheet) return;
    fetchAllRows(sheet, true); // true = show alert khi xong
  });
}

/** Fetch toàn bộ các hàng có username */
function fetchAllRows(sheet, showAlert) {
  if (!isTargetSheet(sheet)) return;

  var lastRow = sheet.getLastRow();
  var success = 0,
    skipped = 0,
    failed = 0;

  for (var row = DATA_START_ROW; row <= lastRow; row++) {
    try {
      var processed = fetchSingleRow(sheet, row);
      if (processed === "success" || processed === "not_found") success++;
      else if (processed === "error") failed++;
      else skipped++;
    } catch (rowErr) {
      // Lỗi không mong đợi: log lại, giữ nguyên dữ liệu cũ, tiếp tục dòng tiếp theo
      Logger.log("❌ Hàng " + row + " bị lỗi ngoài dự kiến: " + rowErr.message);
      try {
        getStatusRange(sheet, row).setNote("Lỗi script: " + rowErr.message);
      } catch (e) {
        /* kệ nếu ghi note cũng lỗi */
      }
      failed++;
    }
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
 * @param {string=} expectedMachine mã máy cần giữ nguyên trong lúc gọi API
 * @returns "success" | "not_found" | "error" | "skipped"
 */
function fetchSingleRow(sheet, row, expectedMachine) {
  if (!isTargetSheet(sheet)) return "skipped";
  validateSheetLayout(sheet);
  ensureApiStatusHeader(sheet);

  var rawUsername = sheet
    .getRange(row, COL.USERNAME)
    .getValue()
    .toString()
    .trim();

  // Bỏ qua nếu không có username
  if (!rawUsername) return "skipped";

  // Cột I chỉ dùng để quyết định bỏ qua, không ghi vào cột I.
  var skipStatus = sheet
    .getRange(row, COL.SKIP_STATUS)
    .getValue()
    .toString()
    .trim();
  if (isSkippedStatus(skipStatus)) {
    Logger.log(
      "⏭ Hàng " + row + ': bỏ qua vì trạng thái = "' + skipStatus + '"',
    );
    return "skipped";
  }

  var username = rawUsername.replace(/^@/, "");
  Logger.log("▶ Hàng " + row + ": @" + username);

  // Giữ dữ liệu cũ để khôi phục nếu có lỗi.
  var outputRange = getOutputRange(sheet, row);
  var previous = {
    values: outputRange.getValues()[0],
    formulas: outputRange.getFormulas()[0],
    status: getStatusRange(sheet, row).getValue(),
  };

  try {
    // Gọi API
    var result = callApi(username);

    // Người dùng vẫn có thể sửa sheet trong lúc UrlFetchApp đang chờ. Kiểm tra
    // lại I/J/K trước lần ghi đầu tiên để không áp kết quả cho username/máy đã
    // đổi hoặc dòng vừa chuyển thành BỊ BAN/Outr beta.
    if (
      !isRowStillEligible(sheet, row, rawUsername, expectedMachine)
    ) {
      Logger.log("  ⏩ Dòng đã đổi trong lúc gọi API; không ghi kết quả.");
      return "skipped";
    }

    if (result.error) {
      if (result.code === "USER_NOT_FOUND") {
        // Chỉ ghi 0 khi đã xác nhận tài khoản không tồn tại/không truy cập được.
        writeOutputRow(sheet, row, [0, 0, 0, 0, "—"]);
        clearVideoColumns(sheet, row);
        getStatusRange(sheet, row).setValue(
          result.accountHealthLabel || "KHÔNG TÌM THẤY",
        );
        getStatusRange(sheet, row).setNote(
          "API xác nhận không tìm thấy tại " + nowStr(),
        );
        Logger.log("  ⚠️ Không tìm thấy tài khoản.");
        SpreadsheetApp.flush();
        return "not_found";
      } else {
        // Chưa ghi gì trước khi gọi API, nên giữ nguyên toàn bộ dữ liệu gần
        // nhất thay vì ghi 0 hoặc overwrite một edit vừa diễn ra.
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
    for (var i = 0; i < maxVideos; i++) {
      if (result.videos && i < result.videos.length) {
        var v = result.videos[i];
        var createdTimeStr = "—";
        if (v.create_time) {
          try {
            var date = new Date(Number(v.create_time) * 1000);
            createdTimeStr = Utilities.formatDate(
              date,
              Session.getScriptTimeZone(),
              "HH:mm dd/MM/yyyy",
            );
          } catch (e) {
            createdTimeStr = v.create_time;
          }
        }
        var linkText = "Xem video";
        var text =
          createdTimeStr +
          "\n" +
          "🌍 " +
          (v.region || "") +
          "\n" +
          "▶️ " +
          (v.play_count || 0) +
          "\n" +
          "❤️ " +
          (v.digg_count || 0) +
          "\n" +
          "💬 " +
          (v.comment_count || 0) +
          "\n" +
          "🔁 " +
          (v.share_count || 0) +
          "\n" +
          "📥 " +
          (v.download_count || 0) +
          "\n" +
          "💾 " +
          (v.collect_count || 0) +
          "\n" +
          linkText;

        var richValue = SpreadsheetApp.newRichTextValue()
          .setText(text)
          .setLinkUrl(
            text.indexOf(linkText),
            text.indexOf(linkText) + linkText.length,
            v.link || "",
          )
          .build();
        videoValues.push(richValue);
      } else {
        videoValues.push(SpreadsheetApp.newRichTextValue().setText("").build());
      }
    }
    sheet.getRange(row, 20, 1, maxVideos).setRichTextValues([videoValues]);

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
  } catch (err) {
    // Lỗi bất ngờ (parse JSON, timeout, v.v.): khôi phục giá trị cũ, ghi note, tiếp tục.
    Logger.log("  ⚠️ Hàng " + row + " exception: " + err.message);
    try {
      if (!isRowStillEligible(sheet, row, rawUsername, expectedMachine)) {
        Logger.log("  ⏩ Dòng đã đổi; không khôi phục/ghi note vào dòng này.");
        return "skipped";
      }
      writeOutputRow(sheet, row, previous.values, previous.formulas);
      getStatusRange(sheet, row)
        .setValue(previous.status)
        .setNote("Lỗi script: " + err.message);
      SpreadsheetApp.flush();
    } catch (e) {
      /* kệ nếu ghi lại cũng lỗi */
    }
    return "error";
  }
}

function isRowStillEligible(sheet, row, expectedUsername, expectedMachine) {
  var current = sheet
    .getRange(row, COL.SKIP_STATUS, 1, 3)
    .getDisplayValues()[0]; // I=status, J=machine, K=username
  if (isSkippedStatus(current[0])) return false;
  if (
    String(current[2] || "").trim() !== String(expectedUsername || "").trim()
  ) {
    return false;
  }
  if (
    expectedMachine &&
    normalizeComparable(current[1]).replace(/\s+/g, "") !==
      normalizeComparable(expectedMachine).replace(/\s+/g, "")
  ) {
    return false;
  }
  return true;
}

// ─── API ───────────────────────────────────────────────────────────────────

function callApi(username) {
  // Dùng endpoint /profile?views=1 để lấy cả views trong 1 request
  var url =
    API_BASE_URL +
    "/api/user/" +
    encodeURIComponent(username) +
    "/profile?views=1";
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
      totalViews:
        json.data.totalViews !== null && json.data.totalViews !== undefined
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
  if (sheet.getMaxColumns() < COL.STATUS) {
    throw new Error("Sheet chưa có cột AX cho trạng thái API.");
  }
  var header = normalizeComparable(
    sheet.getRange(1, COL.STATUS).getDisplayValue(),
  );
  if (header !== normalizeComparable(API_STATUS_HEADER)) {
    throw new Error(
      'Cột AX phải có header "' + API_STATUS_HEADER + '" trước khi ghi.',
    );
  }
  return sheet.getRange(row, COL.STATUS);
}

/**
 * Điểm ghi dữ liệu duy nhất cho thống kê profile: C:G trên sheet Accounts.
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

function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    throw new Error("Thiếu SPREADSHEET_ID trong cấu hình Apps Script.");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) Logger.log('❌ Không tìm thấy sheet "' + SHEET_NAME + '"');
  return sheet;
}

/**
 * Chuẩn hoá giá trị dùng để so sánh machine/status/header.
 * NFKC giúp tránh ký tự Unicode nhìn giống nhau; fallback dành cho runtime cũ.
 */
function normalizeComparable(value) {
  var normalized = String(value === null || value === undefined ? "" : value);
  try {
    normalized = normalized.normalize("NFKC");
  } catch (e) {
    /* Runtime Apps Script cũ không hỗ trợ normalize. */
  }
  return normalized.replace(/\s+/g, " ").trim().toUpperCase();
}

function isSkippedStatus(value) {
  var normalized = normalizeComparable(value);
  for (var i = 0; i < SKIP_STATUSES.length; i++) {
    if (normalized === normalizeComparable(SKIP_STATUSES[i])) return true;
  }
  return false;
}

/**
 * Dừng ngay nếu người dùng đổi tên/di chuyển cột. Đây là lớp bảo vệ để script
 * không ghi nhầm vào mật khẩu, email, Chủ đề hoặc dữ liệu khác.
 */
function validateSheetLayout(sheet) {
  if (!isTargetSheet(sheet)) {
    throw new Error('Sai sheet; chỉ chấp nhận tab "' + SHEET_NAME + '".');
  }
  if (VALIDATED_LAYOUT_SHEET_ID === sheet.getSheetId()) return;

  var expectedHeaders = {
    3: "Folow",
    4: "Tym",
    5: "Video",
    6: "Views",
    7: "Ảnh",
    9: "Tình trạng",
    10: "Máy",
    11: "Usename",
    18: "Chủ đề",
    20: "Video 1",
    49: "Video 30",
  };

  Object.keys(expectedHeaders).forEach(function (columnKey) {
    var column = Number(columnKey);
    var actual = sheet.getRange(1, column).getDisplayValue();
    var expected = expectedHeaders[columnKey];
    if (normalizeComparable(actual) !== normalizeComparable(expected)) {
      throw new Error(
        "Layout sheet không đúng tại cột " +
          column +
          ': cần header "' +
          expected +
          '", hiện là "' +
          actual +
          '". Script đã dừng để tránh ghi nhầm dữ liệu.',
      );
    }
  });

  VALIDATED_LAYOUT_SHEET_ID = sheet.getSheetId();
}

/** Tạo header AX nếu cột còn trống; không bao giờ ghi đè một header khác. */
function ensureApiStatusHeader(sheet) {
  var statusColumnWasAdded = false;
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns < COL.STATUS) {
    // Sheet hiện tại kết thúc ở AW (49). Chỉ append cột mới ở cuối; không chèn
    // vào giữa và không dịch chuyển dữ liệu đang có.
    sheet.insertColumnsAfter(maxColumns, COL.STATUS - maxColumns);
    statusColumnWasAdded = true;
  }

  var headerRange = sheet.getRange(1, COL.STATUS);
  var current = headerRange.getDisplayValue();
  if (!normalizeComparable(current)) {
    if (
      !statusColumnWasAdded &&
      (headerRange.getFormula() || headerRange.getNote())
    ) {
      throw new Error(
        "AX1 có formula/note dù hiển thị trống; script không ghi đè ô này.",
      );
    }
    // AX1 trống chưa đủ để kết luận cả cột chưa được dùng. Kiểm tra value,
    // formula và note ở mọi hàng đang có dữ liệu trước khi nhận cột AX.
    var rowsToCheck = Math.max(0, sheet.getMaxRows() - 1);
    if (!statusColumnWasAdded && rowsToCheck) {
      var existingRange = sheet.getRange(2, COL.STATUS, rowsToCheck, 1);
      var values = existingRange.getValues();
      var formulas = existingRange.getFormulas();
      var notes = existingRange.getNotes();
      for (var rowIndex = 0; rowIndex < rowsToCheck; rowIndex++) {
        var existingValue = values[rowIndex][0];
        if (
          (existingValue !== "" && existingValue !== null) ||
          String(formulas[rowIndex][0] || "") ||
          String(notes[rowIndex][0] || "")
        ) {
          throw new Error(
            "Cột AX có dữ liệu/công thức/note nhưng AX1 đang trống; script " +
              "không chiếm cột này. Hãy chọn một cột trống khác.",
          );
        }
      }
    }
    headerRange.setValue(API_STATUS_HEADER);
    return;
  }
  if (normalizeComparable(current) !== normalizeComparable(API_STATUS_HEADER)) {
    throw new Error(
      'Cột AX đang được dùng với header "' +
        current +
        '"; script không ghi đè. Hãy chọn một cột trống khác cho COL.STATUS.',
    );
  }
}

/**
 * Ngăn onOpen, onEdit, chạy thủ công và Telegram ghi cùng lúc.
 * @param {Function} callback công việc cần chạy trong lock
 * @param {number=} waitMs thời gian chờ lock, mặc định 5 giây
 */
function withScriptLock(callback, waitMs) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(waitMs || 5000);
  if (!acquired) {
    var busyError = new Error(
      "Sheet đang được một tiến trình khác cập nhật. Vui lòng thử lại sau.",
    );
    busyError.code = "BUSY";
    throw busyError;
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
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
  for (var i = 0; i < 30; i++) {
    emptyValues.push(SpreadsheetApp.newRichTextValue().setText("").build());
  }
  sheet.getRange(row, 20, 1, 30).setRichTextValues([emptyValues]);
}
