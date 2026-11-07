/* Development-only demo data. All people and messages are fictional. */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "DemoPassw0rd!"; // development only

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const people = [
    { username: "alice", displayName: "Alice Demo", avatarColor: "#4a5bf0" },
    { username: "bob", displayName: "Bob Demo", avatarColor: "#0f9d7a" },
    { username: "carol", displayName: "Carol Demo", avatarColor: "#c2410c" },
  ];
  const users = [];
  for (const p of people) {
    users.push(
      await prisma.user.upsert({
        where: { username: p.username },
        update: {},
        create: { ...p, email: `${p.username}@example.test`, passwordHash, status: "Fictional demo account", notificationPreference: { create: {} } },
      }),
    );
  }
  const [alice, bob, carol] = users as [typeof users[0], typeof users[0], typeof users[0]];
  const [a, b] = alice.id < bob.id ? [alice, bob] : [bob, alice];
  await prisma.contact.upsert({ where: { userAId_userBId: { userAId: a.id, userBId: b.id } }, update: {}, create: { userAId: a.id, userBId: b.id } });
  const directKey = `${a.id}:${b.id}`;
  const conv = await prisma.conversation.upsert({
    where: { directKey },
    update: {},
    create: { directKey, participants: { create: [{ userId: a.id }, { userId: b.id }] } },
  });
  if ((await prisma.message.count({ where: { conversationId: conv.id } })) === 0) {
    const lines: [typeof alice, string][] = [
      [alice, "Hi Bob, welcome to SpatialChat!"],
      [bob, "Thanks Alice. The floating panels look great."],
      [alice, "Try sending a reply or an emoji."],
    ];
    for (const [sender, body] of lines) {
      await prisma.message.create({ data: { conversationId: conv.id, senderId: sender.id, clientId: randomUUID(), body } });
    }
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  }
  // Carol has a pending request to Alice so the Requests tab has something to show.
  await prisma.contactRequest.upsert({
    where: { senderId_receiverId: { senderId: carol.id, receiverId: alice.id } },
    update: {},
    create: { senderId: carol.id, receiverId: alice.id },
  });
  console.log(`Seeded demo users alice, bob, carol (password: ${DEMO_PASSWORD}).`);
}

main().finally(() => prisma.$disconnect());
