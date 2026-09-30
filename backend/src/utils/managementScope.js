const isOrderManager = user => user?.role === 'admin' && user.management_scope === 'orders';
const isWarehouseAdmin = user => user?.role === 'superadmin' || (user?.role === 'admin' && !isOrderManager(user));
function warehouseOnly(req,res,next) {
    if (isOrderManager(req.user)) return res.status(403).json({message:'訂單管理員可提出異動；倉儲作業與審核由倉儲管理員負責'});
    next();
}
module.exports = {isOrderManager,isWarehouseAdmin,warehouseOnly};
