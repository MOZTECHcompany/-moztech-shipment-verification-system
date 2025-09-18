// frontend/src/components/TaskDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { ListTodo, Package, Box, User, Clock, Loader2, ServerOff, LayoutDashboard } from 'lucide-react';

const statusMap = {
    pending: { text: '待揀貨', color: 'bg-yellow-500' },
    picking: { text: '揀貨中', color: 'bg-blue-500 animate-pulse' },
    picked: { text: '待裝箱', color: 'bg-indigo-500' },
    packing: { text: '裝箱中', color: 'bg-cyan-500 animate-pulse' },
};

const TaskCard = ({ task, onClaim }) => {
    const isMyTask = task.current_user;
    const statusInfo = statusMap[task.status] || { text: task.status, color: 'bg-gray-400' };

    return (
        <div className={`bg-white p-5 rounded-lg shadow-md border-l-4 ${isMyTask ? 'border-green-500' : 'border-gray-300'}`}>
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-lg text-gray-800">{task.voucher_number}</h3>
                <span className={`px-2 py-1 text-xs font-semibold text-white rounded-full ${statusInfo.color}`}>
                    {statusInfo.text}
                </span>
            </div>
            <p className="text-gray-600 mt-1 flex items-center"><User size={14} className="mr-2" />客戶: {task.customer_name}</p>
            {task.task_type === 'pack' && (
                <p className="text-sm text-gray-500 mt-1">由 <span className="font-semibold">{task.picker_name || '未知人員'}</span> 完成揀貨</p>
            )}
            {isMyTask ? (
                <div className="mt-4 flex justify-between items-center bg-green-50 p-2 rounded-md">
                     <p className="text-sm text-green-700 font-semibold">您正在處理此任務</p>
                     <button onClick={() => onClaim(task.id, true)} className="px-4 py-1 bg-green-600 text-white rounded-md hover:bg-green-700">繼續作業</button>
                </div>
            ) : (
                <button onClick={() => onClaim(task.id, false)} className="mt-4 w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
                    {task.task_type === 'pick' ? '開始揀貨' : '開始裝箱'}
                </button>
            )}
        </div>
    );
};

export function TaskDashboard({ user }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchTasks = async () => {
            try {
                setLoading(true);
                const response = await apiClient.get('/api/tasks');
                setTasks(response.data);
            } catch (error) {
                toast.error('載入任務失敗', { description: error.response?.data?.message || '請稍後再試' });
            } finally {
                setLoading(false);
            }
        };
        fetchTasks();
    }, []);

    const handleClaimTask = async (orderId, isContinue) => {
        if(isContinue){
            navigate(`/order/${orderId}`);
            return;
        }
        
        const promise = apiClient.post(`/api/orders/${orderId}/claim`);
        toast.promise(promise, {
            loading: '正在認領任務...',
            success: (response) => {
                navigate(`/order/${orderId}`);
                return '任務認領成功，開始作業！';
            },
            error: (err) => err.response?.data?.message || '認領失敗',
        });
    };
    
    const pickTasks = tasks.filter(t => t.task_type === 'pick');
    const packTasks = tasks.filter(t => t.task_type === 'pack');

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-blue-500" size={48} /></div>;
    }

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">我的任務</h1>
                {/* 【关键修改】只有管理员才能看到这个按钮 */}
                {user && user.role === 'admin' && (
                    <Link 
                        to="/admin" 
                        className="flex items-center px-4 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
                    >
                        <LayoutDashboard className="mr-2" />
                        管理員儀表板
                    </Link>
                )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><Package className="mr-2" /> 待揀貨任務 ({pickTasks.length})</h2>
                    <div className="space-y-4">
                        {pickTasks.length > 0 ? (
                            pickTasks.map(task => <TaskCard key={task.id} task={task} onClaim={handleClaimTask} />)
                        ) : (
                            <div className="text-gray-500 p-4 bg-white rounded-lg shadow-sm">目前沒有待處理的揀貨任務。</div>
                        )}
                    </div>
                </div>

                <div>
                    <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><Box className="mr-2" /> 待裝箱任務 ({packTasks.length})</h2>
                    <div className="space-y-4">
                        {packTasks.length > 0 ? (
                            packTasks.map(task => <TaskCard key={task.id} task={task} onClaim={handleClaimTask} />)
                        ) : (
                            <div className="text-gray-500 p-4 bg-white rounded-lg shadow-sm">目前沒有待處理的裝箱任務。</div>
                        )}
                    </div>
                </div>
            </div>
             {tasks.length === 0 && !loading && (
                 <div className="text-center py-16 text-gray-500">
                    <ServerOff size={48} className="mx-auto mb-4" />
                    <h3 className="text-xl font-semibold">太棒了！</h3>
                    <p>所有任務都已完成。</p>
                </div>
             )}
        </div>
    );
}