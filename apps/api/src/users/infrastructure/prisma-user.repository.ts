import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  DuplicateUserEmailError,
  type CreateUser,
  type RegisteredUser,
  type UserAuthenticationRecord,
  type UserRepository,
} from '../application/user-repository.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(user: CreateUser): Promise<RegisteredUser> {
    try {
      return await this.prisma.user.create({
        data: {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email.toLowerCase(),
          passwordHash: user.passwordHash,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateUserEmailError();
      }

      throw error;
    }
  }

  findAuthenticationByEmail(email: string): Promise<UserAuthenticationRecord | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        passwordHash: true,
      },
    });
  }
}
