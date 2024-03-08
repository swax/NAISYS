/* To separate enums from services which is useful for mocking where the enum
is used across the code base, but the service it originates from is mocked. */

export enum CommandProtection {
  None = "none",
  Manual = "manual",
  Auto = "auto",
}
