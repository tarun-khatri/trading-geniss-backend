import { Router } from 'express';
import { openPosition, closePosition, getAccountState } from '../controllers/tradeController';

const router = Router();

router.post('/open', openPosition);
router.post('/close', closePosition);
router.post('/monitor', getAccountState);

export default router;
