import { Request, Response } from 'express';
import { AuthService } from '@/services/auth.service';
import { UsersRepository } from '@/repositories/users.repository';
import { successResponse } from '@/utils/response';
import { RegisterInput, LoginInput, UpdateProfileInput } from '@/schemas/auth.schema';

export class AuthController {
  private authService: AuthService;

  constructor() {
    const usersRepository = new UsersRepository();
    this.authService = new AuthService(usersRepository);
  }

  register = async (req: Request<object, object, RegisterInput>, res: Response) => {
    const result = await this.authService.register(req.body);
    return res.status(201).json(successResponse(result, 'User registered successfully'));
  };

  login = async (req: Request<object, object, LoginInput>, res: Response) => {
    const result = await this.authService.login(req.body);
    return res.status(200).json(successResponse(result, 'Login successful'));
  };

  getProfile = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await this.authService.getProfile(userId);
    return res.status(200).json(successResponse(result));
  };

  updateProfile = async (req: Request<object, object, UpdateProfileInput>, res: Response) => {
    const userId = req.user!.id;
    const result = await this.authService.updateProfile(userId, req.body);
    return res.status(200).json(successResponse(result, 'Profile updated successfully'));
  };
}
