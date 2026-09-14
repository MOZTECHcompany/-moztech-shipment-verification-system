import React, { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import soundNotification, { SOUND_PROFILES } from '../utils/soundNotification';

export function PersonalSoundControls({ user, compact = false }) {
    const [settings, setSettings] = useState(() => soundNotification.getSettings(user?.id));
    useEffect(() => {
        const refresh = () => setSettings(soundNotification.getSettings(user?.id));
        refresh();
        return soundNotification.subscribe(refresh);
    }, [user?.id]);
    const update = (method, value) => {
        try { soundNotification.setUser(user?.id); soundNotification[method](value); }
        catch { toast.error('無法儲存音效設定，請檢查瀏覽器設定。'); }
    };
    const preview = async motif => {
        soundNotification.setUser(user?.id);
        if (!await soundNotification.preview(motif)) toast.info('目前無法播放，請確認音量與瀏覽器音訊設定。');
    };
    const controls = <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{user?.name || '我'}的掃碼音效</span>
            <button type="button" role="switch" aria-label="掃碼音效" aria-checked={settings.enabled} onClick={() => update('setEnabled', !settings.enabled)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">{settings.enabled ? '已開啟' : '已關閉'}</button>
        </div>
        <label className="block text-sm text-slate-700">我的音色
            <select aria-label="我的音色" value={settings.profile} onChange={event => update('setProfile', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900">
                {SOUND_PROFILES.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-700">音量
            <input aria-label="掃碼音量" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={event => update('setVolume', event.target.value)} className="min-h-11 min-w-0 flex-1 accent-blue-600" />
            <span className="w-10 text-right tabular-nums">{Math.round(settings.volume * 100)}%</span>
        </label>
        <div className="flex flex-wrap gap-2">{[['pickSuccess', '揀貨'], ['packSuccess', '裝箱'], ['error', '錯誤']].map(([motif, label]) => <button key={motif} type="button" onClick={() => preview(motif)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-blue-50">試聽{label}</button>)}</div>
        <p className="text-xs text-slate-500">此帳號在這台瀏覽器記住音色；同場人員可選不同音色。</p>
    </div>;
    const profile = SOUND_PROFILES.find(item => item.id === settings.profile);
    return compact ? <details className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <summary className="min-h-8 cursor-pointer text-sm text-slate-600">我的音效：{settings.enabled ? profile?.label : '已關閉'}</summary>
        {controls}
    </details> : <section aria-label="個人掃碼音效" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Volume2 size={19} />個人掃碼音效</h2>
        {controls}
    </section>;
}
