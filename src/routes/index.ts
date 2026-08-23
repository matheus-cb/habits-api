import { Router } from 'express';
import authRoutes from './auth.routes';
import habitsRoutes from './habits.routes';
import checkinsRoutes from './checkins.routes';
import insightsRoutes from './insights.routes';
import assistantRoutes from './assistant.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/habits', habitsRoutes);
router.use('/insights', insightsRoutes);
router.use('/assistant', assistantRoutes);
router.use('/', checkinsRoutes); // Checkins routes start with /habits/:habitId

export default router;
