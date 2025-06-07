// src/users.js

// 為了增加一點安全性，我們不直接儲存密碼原文，
// 而是儲存一個簡單的編碼版本（例如 Base64）。
// 這不是真正的加密，但至少不會讓密碼在原始碼中一覽無遺。

export const userDatabase = {
  // 揀貨人員
  "picker001": { password: btoa("password123"), role: "picker", name: "王小明" },
  "picker002": { password: btoa("pickerpass"), role: "picker", name: "陳大華" },
  // 可以在這裡繼續新增揀貨人員...

  // 裝箱人員
  "packer001": { password: btoa("packerpw"), role: "packer", name: "李美麗" },
  "packer002": { password: btoa("123456"), role: "packer", name: "張健康" },
  // 可以在這裡繼續新增裝箱人員...

  // 管理員 (可選)
  "admin": { password: btoa("adminpass"), role: "admin", name: "系統管理員" }
};