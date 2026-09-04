export interface GatewayView {
  id: string; label: string; baseUrl: string; hasToken: boolean;
  defaultBaseUrl?: string; isDefault?: boolean;
  authMode: string; requiresReauthentication?: boolean; relay: boolean;
  relayStatus: "disabled" | "checking" | "ready" | "unavailable";
}
export interface GatewayActivity { id: string; source: string; target: string; profile: string; status: "delivering" | "replied" | "failed" | "reply-pending"; at: number }
export interface GatewayList { gateways: GatewayView[]; activity: GatewayActivity[] }
