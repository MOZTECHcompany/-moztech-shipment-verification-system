import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import voiceNotification, { voiceId, reportedVoice } from '../utils/voiceNotification';

export function VoiceControls({ compact = false }) {
    const [settings, setSettings] = useState(() => voiceNotification.getStageSettings());
    useEffect(() => {
        const refresh = () => setSettings(voiceNotification.getStageSettings());
        refresh();
        return voiceNotification.subscribe(refresh);
    }, []);
    const update = callback => { try { callback(); } catch { toast.error('無法儲存語音設定，請檢查瀏覽器設定。'); } };
    const controls = <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3 text-sm"><span>語音播報</span>
            <button type="button" role="switch" aria-label="語音播報" aria-checked={settings.enabled} disabled={!settings.supported} onClick={() => update(() => voiceNotification.setEnabled(!settings.enabled))} className="min-h-11 rounded-lg border border-slate-200 px-3 disabled:opacity-40">{settings.enabled ? '已開啟' : '已關閉'}</button>
        </div>
        {['pick', 'pack'].map(type => {
            const label = type === 'pick' ? '揀貨' : '裝箱';
            const missing = settings.selected[type] !== 'auto' && !settings.voices.some(voice => voiceId(voice) === settings.selected[type]);
            return <div key={type} className="space-y-1">
                <label className="block text-sm text-slate-700">{label}語音
                    <select aria-label={`${label}語音`} disabled={!settings.supported} value={settings.selected[type]} onChange={event => update(() => voiceNotification.setStageVoice(type, event.target.value))} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-slate-900">
                        <option value="auto">自動（{type === 'pick' ? '女聲' : '男聲'}優先）</option>
                        {missing && <option value={settings.selected[type]}>原語音暫不可用（暫用自動）</option>}
                        {settings.voices.map(voice => <option key={voiceId(voice)} value={voiceId(voice)}>{voice.name} · {voice.lang}{reportedVoice(voice) ? '（發音待確認）' : ''}</option>)}
                    </select>
                </label>
                <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-xs text-slate-500">{settings[type].voice?.name || (settings.voices.length ? '請選擇語音並試聽' : '沒有可用的中文語音')}</span>
                    <button type="button" disabled={!settings.supported || !settings[type].voice} onClick={() => { if (!voiceNotification.preview(type)) toast.info('目前無法播報，請檢查裝置音量與中文語音。'); }} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-blue-700 disabled:opacity-40">試聽{label}</button>
                </div>
                {reportedVoice(settings[type].voice) && <p className="text-xs text-amber-700">此音色曾回報發音問題，請先試聽。</p>}
            </div>;
        })}
        <p className="text-xs leading-5 text-slate-500">{!settings.supported ? '此瀏覽器不支援語音播報。' : !settings.voices.length ? '請在裝置安裝中文語音後重新整理。目前可用個人掃碼音效提示。' : settings.sameVoice ? '目前兩階段使用同一語音，可分別選擇不同音色並試聽。' : '揀貨與裝箱可分別選擇音色，請試聽確認。設定套用於此瀏覽器。'}</p>
    </div>;
    return compact ? <details className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><summary className="min-h-8 cursor-pointer text-sm text-slate-600">語音播報：{settings.enabled ? settings.pick.voice && settings.pack.voice ? '已開啟' : '請選擇中文語音' : '已關閉'}</summary>{controls}</details>
        : <section aria-label="揀貨與裝箱語音" className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">揀貨與裝箱語音</h2>{controls}</section>;
}
