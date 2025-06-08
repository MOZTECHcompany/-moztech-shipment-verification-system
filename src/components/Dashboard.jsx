// 在 Dashboard.jsx 中，替換掉舊的 handleScan 函式

const handleScan = () => {
  const userInput = barcodeInput; // 保留原始輸入
  setBarcodeInput('');
  barcodeInputRef.current?.focus();

  if (!userInput.trim()) return;

  // --- START: 偵錯實驗 ---
  console.clear(); // 清空主控台，方便查看
  console.log("--- 開始偵錯 ---");
  console.log(`使用者輸入的原始條碼: "${userInput}"`);
  console.log(`使用者輸入的長度: ${userInput.length}`);
  
  const firstItemFromExcel = shipmentData[0];
  if (firstItemFromExcel) {
    const excelBarcode = String(firstItemFromExcel.barcode);
    console.log(`Excel 中第一個品項的原始條碼: "${excelBarcode}"`);
    console.log(`Excel 條碼的長度: ${excelBarcode.length}`);
    
    console.log("--- 比較結果 ---");
    console.log(`直接比較 (===): ${excelBarcode === userInput}`);
    console.log(`清理後比較 (trim): ${excelBarcode.trim() === userInput.trim()}`);

    const normalize = (str) => String(str).replace(/\s/g, '');
    console.log(`移除所有空白後比較: ${normalize(excelBarcode) === normalize(userInput)}`);

    const normalizeUltimate = (str) => String(str).replace(/[^a-zA-Z0-9]/g, '');
    console.log(`只保留字母和數字後比較: ${normalizeUltimate(excelBarcode) === normalizeUltimate(userInput)}`);

    // 為了看得更清楚，我們將每個字元的編碼印出來
    console.log("使用者輸入的字元編碼:", userInput.split('').map(char => char.charCodeAt(0)));
    console.log("Excel 條碼的字元編碼:", excelBarcode.split('').map(char => char.charCodeAt(0)));
  } else {
    console.log("錯誤：出貨單資料是空的，無法進行比較。");
  }
  console.log("--- 偵錯結束 ---");
  // --- END: 偵錯實驗 ---

  // 暫時將後續的邏輯註解掉，我們先專注於比較
  /*
  const item = shipmentData.