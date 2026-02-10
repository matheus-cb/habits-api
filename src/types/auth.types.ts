export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
}

export interface LoginResponse extends AuthTokens {
  user: {
    id: string;
    name: string;
    email: string;
  };
}
