import { createFileEventStore } from "../../backend/event-store.mjs";
import { createRoomRuntime } from "../../backend/runtime.mjs";

const roomId = process.env.VIRA_SMOKE_ROOM_ID || "p1a-smoke-room";
const eventStore = await createFileEventStore();
const runtime = createRoomRuntime({ eventStore });
await runtime.rehydrateFromLedger();

if (!(await runtime.hasPublicRoom(roomId))) {
  runtime.configureMatch({
    fixtureId: roomId,
    title: "P1-A Persistence vs Restart",
    competitionLabel: "VIRA Operational Proof",
    status: "scheduled",
    startTime: "2030-07-11T18:00:00.000Z",
    homeTeam: "Persistence",
    awayTeam: "Restart",
  });
  await runtime.join(roomId, "Container Smoke");
}

const verification = await runtime.verifyRoom(roomId);
process.stdout.write(`${JSON.stringify({ roomId, verification })}\n`);
process.exit(0);
