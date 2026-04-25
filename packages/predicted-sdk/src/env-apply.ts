import type { EnvSnapshot } from "./types.js";

export function snapshotOmnipairEnv(): EnvSnapshot {
  return {
    nextPublicOmnipair: process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID,
    teamTreasury: process.env.OMNIPAIR_TEAM_TREASURY,
    executeInit: process.env.OMNIPAIR_EXECUTE_INIT,
  };
}

function setOrDelete(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

export function restoreOmnipairEnv(s: EnvSnapshot) {
  setOrDelete("NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID", s.nextPublicOmnipair);
  setOrDelete("OMNIPAIR_TEAM_TREASURY", s.teamTreasury);
  setOrDelete("OMNIPAIR_EXECUTE_INIT", s.executeInit);
}

export function applyOmnipairProgramId(programId: string) {
  process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID = programId;
}

export function withCreateMarketEnv<T>(
  teamTreasury: string,
  fn: () => Promise<T>,
): Promise<T> {
  const snap = snapshotOmnipairEnv();
  process.env.OMNIPAIR_TEAM_TREASURY = teamTreasury;
  process.env.OMNIPAIR_EXECUTE_INIT = "true";
  return fn().finally(() => {
    if (snap.teamTreasury === undefined) {
      delete process.env.OMNIPAIR_TEAM_TREASURY;
    } else {
      process.env.OMNIPAIR_TEAM_TREASURY = snap.teamTreasury;
    }
    if (snap.executeInit === undefined) {
      delete process.env.OMNIPAIR_EXECUTE_INIT;
    } else {
      process.env.OMNIPAIR_EXECUTE_INIT = snap.executeInit;
    }
  });
}
