import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error('WMS view error', error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
                    <h2 className="font-semibold">此區塊暫時無法顯示</h2>
                    <p className="mt-2 text-sm">請重新載入頁面。若剛送出掃碼或變更，請先核對訂單結果，再決定是否重新操作。</p>
                    <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-[44px] rounded-lg border border-amber-300 bg-white px-4 text-sm font-medium">重新載入頁面</button>
                </div>
            );
        }
        return this.props.children;
    }
}
export default ErrorBoundary;
