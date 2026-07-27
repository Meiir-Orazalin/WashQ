import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  DuplicateRefreshTokenHashError,
  type CreateRefreshSession,
  type RefreshSession,
  type RefreshSessionRepository,
} from '../application/refresh-session.repository.js';
import type { RefreshTokenHash } from '../application/refresh-token-hasher.js';

const refreshSessionSelection = {
  id: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaRefreshSessionRepository implements RefreshSessionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateRefreshSession): Promise<RefreshSession> {
    try {
      return await this.prisma.refreshSession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
        select: refreshSessionSelection,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateRefreshTokenHashError();
      }

      throw error;
    }
  }

  findByTokenHash(tokenHash: RefreshTokenHash): Promise<RefreshSession | null> {
    return this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: refreshSessionSelection,
    });
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshSession.update({
      where: { id: sessionId },
      data: { revokedAt },
      select: { id: true },
    });
  }
}
