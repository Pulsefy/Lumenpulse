import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY_TTL_HOURS = 24;

export const idempotency = async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return next();
  }

  try {
    const existingRecord = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existingRecord) {
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() - KEY_TTL_HOURS);
      
      if (existingRecord.createdAt < expirationDate) {
        await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } });
      } else if (existingRecord.status === 'STARTED') {
        return res.status(409).json({
          error: 'Conflict',
          message: 'A request with this idempotency key is already in progress.',
        });
      } else if (existingRecord.status === 'COMPLETED') {
        return res.status(existingRecord.responseCode || 200).json(existingRecord.responseBody);
      }
    }

    await prisma.idempotencyKey.create({
      data: { key: idempotencyKey, status: 'STARTED' },
    });

    const originalJson = res.json;
    res.json = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 500) {
        prisma.idempotencyKey.update({
          where: { key: idempotencyKey },
          data: {
            status: 'COMPLETED',
            responseCode: res.statusCode,
            responseBody: body,
          },
        }).catch(err => console.error('Failed to save idempotency response:', err));
      } else {
        prisma.idempotencyKey.delete({ where: { key: idempotencyKey } }).catch(() => {});
      }

      return originalJson.call(this, body);
    };

    next();
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A request with this idempotency key is already in progress.',
      });
    }
    next(error);
  }
};
