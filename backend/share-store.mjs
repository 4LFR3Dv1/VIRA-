import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const nowIso = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const code = () => crypto.randomBytes(7).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export class ShareStore {
  constructor({ dataDir = process.env.VIRA_DATA_DIR || path.join(process.cwd(), "data", "vira") } = {}) {
    this.filePath = path.join(dataDir, "social.json");
    this.tempPath = `${this.filePath}.tmp`;
    this.state = { version: 1, shares: {}, identities: {}, predictions: {}, leagues: {}, memberships: {}, participantLinks: {}, analytics: [] };
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const raw = await fs.readFile(this.filePath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    return this;
  }

  async mutate(operation) {
    const run = this.queue.then(async () => {
      const result = await operation(this.state);
      await fs.writeFile(this.tempPath, JSON.stringify(this.state), "utf8");
      await fs.rename(this.tempPath, this.filePath);
      return clone(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  identity(publicToken, displayName = "Fan") {
    if (typeof publicToken !== "string" || publicToken.length < 24) throw Object.assign(new Error("public_identity_required"), { status: 401 });
    const tokenHash = hash(`VIRA:PUBLIC_TOKEN:${publicToken}`);
    const publicId = `player_${hash(`VIRA:PUBLIC_ID:${publicToken}`).slice(0, 24)}`;
    return { publicId, tokenHash, displayName: String(displayName || "Fan").trim().slice(0, 40) || "Fan" };
  }

  async ensureIdentity(publicToken, displayName) {
    const identity = this.identity(publicToken, displayName);
    return this.mutate((state) => {
      const existing = state.identities[identity.publicId];
      state.identities[identity.publicId] = { ...identity, displayName: identity.displayName || existing?.displayName || "Fan", createdAt: existing?.createdAt ?? nowIso(), updatedAt: nowIso() };
      return { publicId: identity.publicId, displayName: state.identities[identity.publicId].displayName };
    });
  }

  async linkParticipant({ publicToken, displayName, roomId, participantId, inviteCode }) {
    const identity = await this.ensureIdentity(publicToken, displayName);
    return this.mutate((state) => {
      const linkKey = `${roomId}:${participantId}`;
      const isNewLink = !state.participantLinks[linkKey];
      state.participantLinks[linkKey] ??= { roomId, participantId, publicId: identity.publicId, linkedAt: nowIso(), inviteCode: inviteCode ?? null };
      if (inviteCode) {
        const share = state.shares[inviteCode];
        if (share?.miniLeagueId) {
          const key = `${share.miniLeagueId}:${identity.publicId}`;
          state.memberships[key] ??= { leagueId: share.miniLeagueId, publicId: identity.publicId, sourceShareId: share.id, joinedAt: nowIso() };
        }
        if (isNewLink) {
          state.analytics.push({ type: "identity_admitted", shareCode: inviteCode, publicId: identity.publicId, roomId, at: nowIso() });
          state.analytics.push({ type: "room_joined_from_share", shareCode: inviteCode, publicId: identity.publicId, roomId, at: nowIso() });
        }
      }
      return identity;
    });
  }

  async trackParticipantAnswer(roomId, participantId, roundId) {
    return this.mutate((state) => {
      const link = state.participantLinks[`${roomId}:${participantId}`];
      if (!link?.inviteCode) return { attributed: false };
      const duplicate = state.analytics.some((event) => event.type === "round_answered" && event.roomId === roomId && event.participantId === participantId && event.roundId === roundId);
      if (!duplicate) state.analytics.push({ type: "round_answered", shareCode: link.inviteCode, publicId: link.publicId, participantId, roomId, roundId, at: nowIso() });
      return { attributed: true };
    });
  }

  async createShare(input) {
    return this.mutate((state) => {
      const publicCode = code();
      const id = `share_${crypto.randomUUID()}`;
      const share = { id, version: 1, publicCode, status: "active", createdAt: nowIso(), ...clone(input) };
      if (!share.destination?.path?.startsWith("/") || !share.destination?.ctaLabel) throw Object.assign(new Error("invalid_share_destination"), { status: 400 });
      if (share.kind === "room" || share.kind === "prediction") {
        const leagueId = `league_${crypto.randomUUID()}`;
        share.miniLeagueId = leagueId;
        state.leagues[leagueId] = { id: leagueId, originShareId: id, fixtureId: share.payload.fixtureId, roomId: share.payload.roomId ?? share.payload.fixtureId, createdByPublicId: share.createdByPublicId, status: "open", createdAt: nowIso() };
        if (share.createdByPublicId) state.memberships[`${leagueId}:${share.createdByPublicId}`] = { leagueId, publicId: share.createdByPublicId, sourceShareId: id, joinedAt: nowIso() };
      }
      state.shares[publicCode] = share;
      state.analytics.push({ type: "share_created", shareCode: publicCode, kind: share.kind, publicId: share.createdByPublicId ?? null, at: nowIso() });
      return share;
    });
  }

  getShare(publicCode) {
    const share = this.state.shares[String(publicCode)];
    if (!share || share.status !== "active") return null;
    if (share.expiresAt && Date.parse(share.expiresAt) <= Date.now()) return { ...clone(share), status: "expired" };
    return clone(share);
  }

  async track(type, publicCode, extra = {}) {
    return this.mutate((state) => {
      state.analytics.push({ type, shareCode: publicCode, at: nowIso(), ...clone(extra) });
      state.analytics = state.analytics.slice(-10_000);
      return { accepted: true };
    });
  }

  async createPrediction({ publicToken, displayName, fixture, choice }) {
    const identity = await this.ensureIdentity(publicToken, displayName);
    if (!(["home", "draw", "away"].includes(choice))) throw Object.assign(new Error("invalid_prediction_choice"), { status: 400 });
    if (fixture.status !== "scheduled" || (fixture.startTime && Date.parse(fixture.startTime) <= Date.now())) throw Object.assign(new Error("prediction_locked"), { status: 409 });
    const key = `${fixture.fixtureId}:${identity.publicId}`;
    return this.mutate((state) => {
      let prediction = state.predictions[key];
      if (!prediction) {
        prediction = { id: `prediction_${crypto.randomUUID()}`, fixtureId: fixture.fixtureId, publicId: identity.publicId, displayName: identity.displayName, choice, status: "open", createdAt: nowIso(), locksAt: fixture.startTime };
        state.predictions[key] = prediction;
      } else if (prediction.status === "open") {
        prediction.choice = choice;
        prediction.updatedAt = nowIso();
      }
      return prediction;
    });
  }

  async attributePredictionInvite({ publicToken, displayName, inviteCode }) {
    if (!inviteCode) return { attributed: false };
    const identity = await this.ensureIdentity(publicToken, displayName);
    return this.mutate((state) => {
      const share = state.shares[String(inviteCode)];
      if (!share?.miniLeagueId || share.kind !== "prediction") return { attributed: false };
      const key = `${share.miniLeagueId}:${identity.publicId}`;
      const created = !state.memberships[key];
      state.memberships[key] ??= { leagueId: share.miniLeagueId, publicId: identity.publicId, sourceShareId: share.id, joinedAt: nowIso() };
      if (created) state.analytics.push({ type: "prediction_joined_from_share", shareCode: inviteCode, publicId: identity.publicId, fixtureId: share.payload.fixtureId, at: nowIso() });
      return { attributed: true, miniLeagueId: share.miniLeagueId };
    });
  }

  prediction(fixtureId, publicId) { return clone(this.state.predictions[`${fixtureId}:${publicId}`] ?? null); }

  homePlayer(publicToken) {
    const identity = this.identity(publicToken);
    const stored = this.state.identities[identity.publicId];
    if (!stored) return null;
    const predictions = Object.fromEntries(Object.values(this.state.predictions)
      .filter((prediction) => prediction.publicId === identity.publicId)
      .map((prediction) => [String(prediction.fixtureId), clone(prediction)]));
    const miniLeagueIds = Object.values(this.state.memberships)
      .filter((membership) => membership.publicId === identity.publicId)
      .map((membership) => membership.leagueId);
    const roomLinks = Object.values(this.state.participantLinks)
      .filter((link) => link.publicId === identity.publicId)
      .map(({ roomId, participantId }) => ({ roomId, participantId }));
    return {
      publicId: identity.publicId,
      displayName: stored.displayName,
      points: 0,
      streak: 0,
      predictions,
      miniLeagueIds: [...new Set(miniLeagueIds)],
      roomLinks,
    };
  }

  async trackHome(type, publicToken, extra = {}) {
    if (!["home.editorial_viewed", "home.primary_action_clicked"].includes(type)) {
      throw Object.assign(new Error("invalid_home_analytics_event"), { status: 400 });
    }
    const identity = this.identity(publicToken);
    return this.mutate((state) => {
      state.analytics.push({ type, publicId: identity.publicId, at: nowIso(), ...clone(extra) });
      state.analytics = state.analytics.slice(-10_000);
      return { accepted: true };
    });
  }

  async resolvePredictionsForFixture(fixtureId, { homeScore, awayScore, officialAt = nowIso() }) {
    const home = Number(homeScore);
    const away = Number(awayScore);
    if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) {
      throw Object.assign(new Error("invalid_official_score"), { status: 400 });
    }
    const winningChoice = home > away ? "home" : away > home ? "away" : "draw";
    return this.mutate((state) => {
      const resolved = [];
      for (const prediction of Object.values(state.predictions)) {
        if (String(prediction.fixtureId) !== String(fixtureId)) continue;
        if (prediction.status !== "resolved") {
          prediction.status = "resolved";
          prediction.winningChoice = winningChoice;
          prediction.correct = prediction.choice === winningChoice;
          prediction.finalScore = { home, away };
          prediction.resolvedAt = officialAt;
        }
        resolved.push(prediction);
      }
      return { fixtureId, winningChoice, resolved: resolved.length };
    });
  }

  league(leagueId, roomSnapshot) {
    const league = this.state.leagues[leagueId];
    if (!league) return null;
    const members = Object.values(this.state.memberships).filter((item) => item.leagueId === leagueId);
    const originShare = Object.values(this.state.shares).find((share) => share.id === league.originShareId);
    const predictionLeague = originShare?.kind === "prediction";
    const rows = members.map((member) => {
      if (predictionLeague) {
        const prediction = this.state.predictions[`${league.fixtureId}:${member.publicId}`];
        return { publicId: member.publicId, displayName: this.state.identities[member.publicId]?.displayName ?? "Fan", points: prediction?.correct ? 100 : 0, roomRank: null, predictionStatus: prediction?.status ?? "pending", joinedAt: member.joinedAt };
      }
      const links = Object.values(this.state.participantLinks).filter((item) => item.roomId === league.roomId && item.publicId === member.publicId);
      const entries = links.map((link) => roomSnapshot?.leaderboard?.find((entry) => entry.participantId === link.participantId)).filter(Boolean);
      const best = entries.sort((a, b) => b.points - a.points)[0];
      return { publicId: member.publicId, displayName: this.state.identities[member.publicId]?.displayName ?? "Fan", points: best?.points ?? 0, roomRank: best?.rank ?? null, joinedAt: member.joinedAt };
    }).sort((a, b) => b.points - a.points || a.joinedAt.localeCompare(b.joinedAt)).map((row, index) => ({ ...row, rank: index + 1 }));
    const matchStatus = roomSnapshot?.match?.status;
    const predictionResolved = predictionLeague && rows.some((row) => row.predictionStatus === "resolved");
    const status = predictionResolved || matchStatus === "finished" ? "resolved" : matchStatus === "live" ? "locked" : league.status;
    return { ...clone(league), status, members: rows, editorialContext: clone(originShare?.editorialContext ?? null) };
  }
}

export async function createShareStore(options) { return new ShareStore(options).init(); }
