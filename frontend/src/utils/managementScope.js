export const isOrderManager = user => user?.role === 'admin' && user.management_scope === 'orders';
export const isWarehouseAdmin = user => user?.role === 'superadmin' || (user?.role === 'admin' && !isOrderManager(user));
export const managementRoleLabel = user => user?.role === 'admin'
    ? ({orders:'訂單管理員',warehouse:'倉儲管理員',all:'管理員'}[user.management_scope || 'all'])
    : ({superadmin:'系統管理員',dispatcher:'拋單員',picker:'揀貨員',packer:'裝箱員'}[user?.role] || '作業人員');
