import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import apiClient from '../api/api';
import { taiwanWorkDate, workModeStorageKey, workTypesFor } from '../utils/workCapabilities';

const fallback = { stage: null, workTypes: [], loading: false, choosing: false, error: '', assignment: null, recommendedStage: null, selectStage: async () => false, reload: async () => {} };
const WorkModeContext = createContext(fallback);
export const useWorkMode = () => useContext(WorkModeContext);

const readStage = (userId, date) => {
    try { return sessionStorage.getItem(workModeStorageKey(userId, date)); } catch { return null; }
};

export function WorkModeProvider({ user, children }) {
    const [state, setState] = useState({ ...fallback, workTypes: workTypesFor(user), loading: !!user });
    const owner = useRef(user?.id);
    const sequence = useRef(0);
    const selection = useRef(false);
    const alive = useRef(true);
    owner.current = user?.id;
    const reload = useCallback(async () => {
        const userId = user?.id;
        const request = ++sequence.current;
        const types = workTypesFor(user);
        if (!userId || !types.length) {
            setState({ ...fallback, workTypes: types });
            return;
        }
        setState(previous => ({ ...previous, loading: true, error: '' }));
        try {
            const { data } = await apiClient.get('/api/warehouse/work-mode', { timeout: 15000 });
            if (!alive.current || request !== sequence.current || owner.current !== userId) return;
            const workTypes = Array.isArray(data.work_types) ? data.work_types.filter(type => ['pick', 'pack'].includes(type)) : types;
            const date = data.work_date || taiwanWorkDate();
            const cached = readStage(userId, date);
            setState(previous => ({ ...previous, workTypes, workDate: date, stage: workTypes.includes(cached) ? cached : null,
                loading: false, error: '', assignment: data.today_assignment || null,
                recommendedStage: workTypes.includes(data.today_assignment?.stage) ? data.today_assignment.stage
                    : workTypes.includes(data.choice_stage) ? data.choice_stage : workTypes.includes(data.default_stage) ? data.default_stage : workTypes[0] }));
        } catch (error) {
            if (!alive.current || request !== sequence.current || owner.current !== userId) return;
            setState(previous => ({ ...previous, workTypes: types, loading: false, error: error.response?.data?.message || '暫時無法取得今日作業，請重試。' }));
        }
    }, [user?.id, JSON.stringify(workTypesFor(user))]);
    useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; sequence.current++; }; }, [reload]);

    const selectStage = useCallback(async stage => {
        if (selection.current || state.loading || !state.workTypes.includes(stage)) return false;
        const userId = user?.id;
        const request = sequence.current;
        selection.current = true;
        setState(previous => ({ ...previous, choosing: true, error: '' }));
        try {
            const { data } = await apiClient.put('/api/warehouse/work-mode', { stage }, { timeout: 15000 });
            if (!alive.current || request !== sequence.current || owner.current !== userId) return false;
            const date = data.work_date || state.workDate || taiwanWorkDate();
            try { sessionStorage.setItem(workModeStorageKey(userId, date), stage); } catch { /* The selected stage still works in this tab. */ }
            setState(previous => ({ ...previous, stage, workDate: date, choosing: false, error: '' }));
            return true;
        } catch (error) {
            if (alive.current && request === sequence.current && owner.current === userId) setState(previous => ({ ...previous, choosing: false, error: error.response?.data?.message || '切換未確認，請重試後再開始作業。' }));
            return false;
        } finally { selection.current = false; }
    }, [user?.id, state.loading, state.workTypes, state.workDate]);
    return <WorkModeContext.Provider value={{ ...state, selectStage, reload }}>{children}</WorkModeContext.Provider>;
}
