// src/users.js

// 為了增加一點點安全性，我們不直接儲存密碼原文，
// 而是儲存一個 Base64 編碼的版本。

export const userDatabase = {
  // ===== 您的 30 組帳號 (純數字密碼版) =====

  // 揀貨人員 (15組)
  "mztcshipment1": { password: btoa("84629173"), role: "picker", name: "揀貨員 1號" },
  "mztcshipment2": { password: btoa("59173028"), role: "picker", name: "揀貨員 2號" },
  "mztcshipment3": { password: btoa("74028591"), role: "picker", name: "揀貨員 3號" },
  "mztcshipment4": { password: btoa("38591740"), role: "picker", name: "揀貨員 4號" },
  "mztcshipment5": { password: btoa("62917385"), role: "picker", name: "揀貨員 5號" },
  "mztcshipment6": { password: btoa("91738562"), role: "picker", name: "揀貨員 6號" },
  "mztcshipment7": { password: btoa("40285917"), role: "picker", name: "揀貨員 7號" },
  "mztcshipment8": { password: btoa("85917340"), role: "picker", name: "揀貨員 8號" },
  "mztcshipment9": { password: btoa("17340285"), role: "picker", name: "揀貨員 9號" },
  "mztcshipment10": { password: btoa("73402859"), role: "picker", name: "揀貨員 10號" },
  "mztcshipment11": { password: btoa("28591734"), role: "picker", name: "揀貨員 11號" },
  "mztcshipment12": { password: btoa("91734028"), role: "picker", name: "揀貨員 12號" },
  "mztcshipment13": { password: btoa("34028591"), role: "picker", name: "揀貨員 13號" },
  "mztcshipment14": { password: btoa("59173402"), role: "picker", name: "揀貨員 14號" },
  "mztcshipment15": { password: btoa("17340259"), role: "picker", name: "揀貨員 15號" },
  
  // 裝箱人員 (15組)
  "mztcshipment16": { password: btoa("98217346"), role: "packer", name: "裝箱員 16號" },
  "mztcshipment17": { password: btoa("46382173"), role: "packer", name: "裝箱員 17號" },
  "mztcshipment18": { password: btoa("73463821"), role: "packer", name: "裝箱員 18號" },
  "mztcshipment19": { password: btoa("21734638"), role: "packer", name: "裝箱員 19號" },
  "mztcshipment20": { password: btoa("38217346"), role: "packer", name: "裝箱員 20號" },
  "mztcshipment21": { password: btoa("46382173"), role: "packer", name: "裝箱員 21號" },
  "mztcshipment22": { password: btoa("82173463"), role: "packer", name: "裝箱員 22號" },
  "mztcshipment23": { password: btoa("17346382"), role: "packer", name: "裝箱員 23號" },
  "mztcshipment24": { password: btoa("34638217"), role: "packer", name: "裝箱員 24號" },
  "mztcshipment25": { password: btoa("63821734"), role: "packer", name: "裝箱員 25號" },
  "mztcshipment26": { password: btoa("82173463"), role: "packer", name: "裝箱員 26號" },
  "mztcshipment27": { password: btoa("34638217"), role: "packer", name: "裝箱員 27號" },
  "mztcshipment28": { password: btoa("17346382"), role: "packer", name: "裝箱員 28號" },
  "mztcshipment29": { password: btoa("46382173"), role: "packer", name: "裝箱員 29號" },
  "mztcshipment30": { password: btoa("73463821"), role: "packer", name: "裝箱員 30號" },
  "admin": { password: btoa("adminpass"), role: "admin", name: "系統管理員" }
};