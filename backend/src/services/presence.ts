// In-memory presence (single server process). For multiple instances use the Socket.IO Redis adapter
// and move this state to Redis - see README "Scaling".
const connections = new Map<string, number>();

export const isOnline = (userId: string) => (connections.get(userId) ?? 0) > 0;

/** @returns true when this is the user's first connection */
export function connected(userId: string): boolean {
  const n = connections.get(userId) ?? 0;
  connections.set(userId, n + 1);
  return n === 0;
}
/** @returns true when this was the user's last connection */
export function disconnected(userId: string): boolean {
  const n = (connections.get(userId) ?? 1) - 1;
  if (n <= 0) {
    connections.delete(userId);
    return true;
  }
  connections.set(userId, n);
  return false;
}
