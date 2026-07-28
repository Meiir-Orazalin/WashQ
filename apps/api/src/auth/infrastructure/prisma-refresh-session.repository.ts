import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  DuplicateRefreshTokenHashError,
  type CreateRefreshSession,
  type RefreshSession,
  type RefreshSessionRepository,
  type RevokeActiveRefreshSessionByTokenHash,
  type RotateRefreshSession,
  type RotateRefreshSessionResult,
} from '../application/refresh-session.repository.js';
import type { RefreshTokenHash } from '../application/refresh-token-hasher.js';

const refreshSessionSelection = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  replacedBySessionId: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface LockedRefreshSession {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  updatedAt: Date;
}

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

  async revokeActiveByTokenHash(input: RevokeActiveRefreshSessionByTokenHash): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: {
        tokenHash: input.tokenHash,
        revokedAt: null,
        expiresAt: { gt: input.revokedAt },
      },
      data: { revokedAt: input.revokedAt },
    });
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: {
        familyId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  async rotate(input: RotateRefreshSession): Promise<RotateRefreshSessionResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const sessions = await transaction.$queryRaw<LockedRefreshSession[]>`
          SELECT
            refresh_session."id",
            refresh_session."user_id" AS "userId",
            refresh_session."family_id" AS "familyId",
            refresh_session."expires_at" AS "expiresAt",
            refresh_session."revoked_at" AS "revokedAt",
            refresh_session."replaced_by_session_id" AS "replacedBySessionId",
            refresh_session."updated_at" AS "updatedAt"
          FROM "refresh_sessions" AS refresh_session
          INNER JOIN "users" AS refresh_session_user
            ON refresh_session_user."id" = refresh_session."user_id"
          WHERE refresh_session."id" = ${input.sessionId}::uuid
            AND refresh_session."token_hash" = ${input.presentedTokenHash}
          FOR UPDATE OF refresh_session
        `;
        const session = sessions[0];

        if (
          !session ||
          session.revokedAt ||
          session.replacedBySessionId ||
          session.expiresAt.getTime() <= input.rotatedAt.getTime() ||
          session.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        ) {
          return { status: 'stale' } as const;
        }

        const replacement = await transaction.refreshSession.create({
          data: {
            userId: session.userId,
            familyId: session.familyId,
            tokenHash: input.replacementTokenHash,
            expiresAt: input.replacementExpiresAt,
          },
          select: { id: true },
        });

        await transaction.refreshSession.update({
          where: { id: session.id },
          data: {
            revokedAt: input.rotatedAt,
            replacedBySessionId: replacement.id,
          },
          select: { id: true },
        });

        return { status: 'rotated' } as const;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateRefreshTokenHashError();
      }

      throw error;
    }
  }
}
