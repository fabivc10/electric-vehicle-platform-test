import { Router } from 'express';
import { z } from 'zod';
import type { ChargingService } from '../../core/services/ChargingService.js';

const Query = z.object({
  chargePointId: z.string().optional(),
  state: z.enum(['active', 'completed']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const transactionsRouter = (charging: ChargingService) => {
  const router = Router();
  router.get('/', async (req, res) => {
    res.json(await charging.findTransactions(Query.parse(req.query)));
  });
  return router;
};
