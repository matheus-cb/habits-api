import { Router } from 'express';
import { z } from 'zod';
import { CheckinsController } from '@/controllers/checkins.controller';
import { validateBody, validateParams, validateQuery } from '@/middlewares/validation.middleware';
import { authenticate } from '@/middlewares/auth.middleware';
import { createCheckinSchema, checkinParamSchema, checkinDateRangeSchema } from '@/schemas/checkins.schema';

const habitIdParamSchema = z.object({
  habitId: z.string().uuid('Invalid habit ID'),
});

const router = Router();
const checkinsController = new CheckinsController();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /habits/{habitId}/checkin:
 *   post:
 *     summary: Create a check-in for a habit
 *     tags: [Checkins]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: habitId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Check-in created successfully
 */
router.post(
  '/habits/:habitId/checkin',
  validateParams(habitIdParamSchema),
  validateBody(createCheckinSchema),
  checkinsController.create
);

/**
 * @swagger
 * /habits/{habitId}/checkins:
 *   get:
 *     summary: Get all check-ins for a habit
 *     tags: [Checkins]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: habitId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of check-ins
 */
router.get(
  '/habits/:habitId/checkins',
  validateParams(habitIdParamSchema),
  validateQuery(checkinDateRangeSchema),
  checkinsController.getByHabit
);

/**
 * @swagger
 * /habits/{habitId}/stats:
 *   get:
 *     summary: Get statistics for a habit
 *     tags: [Checkins]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: habitId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Habit statistics
 */
router.get(
  '/habits/:habitId/stats',
  validateParams(habitIdParamSchema),
  checkinsController.getStats
);

/**
 * @swagger
 * /habits/{habitId}/checkins/{id}:
 *   delete:
 *     summary: Delete a check-in (undo)
 *     tags: [Checkins]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: habitId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Check-in deleted successfully
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Habit or check-in not found
 */
router.delete(
  '/habits/:habitId/checkins/:id',
  validateParams(checkinParamSchema),
  checkinsController.delete
);

export default router;
