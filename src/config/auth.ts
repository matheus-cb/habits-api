import { env } from './env';

export const authConfig = {
  secret: env.JWT_SECRET,
  expiresIn: env.JWT_EXPIRES_IN,
  saltRounds: 10,
} as const;
