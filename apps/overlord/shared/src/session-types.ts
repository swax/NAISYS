export interface AccessKeyRequest {
  accessKey: string;
}

export interface AccessKeyResponse {
  success: boolean;
  message: string;
  token?: string;
}

export interface SessionResponse {
  success: boolean;
  username?: string;
  startDate?: string;
  expireDate?: string;
  message?: string;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}
