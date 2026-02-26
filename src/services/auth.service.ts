import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UsersRepository } from '@/repositories/users.repository';
import { ConflictError, UnauthorizedError } from '@/utils/errors';
import { authConfig } from '@/config/auth';
import { LoginResponse, JwtPayload } from '@/types/auth.types';
import { RegisterInput, LoginInput, UpdateProfileInput } from '@/schemas/auth.schema';

export class AuthService {
  constructor(private usersRepository: UsersRepository) {}

  async register(data: RegisterInput): Promise<LoginResponse> {
    const existingUser = await this.usersRepository.findByEmail(data.email);

    if (existingUser) {
      throw new ConflictError('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(data.password, authConfig.saltRounds);

    const user = await this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });

    const accessToken = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  async login(data: LoginInput): Promise<LoginResponse> {
    const user = await this.usersRepository.findByEmail(data.email);

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const accessToken = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, data: UpdateProfileInput) {
    if (data.email) {
      const existing = await this.usersRepository.findByEmail(data.email);
      if (existing && existing.id !== userId) {
        throw new ConflictError('Email already in use');
      }
    }

    const user = await this.usersRepository.update(userId, data);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  private generateToken(payload: JwtPayload): string {
    return jwt.sign(payload, authConfig.secret, {
      expiresIn: authConfig.expiresIn,
    });
  }
}
