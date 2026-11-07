import type { Server } from "socket.io";

export const userRoom = (userId: string) => `user:${userId}`;
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

export function emitToUsers(io: Server, userIds: string[], event: string, payload: unknown) {
  for (const id of new Set(userIds)) io.to(userRoom(id)).emit(event, payload);
}
