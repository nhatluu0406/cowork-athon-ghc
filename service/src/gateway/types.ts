import type { CredentialRef } from "@cowork-ghc/contracts";

export type GatewayHealth = "unknown" | "healthy" | "degraded" | "down";

export interface GatewayAccount {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly credentialRef: CredentialRef;
  readonly isActive: boolean;
  readonly addedAt: string;
}

export interface GatewayStatus {
  readonly health: GatewayHealth;
  readonly accounts: readonly GatewayAccount[];
  readonly activeByProvider: Readonly<Record<string, string>>; // providerId → accountId
}

export interface AddAccountInput {
  readonly providerId: string;
  readonly label: string;
  readonly apiKey: string;
}
