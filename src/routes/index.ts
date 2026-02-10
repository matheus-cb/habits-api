import { Router } from 'express';
import authRoutes from './auth.routes';
import habitsRoutes from './habits.routes';
import checkinsRoutes from './checkins.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/habits', habitsRoutes);
router.use('/', checkinsRoutes); // Checkins routes start with /habits/:habitId

export default router;
