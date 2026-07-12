export interface XMageBridgeStatus {
  enabled: boolean;
  status: "not_configured" | "offline" | "connected" | "error";
  message: string;
}

export async function getXMageStatus(): Promise<XMageBridgeStatus> {
  const endpoint = process.env.XMAGE_BRIDGE_URL;
  if (!endpoint) {
    return {
      enabled: false,
      status: "not_configured",
      message: "Set XMAGE_BRIDGE_URL after installing/configuring a local XMage bridge."
    };
  }

  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { cache: "no-store" });
    if (!response.ok) {
      return { enabled: true, status: "offline", message: `XMage bridge returned HTTP ${response.status}.` };
    }
    return { enabled: true, status: "connected", message: "XMage bridge is reachable." };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      message: error instanceof Error ? error.message : "XMage bridge failed."
    };
  }
}
