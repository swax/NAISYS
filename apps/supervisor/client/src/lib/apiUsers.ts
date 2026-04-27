import type {
  CreateUserResponse,
  Permission,
  StepUpAssertionBody,
  UserActionResult,
  UserDetailResponse,
  UserListResponse,
} from "@naisys/supervisor-shared";

import { performStepUp } from "./apiAuth";
import { api, apiEndpoints } from "./apiClient";

export const getUsers = async (params: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<UserListResponse> => {
  return api.get<UserListResponse>(apiEndpoints.users(params));
};

export const getUser = async (
  username: string,
): Promise<UserDetailResponse> => {
  return api.get<UserDetailResponse>(apiEndpoints.userDetail(username));
};

export const createUser = async (data: {
  username: string;
}): Promise<CreateUserResponse> => {
  const stepUpAssertion = await performStepUp();
  return api.post<
    { username: string } & StepUpAssertionBody,
    CreateUserResponse
  >(apiEndpoints.users(), {
    username: data.username,
    stepUpAssertion: stepUpAssertion ?? undefined,
  });
};

export const updateUser = async (
  username: string,
  data: { username?: string },
): Promise<UserActionResult> => {
  return api.put<typeof data, UserActionResult>(
    apiEndpoints.userDetail(username),
    data,
  );
};

export const deleteUser = async (
  username: string,
): Promise<UserActionResult> => {
  return api.delete<UserActionResult>(apiEndpoints.userDetail(username));
};

export const grantPermission = async (
  username: string,
  permission: Permission,
): Promise<UserActionResult> => {
  return api.post<{ permission: Permission }, UserActionResult>(
    apiEndpoints.userPermissions(username),
    { permission },
  );
};

export const revokePermission = async (
  username: string,
  permission: Permission,
): Promise<UserActionResult> => {
  return api.delete<UserActionResult>(
    apiEndpoints.userPermission(username, permission),
  );
};

export const rotateUserApiKey = async (
  username: string,
): Promise<UserActionResult> => {
  return api.post<{}, UserActionResult>(apiEndpoints.userRotateKey(username), {});
};

export const createAgentUser = async (
  agentId: number,
): Promise<CreateUserResponse> => {
  return api.post<{ agentId: number }, CreateUserResponse>(
    apiEndpoints.userCreateFromAgent,
    { agentId },
  );
};
