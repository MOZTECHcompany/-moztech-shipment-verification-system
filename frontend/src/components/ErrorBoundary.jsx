import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600">
                    <h3 className="font-bold mb-1">組件發生錯誤</h3>
                    <p className="text-sm">{this.state.error?.message}</p>
                </div>
            );
        }

        return this.props.children; 
    }
}

export default ErrorBoundary;
