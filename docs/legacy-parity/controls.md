# 舊 WMS 操作節點逐項索引

基準：`d4e2bff12545d9243787d52850c16f36e1db4eed`。此表來自完整原始碼 AST 與實際 import/export 連結，不把未被載入的備份畫面當成上線功能。每列是原始操作的精確位置與事件繫結；完整流程與測試結論見 `WMS_FULL_PARITY_2026-09-14.md`。

| 編號 | 原始元件與行號 | 操作／繫結 |
|---|---|---|
| C001 | frontend/src/App.jsx:74 | `Route` path="/login" element={<LoginPage onLogin={handleLogin}/>} |
| C002 | frontend/src/App.jsx:76 | `Route` element={<ProtectedRoute user={user}token={token}/>} |
| C003 | frontend/src/App.jsx:77 | `Route` element={<AppLayout user={user}onLogout={handleLogout}/>} |
| C004 | frontend/src/App.jsx:78 | `Route` path="/admin" element={user?.role==='admin'\|\|user?.role==='superadmin'\|\|user?.role==='dispatcher'?<AdminDashboard user={user}/>:<Navigate to="/tasks"/>} |
| C005 | frontend/src/App.jsx:79 | `Route` path="/admin/users" element={user?.role==='admin'\|\|user?.role==='superadmin'?<UserManagement currentUser={user}/>:<Navigate to="/tasks"/>} |
| C006 | frontend/src/App.jsx:80 | `Route` path="/admin/operation-logs" element={user?.role==='admin'\|\|user?.role==='superadmin'?<OperationLogs/>:<Navigate to="/tasks"/>} |
| C007 | frontend/src/App.jsx:81 | `Route` path="/admin/analytics" element={user?.role==='admin'\|\|user?.role==='superadmin'?<Analytics/>:<Navigate to="/tasks"/>} |
| C008 | frontend/src/App.jsx:82 | `Route` path="/admin/scan-errors" element={user?.role==='admin'\|\|user?.role==='superadmin'?<ScanErrors/>:<Navigate to="/tasks"/>} |
| C009 | frontend/src/App.jsx:83 | `Route` path="/admin/defects" element={user?.role==='admin'\|\|user?.role==='superadmin'?<DefectStats/>:<Navigate to="/tasks"/>} |
| C010 | frontend/src/App.jsx:84 | `Route` path="/admin/exceptions" element={user?.role==='admin'\|\|user?.role==='superadmin'?<Exceptions/>:<Navigate to="/tasks"/>} |
| C011 | frontend/src/App.jsx:85 | `Route` path="/tasks" element={<TaskDashboard user={user}/>} |
| C012 | frontend/src/App.jsx:86 | `Route` path="/team" element={<TeamBoard user={user}/>} |
| C013 | frontend/src/App.jsx:87 | `Route` path="/team/:postId" element={<TeamPostView user={user}/>} |
| C014 | frontend/src/App.jsx:88 | `Route` path="/order/:orderId" element={<OrderWorkView user={user}/>} |
| C015 | frontend/src/App.jsx:92 | `Route` path="/" element={<Navigate to={getHomeRoute()}replace/>} |
| C016 | frontend/src/components/CameraScanner.jsx:165 | `button` onClick={onClose} |
| C017 | frontend/src/components/CameraScanner.jsx:182 | `Button` onClick={()=>window.location.reload()} variant="secondary" |
| C018 | frontend/src/components/CameraScanner.jsx:220 | `button` onClick={()=>setShowSettings(!showSettings)} |
| C019 | frontend/src/components/CameraScanner.jsx:243 | `button` onClick={()=>setScannedCodes([])} |
| C020 | frontend/src/components/CameraScanner.jsx:260 | `button` key={device.deviceId} onClick={()=>switchCamera(device.deviceId)} |
| C021 | frontend/src/components/DefectReportModal.jsx:114 | `button` onClick={onClose} |
| C022 | frontend/src/components/DefectReportModal.jsx:127 | `form` onSubmit={handleSubmit} |
| C023 | frontend/src/components/DefectReportModal.jsx:137 | `input` type="text" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder="搜尋產品名稱 / 料號..." |
| C024 | frontend/src/components/DefectReportModal.jsx:144 | `select` value={selectedItemId} onChange={e=>{setSelectedItemId(e.target.value);setOldSn('');}} |
| C025 | frontend/src/components/DefectReportModal.jsx:166 | `input` type="text" value={oldSnSearch} onChange={e=>setOldSnSearch(e.target.value)} placeholder="搜尋 SN..." |
| C026 | frontend/src/components/DefectReportModal.jsx:173 | `select` value={oldSn} onChange={e=>setOldSn(e.target.value)} required |
| C027 | frontend/src/components/DefectReportModal.jsx:194 | `input` type="text" value={newSn} onChange={e=>setNewSn(e.target.value)} placeholder="掃描或輸入新 SN" required |
| C028 | frontend/src/components/DefectReportModal.jsx:211 | `textarea` value={reason} onChange={e=>setReason(e.target.value)} placeholder="請詳細描述不良原因..." required rows={3} |
| C029 | frontend/src/components/DefectReportModal.jsx:222 | `Button` type="button" variant="secondary" onClick={onClose} |
| C030 | frontend/src/components/FloatingChatPanel.jsx:307 | `div` onClick={()=>{setIsMinimized(false);recomputePosition();}} |
| C031 | frontend/src/components/FloatingChatPanel.jsx:365 | `button` onClick={()=>setIsMinimized(true)} |
| C032 | frontend/src/components/FloatingChatPanel.jsx:371 | `button` onClick={()=>setIsMaximized(!isMaximized)} |
| C033 | frontend/src/components/FloatingChatPanel.jsx:377 | `button` onClick={onClose} |
| C034 | frontend/src/components/FloatingChatPanel.jsx:472 | `button` key={user.id} onClick={()=>insertMention(user.username)} |
| C035 | frontend/src/components/FloatingChatPanel.jsx:508 | `textarea` ref={textareaRef} value={message} onChange={handleTextChange} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}} placeholder="輸入訊息..." rows={1} |
| C036 | frontend/src/components/FloatingChatPanel.jsx:527 | `button` onClick={()=>setShowEmojiPicker(!showEmojiPicker)} |
| C037 | frontend/src/components/FloatingChatPanel.jsx:534 | `button` onClick={()=>setPriority(priority==='urgent'?'normal':'urgent')} |
| C038 | frontend/src/components/FloatingChatPanel.jsx:549 | `button` onClick={handleSend} disabled={!message.trim()\|\|isSending} |
| C039 | frontend/src/components/FloatingChatPanel.jsx:572 | `button` key={idx} onClick={()=>insertEmoji(emoji)} |
| C040 | frontend/src/components/LabelPrinter.jsx:23 | `button` onClick={handlePrint} title="列印出貨標籤" |
| C041 | frontend/src/components/LabelPrinter.jsx:175 | `button` onClick={handlePrint} title="列印揀貨單" |
| C042 | frontend/src/components/LabelPrinter.jsx:399 | `button` onClick={handleBatchPrint} |
| C043 | frontend/src/components/LoginPage.jsx:53 | `div` onKeyDown={handleKeyDown} |
| C044 | frontend/src/components/LoginPage.jsx:66 | `Input` label="使用者名稱" icon={User} value={username} onChange={e=>setUsername(e.target.value)} placeholder="請輸入使用者名稱" autoComplete="username" |
| C045 | frontend/src/components/LoginPage.jsx:74 | `Input` label="密碼" type="password" icon={Lock} value={password} onChange={e=>setPassword(e.target.value)} placeholder="請輸入密碼" autoComplete="current-password" |
| C046 | frontend/src/components/LoginPage.jsx:88 | `Button` onClick={handleLoginClick} disabled={isLoggingIn} variant="primary" size="lg" |
| C047 | frontend/src/components/NotificationCenter.jsx:92 | `button` onClick={()=>setIsOpen(!isOpen)} |
| C048 | frontend/src/components/NotificationCenter.jsx:122 | `button` onClick={markAllAsRead} |
| C049 | frontend/src/components/NotificationCenter.jsx:180 | `button` key={order.order_id} onClick={()=>handleOpenChat(order.order_id,order.voucher_number)} |
| C050 | frontend/src/components/OrderWorkView.jsx:45 | `button` onClick={onClick} disabled={disabled\|\|isUpdating} |
| C051 | frontend/src/components/OrderWorkView.jsx:96 | `button` onClick={toggleFocusMode} |
| C052 | frontend/src/components/OrderWorkView.jsx:111 | `button` onClick={onOpenCamera} |
| C053 | frontend/src/components/OrderWorkView.jsx:120 | `button` onClick={()=>onOpenDefectModal?.()} title="新品不良 SN 更換" |
| C054 | frontend/src/components/OrderWorkView.jsx:145 | `button` onClick={onExport} title="匯出報告" |
| C055 | frontend/src/components/OrderWorkView.jsx:154 | `button` onClick={onVoid} title="作廢訂單" |
| C056 | frontend/src/components/OrderWorkView.jsx:301 | `button` onClick={()=>setExpanded(!expanded)} |
| C057 | frontend/src/components/OrderWorkView.jsx:384 | `QuantityButton` icon={Minus} onClick={()=>onUpdate(item.barcode,'pick',-1,item.id)} disabled={!canAdjustPick\|\|item.picked_quantity<=0} isUpdating={isUpdating} |
| C058 | frontend/src/components/OrderWorkView.jsx:397 | `QuantityButton` icon={Plus} onClick={()=>onUpdate(item.barcode,'pick',1,item.id)} disabled={!canAdjustPick\|\|item.picked_quantity>=item.quantity} isUpdating={isUpdating} |
| C059 | frontend/src/components/OrderWorkView.jsx:405 | `QuantityButton` icon={Minus} onClick={()=>onUpdate(item.barcode,'pack',-1,item.id)} disabled={!canAdjustPack\|\|item.packed_quantity<=0} isUpdating={isUpdating} |
| C060 | frontend/src/components/OrderWorkView.jsx:418 | `QuantityButton` icon={Plus} onClick={()=>onUpdate(item.barcode,'pack',1,item.id)} disabled={!canAdjustPack\|\|item.packed_quantity>=item.picked_quantity} isUpdating={isUpdating} |
| C061 | frontend/src/components/OrderWorkView.jsx:1804 | `Button` variant="ghost" size="sm" onClick={handleReturnToTasks} leadingIcon={ArrowLeft} |
| C062 | frontend/src/components/OrderWorkView.jsx:1861 | `input` ref={barcodeInputRef} type="text" placeholder={!canOperate?'僅檢視模式（不可掃描）':operationBlockedByOrderChange?'訂單異動審核中（需先主管核可）':packBlockedByExceptions?'需先主管核可（Open 例外）':'點擊掃描...'} value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={handleKeyDown} disabled={!canOperate\|\|packBlockedByExceptions\|\|operationBlockedByOrderChange} |
| C063 | frontend/src/components/OrderWorkView.jsx:1876 | `button` onClick={handleClick} disabled={isUpdating\|\|!canOperate\|\|packBlockedByExceptions\|\|operationBlockedByOrderChange} |
| C064 | frontend/src/components/OrderWorkView.jsx:1910 | `Button` size="sm" variant="secondary" onClick={()=>{setCreateExceptionType('stockout');setCreateExceptionReason('');setCreateExceptionOpen(true);}} |
| C065 | frontend/src/components/OrderWorkView.jsx:1923 | `Button` size="sm" disabled={hasOpenOrderChange} onClick={openOrderChangeEditor} |
| C066 | frontend/src/components/OrderWorkView.jsx:2014 | `Button` size="sm" variant="secondary" onClick={()=>fetchExceptionAttachments(ex.id)} disabled={!!attachmentsLoadingById[ex.id]} |
| C067 | frontend/src/components/OrderWorkView.jsx:2022 | `Button` size="sm" variant="secondary" onClick={()=>uploadExceptionAttachments(ex.id)} |
| C068 | frontend/src/components/OrderWorkView.jsx:2042 | `Button` size="xs" variant="ghost" onClick={()=>previewExceptionAttachment(ex.id,att)} disabled={attachmentPreviewLoading} |
| C069 | frontend/src/components/OrderWorkView.jsx:2050 | `Button` size="xs" variant="ghost" onClick={()=>downloadExceptionAttachment(ex.id,att)} |
| C070 | frontend/src/components/OrderWorkView.jsx:2090 | `Button` size="sm" onClick={()=>handleAckException(ex.id)} |
| C071 | frontend/src/components/OrderWorkView.jsx:2093 | `Button` size="sm" variant="danger" onClick={()=>handleRejectException(ex.id)} |
| C072 | frontend/src/components/OrderWorkView.jsx:2099 | `Button` size="sm" onClick={()=>handleResolveException(ex.id)} |
| C073 | frontend/src/components/OrderWorkView.jsx:2109 | `Button` size="sm" variant="secondary" onClick={()=>openProposalModal(ex)} |
| C074 | frontend/src/components/OrderWorkView.jsx:2197 | `Button` onClick={()=>setIsFocusMode(false)} variant="secondary" size="sm" |
| C075 | frontend/src/components/OrderWorkView.jsx:2242 | `Button` variant="secondary" onClick={()=>setCreateExceptionOpen(false)} disabled={createExceptionSubmitting} |
| C076 | frontend/src/components/OrderWorkView.jsx:2249 | `Button` onClick={handleCreateException} disabled={createExceptionSubmitting} |
| C077 | frontend/src/components/OrderWorkView.jsx:2261 | `select` value={createExceptionType} onChange={e=>setCreateExceptionType(e.target.value)} disabled={createExceptionSubmitting} |
| C078 | frontend/src/components/OrderWorkView.jsx:2278 | `textarea` value={createExceptionReason} onChange={e=>setCreateExceptionReason(e.target.value)} placeholder="請描述原因與現場狀況（必填）" disabled={createExceptionSubmitting} |
| C079 | frontend/src/components/OrderWorkView.jsx:2299 | `Button` variant="secondary" onClick={closeProposalModal} disabled={proposalSubmitting} |
| C080 | frontend/src/components/OrderWorkView.jsx:2300 | `Button` onClick={submitProposal} disabled={proposalSubmitting} |
| C081 | frontend/src/components/OrderWorkView.jsx:2314 | `select` value={proposalAction} onChange={e=>setProposalAction(e.target.value)} |
| C082 | frontend/src/components/OrderWorkView.jsx:2329 | `input` type="text" value={proposalNewSn} onChange={e=>setProposalNewSn(e.target.value)} placeholder="例如：B19B52004754 或 52004754" |
| C083 | frontend/src/components/OrderWorkView.jsx:2340 | `input` type="text" value={proposalCorrectBarcode} onChange={e=>setProposalCorrectBarcode(e.target.value)} placeholder="若現場掃到錯條碼，可填正確值供管理員核准" |
| C084 | frontend/src/components/OrderWorkView.jsx:2351 | `textarea` value={proposalNote} onChange={e=>setProposalNote(e.target.value)} rows={3} placeholder="請描述處理方式與原因，管理員會依此審核" |
| C085 | frontend/src/components/OrderWorkView.jsx:2375 | `Button` variant="secondary" onClick={()=>setOrderChangeOpen(false)} disabled={orderChangeSubmitting} |
| C086 | frontend/src/components/OrderWorkView.jsx:2382 | `Button` onClick={goOrderChangeConfirm} disabled={orderChangeSubmitting} |
| C087 | frontend/src/components/OrderWorkView.jsx:2391 | `Button` variant="secondary" onClick={()=>setOrderChangeStep('edit')} disabled={orderChangeSubmitting} |
| C088 | frontend/src/components/OrderWorkView.jsx:2398 | `Button` onClick={submitOrderChange} disabled={orderChangeSubmitting} |
| C089 | frontend/src/components/OrderWorkView.jsx:2414 | `textarea` value={orderChangeReason} onChange={e=>setOrderChangeReason(e.target.value)} placeholder="請描述異動原因（必填）" disabled={orderChangeSubmitting} |
| C090 | frontend/src/components/OrderWorkView.jsx:2426 | `Button` size="sm" variant="secondary" onClick={addNewOrderChangeItem} disabled={orderChangeSubmitting} |
| C091 | frontend/src/components/OrderWorkView.jsx:2474 | `Button` size="xs" variant="secondary" onClick={()=>removeNewOrderChangeItem(row.id)} disabled={orderChangeSubmitting} |
| C092 | frontend/src/components/OrderWorkView.jsx:2479 | `Button` size="sm" variant="secondary" onClick={()=>toggleOrderChangeExpanded(row.id)} disabled={orderChangeSubmitting} |
| C093 | frontend/src/components/OrderWorkView.jsx:2491 | `input` type="text" value={row.barcode} onChange={e=>updateOrderChangeDraft(row.id,{barcode:e.target.value})} placeholder="例如：4712345678901" disabled={orderChangeSubmitting\|\|!row.isNew&&!!row.barcode} |
| C094 | frontend/src/components/OrderWorkView.jsx:2506 | `input` type="text" value={row.productName} onChange={e=>updateOrderChangeDraft(row.id,{productName:e.target.value})} placeholder="例如：某某商品" disabled={orderChangeSubmitting} |
| C095 | frontend/src/components/OrderWorkView.jsx:2518 | `input` type="number" min={minTarget} value={row.targetQty} onChange={e=>{const raw=e.target.value;if(raw===''){updateOrderChangeDraft(row.id,{targetQty:'',removeSelected:[]});return;}const n=Number(e.target.value);const next=Number.isFinite(n)?Math.max(minTarget,Math.trunc(n)):row.targetQty;if(isSn){const nextDelta=next-originalQty;const nextRemove=nextDelta<0?Math.abs(nextDelta):0;const need=nextDelta<0?Math.max(0,nextRemove-untrackedQty):0;if(need===0){updateOrderChangeDraft(row.id,{targetQty:next,removeSelected:[]});return;}const pendingUpper=pendingSerials.map(x=>String(x).toUpperCase());const pendingSet=new Set(pendingUpper);const current=parseSnText((Array.isArray(row?.removeSelected)?row.removeSelected:[]).join('\n')).filter(sn=>pendingSet.has(String(sn).toUpperCase()));const currentSet=ne |
| C096 | frontend/src/components/OrderWorkView.jsx:2581 | `input` type="checkbox" checked={!!row.isSn} onChange={e=>updateOrderChangeDraft(row.id,{isSn:e.target.checked,addSnText:'',removeSelected:[]})} disabled={orderChangeSubmitting} |
| C097 | frontend/src/components/OrderWorkView.jsx:2597 | `textarea` value={row.addSnText} onChange={e=>updateOrderChangeDraft(row.id,{addSnText:e.target.value})} placeholder="可用換行/空白/逗號分隔；支援 SN: 前綴" rows={3} disabled={orderChangeSubmitting} |
| C098 | frontend/src/components/OrderWorkView.jsx:2613 | `textarea` value={(removeSelected\|\|[]).join('\n')} onChange={e=>updateOrderChangeDraft(row.id,{removeSelected:parseSnText(e.target.value)})} placeholder="貼上要移除的 SN（可用換行/空白/逗號分隔）" rows={3} disabled={orderChangeSubmitting} |
| C099 | frontend/src/components/OrderWorkView.jsx:2632 | `button` key={key} type="button" onClick={()=>{const next=selected?removeSelected.filter(x=>String(x).toUpperCase()!==key):[...removeSelected,sn];updateOrderChangeDraft(row.id,{removeSelected:parseSnText(next.join('\n'))});}} |
| C100 | frontend/src/components/OrderWorkView.jsx:2756 | `Button` variant="secondary" onClick={()=>{if(attachmentPreviewUrl){try{window.URL.revokeObjectURL(attachmentPreviewUrl);}catch{}}setAttachmentPreviewOpen(false);setAttachmentPreviewUrl('');setAttachmentPreviewName('');setAttachmentPreviewMime('');}} |
| C101 | frontend/src/components/TaskComments-modern.jsx:444 | `div` onClick={()=>{}} |
| C102 | frontend/src/components/TaskComments-modern.jsx:476 | `button` onClick={()=>handleReply(comment)} title="回覆" |
| C103 | frontend/src/components/TaskComments-modern.jsx:486 | `button` onClick={e=>{e.stopPropagation();setActiveMessageId(activeMessageId===comment.id?null:comment.id);}} |
| C104 | frontend/src/components/TaskComments-modern.jsx:505 | `button` onClick={()=>handlePin(comment)} |
| C105 | frontend/src/components/TaskComments-modern.jsx:512 | `button` onClick={()=>handleRetract(comment)} |
| C106 | frontend/src/components/TaskComments-modern.jsx:518 | `button` onClick={()=>handleDelete(comment)} |
| C107 | frontend/src/components/TaskComments-modern.jsx:539 | `div` onClick={()=>setIsMinimized(false)} |
| C108 | frontend/src/components/TaskComments-modern.jsx:577 | `button` onClick={()=>setIsMinimized(true)} |
| C109 | frontend/src/components/TaskComments-modern.jsx:582 | `button` onClick={()=>setMentionsOpen(!mentionsOpen)} |
| C110 | frontend/src/components/TaskComments-modern.jsx:609 | `button` onClick={()=>handlePin(pin)} title="取消置頂" |
| C111 | frontend/src/components/TaskComments-modern.jsx:667 | `button` onClick={()=>setReplyTo(null)} |
| C112 | frontend/src/components/TaskComments-modern.jsx:678 | `textarea` ref={textareaRef} value={newComment} onChange={handleInputChange} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit();}}} placeholder={replyTo?`回覆 ${replyTo.user_name}...`:"輸入訊息..."} rows={1} |
| C113 | frontend/src/components/TaskComments-modern.jsx:697 | `button` onClick={()=>setShowQuickReplies(!showQuickReplies)} title="快速回覆" |
| C114 | frontend/src/components/TaskComments-modern.jsx:706 | `button` onClick={()=>setPriority(priority==='urgent'?'normal':'urgent')} |
| C115 | frontend/src/components/TaskComments-modern.jsx:721 | `button` onClick={handleSubmit} disabled={!newComment.trim()} |
| C116 | frontend/src/components/TaskComments-modern.jsx:740 | `button` key={idx} onClick={()=>useQuickReply(reply)} |
| C117 | frontend/src/components/TaskComments-modern.jsx:755 | `button` key={user.id} onClick={()=>insertMention(user)} |
| C118 | frontend/src/components/TaskDashboard.jsx:193 | `input` type="checkbox" checked={selectedTasks.includes(task.id)} onChange={()=>toggleTaskSelection(task.id)} |
| C119 | frontend/src/components/TaskDashboard.jsx:242 | `button` onClick={e=>{e.stopPropagation();onTogglePin?.(task.id);}} |
| C120 | frontend/src/components/TaskDashboard.jsx:245 | `button` onClick={handleSetUrgent} |
| C121 | frontend/src/components/TaskDashboard.jsx:248 | `button` onClick={e=>{e.stopPropagation();onReportDefect(task);}} title="新品不良更換" |
| C122 | frontend/src/components/TaskDashboard.jsx:251 | `button` onClick={()=>onDelete(task.id,task.voucher_number)} |
| C123 | frontend/src/components/TaskDashboard.jsx:272 | `div` onClick={handleOpenChat} |
| C124 | frontend/src/components/TaskDashboard.jsx:323 | `div` onClick={handleOpenChat} |
| C125 | frontend/src/components/TaskDashboard.jsx:338 | `Button` variant="secondary" size="lg" onClick={()=>onViewOrder?.(task.id)} |
| C126 | frontend/src/components/TaskDashboard.jsx:349 | `Button` variant="secondary" size="lg" onClick={()=>onViewOrder?.(task.id)} |
| C127 | frontend/src/components/TaskDashboard.jsx:361 | `Button` variant="secondary" size="lg" onClick={()=>onViewOrder?.(task.id)} |
| C128 | frontend/src/components/TaskDashboard.jsx:371 | `Button` variant="primary" size="lg" onClick={()=>onClaim(task.id,isMyTask)} |
| C129 | frontend/src/components/TaskDashboard.jsx:383 | `Button` variant="primary" size="lg" onClick={()=>onClaim(task.id,true)} |
| C130 | frontend/src/components/TaskDashboard.jsx:394 | `Button` variant="primary" size="lg" onClick={()=>onClaim(task.id,false)} |
| C131 | frontend/src/components/TaskDashboard.jsx:1058 | `button` onClick={()=>setCurrentView('active')} |
| C132 | frontend/src/components/TaskDashboard.jsx:1064 | `button` onClick={()=>setCurrentView('completed')} |
| C133 | frontend/src/components/TaskDashboard.jsx:1076 | `input` type="date" value={completedDate} onChange={e=>setCompletedDate(e.target.value)} |
| C134 | frontend/src/components/TaskDashboard.jsx:1082 | `button` onClick={()=>setCompletedDate(getLocalISODate())} title="回到今天" |
| C135 | frontend/src/components/TaskDashboard.jsx:1096 | `Button` variant={batchMode?'primary':'secondary'} size="sm" onClick={toggleBatchMode} leadingIcon={ListChecks} |
| C136 | frontend/src/components/TaskDashboard.jsx:1108 | `Button` variant="primary" size="sm" onClick={handleBatchClaim} leadingIcon={CheckCircle2} |
| C137 | frontend/src/components/TaskDashboard.jsx:1115 | `button` onClick={toggleSound} title="音效開關" |
| C138 | frontend/src/components/TaskDashboard.jsx:1123 | `button` onClick={toggleVoice} title="語音播報" |
| C139 | frontend/src/components/TaskDashboard.jsx:1131 | `button` onClick={toggleNotification} title="桌面通知" |
| C140 | frontend/src/components/TaskDashboard.jsx:1152 | `FilterBar` value={search} onChange={setSearch} placeholder="搜尋單號、客戶名稱..." |
| C141 | frontend/src/components/TeamBoard.jsx:157 | `Button` variant="secondary" size="sm" onClick={onRefresh} leadingIcon={RefreshCw} disabled={refreshing} |
| C142 | frontend/src/components/TeamBoard.jsx:168 | `Button` size="sm" leadingIcon={Plus} onClick={()=>setShowCreate(v=>!v)} |
| C143 | frontend/src/components/TeamBoard.jsx:190 | `select` value={postType} onChange={e=>setPostType(e.target.value)} |
| C144 | frontend/src/components/TeamBoard.jsx:201 | `select` value={priority} onChange={e=>setPriority(e.target.value)} |
| C145 | frontend/src/components/TeamBoard.jsx:212 | `Input` label="標題" value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：今天要出貨：產品 XXX * 10，地址…" |
| C146 | frontend/src/components/TeamBoard.jsx:221 | `Input` label="截止時間（可選）" type="datetime-local" value={dueAtLocal} onChange={e=>setDueAtLocal(e.target.value)} |
| C147 | frontend/src/components/TeamBoard.jsx:232 | `select` multiple value={assigneeIds.map(String)} onChange={e=>{const selected=Array.from(e.target.options).filter(o=>o.selected).map(o=>parseInt(o.value,10)).filter(n=>Number.isFinite(n));setAssigneeIds(selected);}} disabled={usersLoading} |
| C148 | frontend/src/components/TeamBoard.jsx:256 | `textarea` value={content} onChange={e=>setContent(e.target.value)} placeholder="請輸入交辦內容與需求（產品、數量、地址、注意事項…）" |
| C149 | frontend/src/components/TeamBoard.jsx:266 | `Button` variant="secondary" onClick={()=>setShowCreate(false)} disabled={submitting} |
| C150 | frontend/src/components/TeamBoard.jsx:274 | `Button` onClick={submitCreate} disabled={submitting} |
| C151 | frontend/src/components/TeamBoard.jsx:310 | `Link` to={`/team/${p.id}`} |
| C152 | frontend/src/components/TeamPostView.jsx:223 | `Button` variant="secondary" size="sm" onClick={()=>changeStatus('open')} |
| C153 | frontend/src/components/TeamPostView.jsx:224 | `Button` variant="secondary" size="sm" onClick={()=>changeStatus('in_progress')} |
| C154 | frontend/src/components/TeamPostView.jsx:225 | `Button` variant="secondary" size="sm" onClick={()=>changeStatus('done')} |
| C155 | frontend/src/components/TeamPostView.jsx:226 | `Button` variant="secondary" size="sm" onClick={()=>changeStatus('closed')} |
| C156 | frontend/src/components/TeamPostView.jsx:267 | `Button` variant="secondary" size="sm" onClick={uploadAttachments} leadingIcon={Paperclip} disabled={uploading} |
| C157 | frontend/src/components/TeamPostView.jsx:293 | `Button` variant="secondary" size="sm" onClick={()=>previewAttachment(att)} disabled={downloadingId===att.id} |
| C158 | frontend/src/components/TeamPostView.jsx:302 | `Button` variant="secondary" size="sm" onClick={()=>downloadAttachment(att)} disabled={downloadingId===att.id} |
| C159 | frontend/src/components/TeamPostView.jsx:342 | `textarea` value={comment} onChange={e=>setComment(e.target.value)} placeholder="回報進度或補充資訊…" onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey\|\|e.ctrlKey)){e.preventDefault();sendComment();}}} |
| C160 | frontend/src/components/TeamPostView.jsx:355 | `Button` onClick={sendComment} disabled={sending} |
| C161 | frontend/src/components/admin/AdminDashboard.jsx:84 | `Link` to="/tasks" |
| C162 | frontend/src/components/admin/AdminDashboard.jsx:120 | `Link` to="/admin/analytics" |
| C163 | frontend/src/components/admin/AdminDashboard.jsx:145 | `div` onClick={()=>fileInputRef.current?.click()} onDrop={handleDrop} onDragOver={handleDragOver} |
| C164 | frontend/src/components/admin/AdminDashboard.jsx:155 | `input` type="file" ref={fileInputRef} onChange={handleExcelImport} accept=".xlsx, .xls" |
| C165 | frontend/src/components/admin/AdminDashboard.jsx:176 | `Link` to="/admin/defects" |
| C166 | frontend/src/components/admin/AdminDashboard.jsx:196 | `Link` to="/admin/scan-errors" |
| C167 | frontend/src/components/admin/AdminDashboard.jsx:216 | `Link` to="/admin/exceptions" |
| C168 | frontend/src/components/admin/AdminDashboard.jsx:236 | `Link` to="/admin/users" |
| C169 | frontend/src/components/admin/AdminDashboard.jsx:263 | `DatePicker` selectsRange startDate={startDate} endDate={endDate} onChange={update=>setDateRange(update)} isClearable dateFormat="yyyy/MM/dd" placeholderText="選擇起訖日期" |
| C170 | frontend/src/components/admin/AdminDashboard.jsx:274 | `Button` onClick={handleExportAdminReport} disabled={!startDate\|\|!endDate} variant="success" |
| C171 | frontend/src/components/admin/AdminDashboard.jsx:299 | `Link` to="/admin/operation-logs" |
| C172 | frontend/src/components/admin/AdminDashboard.jsx:317 | `Button` variant="ghost" onClick={()=>{const promise=apiClient.post('/api/admin/maintenance/retention/run',{});toast.promise(promise,{loading:'🧹 清理中...',success:'✅ 清理完成',error:'❌ 清理失敗'});}} |
| C173 | frontend/src/components/admin/Analytics.jsx:218 | `Link` to="/admin" |
| C174 | frontend/src/components/admin/Analytics.jsx:223 | `select` value={dateRange} onChange={e=>setDateRange(e.target.value)} |
| C175 | frontend/src/components/admin/DefectStats.jsx:85 | `Link` to="/admin" |
| C176 | frontend/src/components/admin/DefectStats.jsx:90 | `Button` onClick={handleExport} variant="primary" size="sm" |
| C177 | frontend/src/components/admin/Exceptions.jsx:58 | `Button` size="xs" variant="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(text);toast.success('已複製');}catch(e){toast.error('複製失敗');}}} |
| C178 | frontend/src/components/admin/Exceptions.jsx:307 | `Button` variant="secondary" onClick={fetchList} disabled={loading} |
| C179 | frontend/src/components/admin/Exceptions.jsx:322 | `Button` variant={tab==='open'?'primary':'secondary'} onClick={()=>setTab('open')} |
| C180 | frontend/src/components/admin/Exceptions.jsx:323 | `Button` variant={tab==='ack'?'primary':'secondary'} onClick={()=>setTab('ack')} |
| C181 | frontend/src/components/admin/Exceptions.jsx:324 | `Button` variant={tab==='resolved'?'primary':'secondary'} onClick={()=>setTab('resolved')} |
| C182 | frontend/src/components/admin/Exceptions.jsx:334 | `Input` label={null} name="q" value={q} onChange={e=>setQ(e.target.value)} placeholder="例如：A12345 或 1001" icon={Search} onKeyDown={e=>{if(e.key==='Enter')fetchList();}} |
| C183 | frontend/src/components/admin/Exceptions.jsx:345 | `Button` variant="primary" onClick={fetchList} disabled={loading} |
| C184 | frontend/src/components/admin/Exceptions.jsx:359 | `select` value={orderStatus} onChange={e=>setOrderStatus(e.target.value)} |
| C185 | frontend/src/components/admin/Exceptions.jsx:376 | `select` value={type} onChange={e=>setType(e.target.value)} |
| C186 | frontend/src/components/admin/Exceptions.jsx:393 | `select` value={createdBy} onChange={e=>setCreatedBy(e.target.value)} |
| C187 | frontend/src/components/admin/Exceptions.jsx:407 | `select` value={ackBy} onChange={e=>setAckBy(e.target.value)} |
| C188 | frontend/src/components/admin/Exceptions.jsx:421 | `select` value={resolvedBy} onChange={e=>setResolvedBy(e.target.value)} |
| C189 | frontend/src/components/admin/Exceptions.jsx:435 | `input` type="checkbox" checked={overdueOnly} onChange={e=>setOverdueOnly(e.target.checked)} |
| C190 | frontend/src/components/admin/Exceptions.jsx:446 | `Button` variant="secondary" onClick={()=>{setCreatedBy('');setAckBy('');setResolvedBy('');setType('');setOrderStatus('');setOverdueOnly(false);}} disabled={loading} |
| C191 | frontend/src/components/admin/Exceptions.jsx:456 | `Button` variant="primary" onClick={fetchList} disabled={loading} |
| C192 | frontend/src/components/admin/Exceptions.jsx:491 | `Link` to={`/order/${row.order_id}`} |
| C193 | frontend/src/components/admin/Exceptions.jsx:519 | `Button` size="sm" variant="secondary" onClick={()=>openDetail(row)} disabled={loading} |
| C194 | frontend/src/components/admin/Exceptions.jsx:523 | `Button` size="sm" onClick={()=>openDetail(row)} disabled={loading} |
| C195 | frontend/src/components/admin/Exceptions.jsx:528 | `Button` size="sm" onClick={()=>openDetail(row)} disabled={loading} |
| C196 | frontend/src/components/admin/Exceptions.jsx:564 | `Button` variant="secondary" onClick={closeDetail} |
| C197 | frontend/src/components/admin/Exceptions.jsx:566 | `Button` onClick={submitAck} |
| C198 | frontend/src/components/admin/Exceptions.jsx:571 | `Button` onClick={submitResolve} |
| C199 | frontend/src/components/admin/Exceptions.jsx:594 | `Link` to={`/order/${detailRow.order_id}`} |
| C200 | frontend/src/components/admin/Exceptions.jsx:654 | `textarea` value={ackNote} onChange={e=>setAckNote(e.target.value)} placeholder="例如：已確認缺貨，允許少出；或已確認破損，需換貨…" |
| C201 | frontend/src/components/admin/Exceptions.jsx:667 | `select` value={resolveAction} onChange={e=>setResolveAction(e.target.value)} |
| C202 | frontend/src/components/admin/Exceptions.jsx:681 | `textarea` value={resolveNote} onChange={e=>setResolveNote(e.target.value)} placeholder="例如：已補貨完成；已更換新品；已調整數量…" |
| C203 | frontend/src/components/admin/Exceptions.jsx:708 | `Button` size="sm" variant="secondary" onClick={()=>previewAttachment(detailRow,att)} |
| C204 | frontend/src/components/admin/Exceptions.jsx:711 | `Button` size="sm" variant="secondary" onClick={()=>downloadAttachment(detailRow,att)} |
| C205 | frontend/src/components/admin/Exceptions.jsx:736 | `Button` variant="secondary" onClick={()=>{if(attachmentPreviewUrl){try{window.URL.revokeObjectURL(attachmentPreviewUrl);}catch{}}setAttachmentPreviewOpen(false);setAttachmentPreviewUrl('');setAttachmentPreviewName('');setAttachmentPreviewMime('');}} |
| C206 | frontend/src/components/admin/OperationLogs.jsx:190 | `Link` to="/admin" |
| C207 | frontend/src/components/admin/OperationLogs.jsx:195 | `Button` onClick={fetchLogs} disabled={loading} variant="primary" size="sm" |
| C208 | frontend/src/components/admin/OperationLogs.jsx:244 | `input` type="text" placeholder="訂單編號" value={filters.orderId} onChange={e=>handleFilterChange('orderId',e.target.value)} |
| C209 | frontend/src/components/admin/OperationLogs.jsx:251 | `input` type="text" placeholder="使用者 ID" value={filters.userId} onChange={e=>handleFilterChange('userId',e.target.value)} |
| C210 | frontend/src/components/admin/OperationLogs.jsx:258 | `select` value={filters.actionType} onChange={e=>handleFilterChange('actionType',e.target.value)} |
| C211 | frontend/src/components/admin/OperationLogs.jsx:268 | `input` type="date" value={filters.startDate} onChange={e=>handleFilterChange('startDate',e.target.value)} |
| C212 | frontend/src/components/admin/OperationLogs.jsx:274 | `input` type="date" value={filters.endDate} onChange={e=>handleFilterChange('endDate',e.target.value)} |
| C213 | frontend/src/components/admin/OperationLogs.jsx:280 | `select` value={filters.limit} onChange={e=>handleFilterChange('limit',e.target.value)} |
| C214 | frontend/src/components/admin/OperationLogs.jsx:292 | `Button` variant="primary" size="sm" onClick={handleSearch} |
| C215 | frontend/src/components/admin/OperationLogs.jsx:295 | `Button` variant="secondary" size="sm" onClick={handleReset} |
| C216 | frontend/src/components/admin/OperationLogs.jsx:296 | `Button` variant="success" size="sm" onClick={handleExport} disabled={logs.length===0} |
| C217 | frontend/src/components/admin/ScanErrors.jsx:153 | `Link` to="/admin" |
| C218 | frontend/src/components/admin/ScanErrors.jsx:158 | `select` value={dateRange} onChange={e=>setDateRange(e.target.value)} |
| C219 | frontend/src/components/admin/ScanErrors.jsx:167 | `Button` variant="primary" size="sm" onClick={exportToCSV} |
| C220 | frontend/src/components/admin/ScanErrors.jsx:332 | `input` type="text" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="輸入關鍵字..." |
| C221 | frontend/src/components/admin/UserManagement.jsx:52 | `Button` variant="secondary" onClick={onClose} disabled={isSaving} |
| C222 | frontend/src/components/admin/UserManagement.jsx:53 | `Button` onClick={handleSubmit} disabled={isSaving} |
| C223 | frontend/src/components/admin/UserManagement.jsx:60 | `form` onSubmit={handleSubmit} |
| C224 | frontend/src/components/admin/UserManagement.jsx:61 | `Input` label="使用者名稱" name="username" value={formData.username} onChange={handleChange} placeholder="輸入使用者名稱" autoComplete="username" disabled={isEditMode} |
| C225 | frontend/src/components/admin/UserManagement.jsx:70 | `Input` label="姓名" name="name" value={formData.name} onChange={handleChange} placeholder="輸入姓名" autoComplete="name" |
| C226 | frontend/src/components/admin/UserManagement.jsx:78 | `Input` label="密碼" type="password" name="password" value={formData.password} onChange={handleChange} placeholder={isEditMode?'留空表示不變更':'設定密碼'} autoComplete="new-password" |
| C227 | frontend/src/components/admin/UserManagement.jsx:89 | `select` name="role" value={formData.role} onChange={handleChange} |
| C228 | frontend/src/components/admin/UserManagement.jsx:211 | `Link` to="/admin" |
| C229 | frontend/src/components/admin/UserManagement.jsx:216 | `Button` variant="primary" size="sm" onClick={()=>handleOpenModal()} |
| C230 | frontend/src/components/admin/UserManagement.jsx:248 | `Button` onClick={()=>handleOpenModal()} |
| C231 | frontend/src/components/admin/UserManagement.jsx:290 | `Button` variant="secondary" size="xs" onClick={()=>handleOpenModal(user)} |
| C232 | frontend/src/components/admin/UserManagement.jsx:293 | `Button` variant="danger" size="xs" onClick={()=>handleDeleteUser(user)} |
| C233 | frontend/src/ui/AppLayout.jsx:55 | `Button` variant="secondary" size="sm" onClick={onLogout} leadingIcon={LogOut} |
| C234 | frontend/src/ui/EmptyState.jsx:11 | `Button` onClick={onAction} |
| C235 | frontend/src/ui/FilterBar.jsx:11 | `input` value={value} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} |
| C236 | frontend/src/ui/Input.jsx:42 | `input` id={id\|\|name} name={name} type={type} value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onKeyDown={onKeyDown} disabled={disabled} required={required} autoFocus={autoFocus} |
| C237 | frontend/src/ui/Modal.jsx:11 | `div` onClick={onClose} |
| C238 | frontend/src/ui/Modal.jsx:16 | `button` onClick={onClose} |
| C239 | frontend/src/ui/Modal.jsx:27 | `Button` variant="secondary" onClick={onClose} |
