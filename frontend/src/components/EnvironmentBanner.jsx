import React, { useEffect } from 'react';
import { applyDeploymentTitle, isDevDeployment } from '../utils/deploymentEnvironment';

const isDev = isDevDeployment(import.meta.env.VITE_DEPLOY_ENV);

export function EnvironmentBanner({ className = '' }) {
    useEffect(() => applyDeploymentTitle(document, isDev), []);
    if (!isDev) return null;
    return <div data-testid="deployment-environment" role="note" aria-label="DEV 開發環境" className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-600 print:hidden ${className}`}>
        <strong className="rounded bg-slate-700 px-2 py-0.5 font-mono text-xs tracking-wide text-white">DEV</strong>
        <span className="font-medium">開發環境</span>
    </div>;
}
