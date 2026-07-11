export function participantAccent(participantId: string) {
  if (participantId === "maya") return "bg-violet-400";
  if (participantId === "leo") return "bg-sky-400";
  if (participantId === "bia") return "bg-pink-400";
  if (participantId === "davi") return "bg-emerald-400";
  return "bg-primary";
}

