import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import voiceNotification, { voiceId } from '../utils/voiceNotification';

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
                        {settings.voices.map(voice => <option key={voiceId(voice)} value={voiceId(voice)}>{voice.name} · {voice.lang}</option>)}
                    </select>
                </label>
                <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-xs text-slate-500">{settings[type].voice?.name || '系統中文語音'}</span>
                    <button type="button" disabled={!settings.supported} onClick={() => { if (!voiceNotification.preview(type)) toast.info('目前無法播報，請檢查裝置音量與中文語音。'); }} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-blue-700">試聽{label}</button>
                </div>
            </div>;
        })}
        <p className="text-xs leading-5 text-slate-500">{!settings.supported ? '此瀏覽器不支援語音播報。' : settings.sameVoice ? '目前使用同一中文語音，揀貨提高音調、裝箱降低音調。可在裝置安裝其他中文語音後選擇。' : '語音依裝置提供，請先試聽確認男女聲。設定套用於此瀏覽器。'}</p>
    </div>;
    return compact ? <details className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><summary className="min-h-8 cursor-pointer text-sm text-slate-600">語音播報：{settings.enabled ? '已開啟' : '已關閉'}</summary>{controls}</details>
        : <section aria-label="揀貨與裝箱語音" className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">揀貨與裝箱語音</h2>{controls}</section>;
}
