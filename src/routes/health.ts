import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true, version: '1.0.0', ts: new Date().toISOString() });
});

export default router;
