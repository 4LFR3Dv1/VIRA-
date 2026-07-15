import type { MatchMoment, MatchMomentDirectorState, MomentCommand, PressureMoment } from "./match-moment-types";

const remember = (values: string[], value: string) => [value, ...values.filter((item) => item !== value)].slice(0, 160);
const sortQueue = (queue: MatchMoment[]) => [...queue].sort((a, b) => b.priority - a.priority);

function promote(state: MatchMomentDirectorState): MatchMomentDirectorState {
  if (state.active || state.queue.length === 0) return state;
  const [active, ...queue] = state.queue;
  return { ...state, active, queue };
}

export function matchMomentDirectorReducer(state: MatchMomentDirectorState, command: MomentCommand): MatchMomentDirectorState {
  if (command.type === "clear_ambient") {
    return state.ambient?.fixtureId === command.fixtureId ? { ...state, ambient: null } : state;
  }
  if (command.type === "set_ambient") {
    return {
      ...state,
      ambient: command.moment,
      seenIds: remember(state.seenIds, command.moment.id),
    };
  }
  if (command.type === "dismiss") {
    if (command.momentId && state.active?.id !== command.momentId) return state;
    return promote({ ...state, active: null });
  }
  if (command.type === "expire_ambient") {
    return state.ambient?.id === command.momentId ? { ...state, ambient: null } : state;
  }
  if (command.type === "revoke") {
    const revokedActionIds = remember(state.revokedActionIds, command.sourceActionId);
    return promote({
      ...state,
      active: state.active?.sourceActionId === command.sourceActionId ? null : state.active,
      ambient: state.ambient?.sourceActionId === command.sourceActionId ? null : state.ambient,
      queue: state.queue.filter((moment) => moment.sourceActionId !== command.sourceActionId),
      revokedActionIds,
    });
  }

  const moment = command.moment;
  if (state.revokedActionIds.includes(moment.sourceActionId)) return state;
  if (state.seenIds.includes(moment.id) && command.type !== "replace") return state;
  let next = state;
  if (command.type === "replace") {
    next = {
      ...next,
      active: next.active?.sourceActionId === command.sourceMomentId ? null : next.active,
      queue: next.queue.filter((item) => item.sourceActionId !== command.sourceMomentId),
      ambient: next.ambient?.sourceActionId === command.sourceMomentId ? null : next.ambient,
    };
  }
  if (moment.presentation === "ambient") {
    return { ...next, ambient: moment as PressureMoment, seenIds: remember(next.seenIds, moment.id) };
  }

  const seenIds = remember(next.seenIds, moment.id);
  if (!next.active) return { ...next, active: moment, seenIds };
  const shouldPreempt = moment.presentation === "takeover" && next.active.interruptible && moment.priority >= next.active.priority + 40;
  if (shouldPreempt) return { ...next, active: moment, queue: next.queue.filter((item) => item.id !== moment.id), seenIds };
  return { ...next, queue: sortQueue([...next.queue.filter((item) => item.id !== moment.id), moment]).slice(0, 8), seenIds };
}
