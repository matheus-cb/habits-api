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
/**
 * @swagger
 * /habits/{id}:
 *   delete:
 *     summary: Apaga o hábito LOGICAMENTE, junto dos check-ins ativos dele
 *     description: >
 *       Reversível por POST /habits/{id}/restore. O delete físico não existe por
 *       HTTP — é o script `npm run purge`, deliberadamente fora desta superfície.
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Apagado logicamente
 */
router.delete('/:id', validateParams(habitIdSchema), habitsController.delete);

/**
 * @swagger
 * /habits/{id}/restore:
 *   post:
 *     summary: Restaura hábito apagado logicamente
 *     description: >
 *       Devolve o hábito e apenas os check-ins do lote apagado com ele — os que
 *       a pessoa havia desfeito antes permanecem desfeitos.
 *     tags: [Habits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Restaurado
 *       409:
 *         description: O hábito não está apagado
 */
router.post('/:id/restore', validateParams(habitIdSchema), habitsController.restore);

export default router;
