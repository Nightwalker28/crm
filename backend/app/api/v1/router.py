from fastapi import APIRouter

from app.modules.finance.routes.io_search_routes import router as io_search_router
from app.modules.platform.routes.activity_logs import router as activity_log_router
from app.modules.platform.routes.custom_fields import router as custom_fields_router, public_router as public_custom_fields_router
from app.modules.platform.routes.recycle_bin import router as recycle_bin_router
from app.modules.user_management.routes.signin import router as signin_router
from app.modules.user_management.routes.profile import router as profile_router
from app.modules.user_management.routes.admin import router as admin_user_router
from app.modules.sales.routes.contacts_routes import router as sales_contacts_router
from app.modules.sales.routes.organizations_routes import router as sales_organization_router
from app.modules.sales.routes.opportunities_routes import router as sales_opportunities_router


router = APIRouter(prefix="/api/v1")

router.include_router(signin_router, prefix="/auth")
router.include_router(profile_router, prefix="/users")
router.include_router(admin_user_router)
router.include_router(activity_log_router)
router.include_router(custom_fields_router)
router.include_router(public_custom_fields_router)
router.include_router(recycle_bin_router)
router.include_router(io_search_router,  prefix="/finance",)
router.include_router(sales_contacts_router, prefix="/sales")
router.include_router(sales_organization_router, prefix="/sales")
router.include_router(sales_opportunities_router, prefix="/sales")
