/**
 * DEBUG SCRIPT — Chạy cái này trước để kiểm tra:
 * 1. Script có chạy được không
 * 2. Sheet tên gì
 * 3. Cột K có đọc được username không
 * 4. Script có ghi được vào cột C không
 *
 * Nếu chạy thành công → ô C2 sẽ hiện "✅ OK"
 */
async function main(workbook) {
  const sheet = workbook.getActiveWorksheet();

  // In tên sheet
  console.log("Sheet name:", sheet.getName());

  // In giá trị cột K hàng 2 (username đầu tiên)
  const k2 = sheet.getCell(1, 10).getValue(); // row=1 (0-indexed), col=10 (K)
  console.log("K2 value:", k2);

  // Thử ghi vào C2
  sheet.getCell(1, 2).setValue("✅ OK - Script chạy được!");

  // Thử ghi vào D2, E2
  sheet.getCell(1, 3).setValue(12345);
  sheet.getCell(1, 4).setValue(67890);

  console.log("✅ Ghi vào C2, D2, E2 thành công!");
}
