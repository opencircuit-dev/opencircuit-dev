/**
 * Utility to check if a user is a Continue team member
 */
export function isOCircuitTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.endsWith("@ocircuit.dev");
}
