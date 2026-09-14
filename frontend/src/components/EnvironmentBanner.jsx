import React, { useEffect } from 'react';
import { applyDeploymentTitle, isDevDeployment } from '../utils/deploymentEnvironment';

const isDev = isDevDeployment(import.meta.env.VITE_DEPLOY_ENV);

export function EnvironmentBanner({ className = '' }) {
    useEffect(() => applyDeploymentTitle(document, isDev), []);
    if (!isDev) return null;
    return <div data-testid="deployment-environment" role="note" aria-label="DEV 測試環境" className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 print:hidden ${className}`}>
        <strong className="rounded bg-amber-950 px-2 py-0.5 font-mono text-xs tracking-wide text-amber-50">DEV</strong>
        <span className="font-medium">測試站 · 合成資料</span>
    </div>;
}
