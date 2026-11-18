import os from "node:os";

// Lists this machine's non-loopback IPv4 addresses so the host panel can show a join link friends can actually use (Hamachi 25.x.x.x first).
// Only reveals addresses the friend already has to know to connect. Lives under /api/mp so the host-only API guard lets it through.
export const dynamic = "force-dynamic";

export function GET() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i) && i!.family === "IPv4" && !i!.internal)
    .map((i) => i.address);
  addresses.sort((a, b) => Number(b.startsWith("25.")) - Number(a.startsWith("25.")));
  return Response.json({ addresses });
}
