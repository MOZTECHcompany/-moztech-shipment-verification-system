const fetchTasks = useCallback(async () => {
    if (user) { 
        try {
            setLoading(true);
            const response = await apiClient.get('/api/tasks');
            setTasks(response.data);
        } catch (error) {
            if (error.response?.status !== 401) {
                toast.error('載入任務失敗', { description: error.response?.data?.message || '請稍後再試' });
            }
        } finally {
            setLoading(false);
        }
    }
}, [user]);

useEffect(() => {
    fetchTasks();
}, [fetchTasks]);

useEffect(() => {
    const handleNewTask = (newTask) => {
        toast.info(`收到新任務: ${newTask.voucher_number}`);
        setTasks(currentTasks => 
            currentTasks.some(task => task.id === newTask.id) ? currentTasks : [...currentTasks, newTask]
        );
    };
    
    const handleTaskUpdate = (updatedTask) => {
         setTasks(currentTasks => {
            const index = currentTasks.findIndex(t => t.id === updatedTask.id);
            if (index === -1) {
                if ((user.role === 'picker' || user.role === 'admin') && updatedTask.task_type === 'pick') return [...currentTasks, updatedTask];
                if ((user.role === 'packer' || user.role === 'admin') && updatedTask.task_type === 'pack') return [...currentTasks, updatedTask];
                return currentTasks;
            }
            
            if (
                (updatedTask.status === 'picked' && user.role === 'picker') ||
                (updatedTask.status === 'completed') || 
                (updatedTask.status === 'voided')
            ) {
                return currentTasks.filter(t => t.id !== updatedTask.id);
            }
            
            const newTasks = [...currentTasks];
            newTasks[index] = updatedTask;
            return newTasks;
        });
    };

    // ✅ 2. 新增 Socket.IO 刪除事件監聽
    const handleTaskDeleted = ({ orderId }) => {
        toast.warning(`訂單已被管理員刪除`);
        setTasks(prevTasks => prevTasks.filter(task => task.id !== orderId));
    };

    socket.on('new_task', handleNewTask);
    socket.on('task_claimed', handleTaskUpdate);
    socket.on('task_status_changed', handleTaskUpdate);
    socket.on('task_deleted', handleTaskDeleted);
    
    return () => {
        socket.off('new_task', handleNewTask);
        socket.off('task_claimed', handleTaskUpdate);
        socket.off('task_status_changed', handleTaskUpdate);
        socket.off('task_deleted', handleTaskDeleted);
    };
}, [user]);

const handleClaimTask = async (orderId, isContinue) => {
    if (isContinue) {
        navigate(`/order/${orderId}`);
        return;
    }
    const promise = apiClient.post(`/api/orders/${orderId}/claim`);
    toast.promise(promise, {
        loading: '正在認領任務...',
        success: () => '任務認領成功！',
        error: (err) => err.response?.data?.message || '認領失敗',
    });
};

// ✅ 4. 新增刪除訂單的處理函式
const handleDeleteOrder = (orderId, voucherNumber) => {
    MySwal.fire({
        title: `確定要永久刪除訂單 ${voucherNumber}？`,
        text: "此操作將會刪除所有相關資料，且無法復原！",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '確認刪除',
        cancelButtonText: '取消',
        customClass: {
            title: 'text-xl',
            htmlContainer: 'text-base'
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const promise = apiClient.delete(`/api/orders/${orderId}`);

            toast.promise(promise, {
                loading: `正在刪除訂單 ${voucherNumber}...`,
                success: (res) => {
                    // 即使有 socket 事件，立即更新 UI 可提供更好的使用者體驗
                    setTasks(prevTasks => prevTasks.filter(task => task.id !== orderId));
                    return res.data.message;
                },
                error: (err) => err.response?.data?.message || '刪除失敗'
            });
        }
    });
};

const pickTasks = tasks.filter(t => t.task_type === 'pick');
const packTasks = tasks.filter(t => t.task_type === 'pack');

if (loading) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-primary" size={48} /></div>;
}

return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-4xl font-bold text-gray-800">我的任務</h1>
                <p className="text-secondary-foreground mt-1">選擇一項任務以開始作業</p>
            </div>
            {user && user.role === 'admin' && (
                <Link to="/admin" className="flex items-center px-4 py-2 bg-gray-800 text-white font-semibold rounded-lg hover:bg-gray-900 transition-colors shadow-sm">
                    <LayoutDashboard className="mr-2 h-5 w-5" />
                    管理中心
                </Link>
            )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section>
                <h2 className="text-2xl font-semibold text-gray-700 flex items-center px-2 mb-4"><Package className="mr-3 text-gray-400" /> 待揀貨任務 <span className="ml-2 text-lg font-medium text-gray-500">{pickTasks.length}</span></h2>
                <div className="space-y-4">
                    {pickTasks.length > 0 ? (
                        pickTasks.map(task => <TaskCard key={task.id} task={task} onClaim={handleClaimTask} user={user} onDelete={handleDeleteOrder} />)
                    ) : (
                        <div className="text-center text-gray-500 p-8 bg-card rounded-xl border-2 border-dashed">目前沒有待處理的揀貨任務。</div>
                    )}
                </div>
            </section>

            <section>
                <h2 className="text-2xl font-semibold text-gray-700 flex items-center px-2 mb-4"><Box className="mr-3 text-gray-400" /> 待裝箱任務 <span className="ml-2 text-lg font-medium text-gray-500">{packTasks.length}</span></h2>
                <div className="space-y-4">
                    {packTasks.length > 0 ? (
                        packTasks.map(task => <TaskCard key={task.id} task={task} onClaim={handleClaimTask} user={user} onDelete={handleDeleteOrder} />)
                    ) : (
                        <div className="text-center text-gray-500 p-8 bg-card rounded-xl border-2 border-dashed">目前沒有待處理的裝箱任務。</div>
                    )}
                </div>
            </section>
        </div>

         {tasks.length === 0 && !loading && (
             <div className="text-center py-24 text-gray-500 col-span-1 lg:col-span-2">
                <ServerOff size={56} className="mx-auto mb-4 text-gray-400" />
                <h3 className="text-2xl font-semibold">太棒了！</h3>
                <p>所有任務都已完成。</p>
            </div>
         )}
    </div>
);