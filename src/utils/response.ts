export interface ApiResponse<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  error?: string;
}

export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    status: 'success',
    message,
    data,
  };
}

export function errorResponse(error: string, message?: string): ApiResponse {
  return {
    status: 'error',
    message,
    error,
  };
}
