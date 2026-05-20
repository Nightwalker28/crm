from fastapi import APIRouter

from app.modules.finance.routes.io_search_routes import router as io_search_router
from app.modules.finance.routes.pos_invoice_routes import router as pos_invoice_router


router = APIRouter(prefix="/finance")
router.include_router(io_search_router)
router.include_router(pos_invoice_router)
