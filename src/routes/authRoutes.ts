import { Router } from 'express';
import { getAblyToken } from '../controllers/authController';

const router = Router();

router.get('/ably-token', getAblyToken);

export default router;
