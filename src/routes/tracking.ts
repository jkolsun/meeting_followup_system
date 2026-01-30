import { Router, Request, Response } from 'express';
import { markEmailOpened } from '../db/repositories';

const router = Router();

// 1x1 transparent PNG pixel
const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// Track email open - returns a 1x1 transparent pixel
router.get('/track/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    // Mark email as opened (only first open is recorded)
    await markEmailOpened(token);

    // Return 1x1 transparent PNG
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': TRACKING_PIXEL.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    return res.send(TRACKING_PIXEL);
  } catch (error) {
    // Still return the pixel even if tracking fails
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': TRACKING_PIXEL.length,
    });
    return res.send(TRACKING_PIXEL);
  }
});

export default router;
