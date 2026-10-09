from fastapi import APIRouter

from app.modules.finance.routes.credit_payment_routes import router as credit_payment_router
from app.modules.finance.routes.pos_invoice_routes import router as pos_invoice_router
from app.modules.finance.routes.receivables_routes import router as receivables_router
from app.modules.finance.routes.tax_rate_routes import router as tax_rate_router


router = APIRouter(prefix="/finance")
router.include_router(pos_invoice_router)
router.include_router(credit_payment_router)
router.include_router(tax_rate_router)
router.include_router(receivables_router)
