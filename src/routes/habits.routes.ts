import { Router } from 'express';
import { HabitsController } from '@/controllers/habits.controller';
import { validateBody, validateParams } from '@/middlewares/validation.middleware';
import { authenticate } from '@/middlewares/auth.middleware';
import { createHabitSchema, updateHabitSchema, habitIdSchema } from '@/schemas/habits.schema';

const router = Router();
const habitsController = new HabitsController();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /habits:
 *   get:
 *     summary: Get all habits for current user
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of habits
 */
router.get('/', habitsController.getAll);

/**
 * @swagger
 * /habits:
 *   post:
 *     summary: Create a new habit
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Habit created successfully
 */
router.post('/', validateBody(createHabitSchema), habitsController.create);

/**
 * @swagger
 * /habits/{id}:
 *   get:
 *     summary: Get habit by ID
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Habit details
 */
router.get('/:id', validateParams(habitIdSchema), habitsController.getById);

/**
 * @swagger
 * /habits/{id}:
 *   put:
 *     summary: Update habit
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Habit updated successfully
 */
router.put(
  '/:id',
  validateParams(habitIdSchema),
  validateBody(updateHabitSchema),
  habitsController.update
);

/**
 * @swagger
 * /habits/{id}:
 *   delete:
 *     summary: Delete habit
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Habit deleted successfully
 */
router.delete('/:id', validateParams(habitIdSchema), habitsController.delete);

export default router;
