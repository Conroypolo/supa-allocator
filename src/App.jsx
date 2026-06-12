import React, { useState, useRef } from "react";

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = "supa-allocator-v4";
const LEGACY_KEYS = ["supa-allocator-v3", "supa-allocator-v2", "supa-allocator-data"];

const DEFAULT_ROSTER = [
  { id: "cisco-default",   name: "Cisco",   maxChukkas: 4 },
  { id: "nemo-default",    name: "Nemo",    maxChukkas: 4 },
  { id: "tiz-default",     name: "Tiz",     maxChukkas: 4 },
  { id: "bandit-default",  name: "Bandit",  maxChukkas: 4 },
  { id: "pooh-default",    name: "Pooh",    maxChukkas: 4 },
  { id: "dubai-default",   name: "Dubai",   maxChukkas: 4 },
  { id: "sirena-default",  name: "Sirena",  maxChukkas: 4 },
  { id: "echo-default",    name: "Echo",    maxChukkas: 4 },
  { id: "molly-default",   name: "Molly",   maxChukkas: 4 },
  { id: "sabrina-default", name: "Sabrina", maxChukkas: 4 },
  { id: "joey-default",    name: "Joey",    maxChukkas: 4 },
  { id: "morena-default",  name: "Morena",  maxChukkas: 4 },
  { id: "teddy-default",   name: "Teddy",   maxChukkas: 4 },
  { id: "rita-default",    name: "Rita",    maxChukkas: 4 },
  { id: "kona-default",    name: "Kona",    maxChukkas: 4 },
];

const defaultData = { roster: DEFAULT_ROSTER, events: [] };

function loadData() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      if (!parsed.roster || parsed.roster.length === 0) parsed.roster = DEFAULT_ROSTER;
      return { ...defaultData, ...parsed };
    }
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const migrated = {
          roster: parsed.roster?.length > 0 ? parsed.roster : DEFAULT_ROSTER,
          events: parsed.events || [],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
    return defaultData;
  } catch { return defaultData; }
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.error("Save failed", e); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }
const DIVISIONS = ["Beginner", "Median", "Novice"];
const DIV_COLOR = { Beginner: "#60a5fa", Median: "#fbbf24", Novice: "#4ade80" };

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

// ── Win tracking ──────────────────────────────────────────────────────────────
function getTeamWins(teams, allDayResults) {
  const wins = {};
  teams.forEach(t => { wins[t.id] = 0; });
  for (const dayResults of allDayResults) {
    for (const result of Object.values(dayResults)) {
      if (result.outcome === "win" && result.teamId) {
        wins[result.teamId] = (wins[result.teamId] || 0) + 1;
      }
    }
  }
  return wins;
}

// ── Welfare codes (chukka-gap based) ─────────────────────────────────────────
function getWelfareCode(gapChukkas, rules) {
  if (gapChukkas === null) return { code: "DONE",     color: "#4ade80" };
  if (gapChukkas >= rules.fullyUntack)  return { code: "UNTACK",   color: "#60a5fa" };
  if (gapChukkas >= rules.bandagesOnly) return { code: "BANDAGES", color: "#fbbf24" };
  return { code: "READY", color: "#f87171" };
}

// ── Bracket parsing ───────────────────────────────────────────────────────────
function parseMatchRef(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(Win|Loss|RU)\s+([A-Za-z0-9]+)$/i);
  if (m) return { type: m[1].toLowerCase(), ref: m[2].toLowerCase() };
  return null;
}

function buildDaySchedule(dayName) {
  const raw = SUMMER_2026_RAW[dayName] || [];
  return raw.map(([chukkaNum, time, division, pitch, matchLetter, koAmt, teamA, teamB]) => ({
    chukkaNum: String(chukkaNum), time, division, pitch,
    matchLetter, koAmt, teamA, teamB,
  }));
}

function findConroyChukkas(dayName, conroyTeams, dayResults) {
  const allChukkas = buildDaySchedule(dayName);
  const result = [];

  // Step 1: named entry chukkas
  for (const chukka of allChukkas) {
    const tA = (chukka.teamA || "").toLowerCase();
    const tB = (chukka.teamB || "").toLowerCase();
    for (const team of conroyTeams) {
      const tl = team.name.toLowerCase();
      if (tA === tl || tB === tl) {
        result.push({ ...chukka, conroyTeam: team, branch: "confirmed", isConditional: false });
      }
    }
  }

  // Step 2: trace win/loss paths per division+pitch
  for (const entry of [...result]) {
    const { matchLetter, division, pitch, conroyTeam } = entry;
    if (!matchLetter) continue;
    const scope = allChukkas.filter(c => c.division === division && c.pitch === pitch);

    function findNext(letter) {
      const ll = letter.toLowerCase();
      for (const c of scope) {
        const refA = parseMatchRef(c.teamA);
        const refB = parseMatchRef(c.teamB);
        const ref = (refA?.ref === ll ? refA : null) || (refB?.ref === ll ? refB : null);
        if (!ref) continue;
        const branch = ref.type === "win" ? "win" : "loss";
        const isDup = result.some(r =>
          r.chukkaNum === c.chukkaNum && r.pitch === c.pitch &&
          r.conroyTeam?.id === conroyTeam.id && r.branch === branch
        );
        if (!isDup) {
          result.push({ ...c, conroyTeam, branch, isConditional: true });
          findNext(c.matchLetter);
        }
      }
    }
    findNext(matchLetter);
  }

  return result.sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));
}

function bracketToAllocatable(bracketChukkas) {
  return bracketChukkas.map(c => ({
    id: `${c.chukkaNum}-${c.pitch}-${c.conroyTeam?.id || ""}-${c.branch}`,
    chukkaNum: c.chukkaNum,
    time: c.time,
    division: c.division,
    pitch: c.pitch,
    matchLetter: c.matchLetter,
    teamId: c.conroyTeam?.id,
    playerIds: c.conroyTeam?.players.map(p => p.id) || [],
    branch: c.branch,
    isConditional: c.isConditional,
    teamA: c.teamA,
    teamB: c.teamB,
  }));
}

// ── Constraint-aware allocation engine ───────────────────────────────────────
//
// Design:
//  1. Collect all (player, chukka) slots for the day
//  2. For each slot, compute viable horses = preference list filtered by:
//     - horse is available (not marked unavailable)
//     - horse exists in event
//     - rest constraint: no other use within 1 chukka of this chukka number
//     - max chukkas: horse hasn't been used at or beyond its daily max
//  3. Respect locked assignments — treat as pre-assigned, remove that horse
//     from other slots' viable sets accordingly
//  4. Prioritise slots: winning teams first, within equal wins preserve pref order
//  5. Assign greedily in priority order, updating usage after each assignment
//  6. Flag any slot that ends with no viable horse, with detailed reason
//
// Locks: { [chukkaId]: { [playerId]: horseId } }
// Returns: { assignments: { [chukkaId]: { [playerId]: { horseId, locked, welfare, gapChukkas } } }, conflicts: [...] }

function runAllocation(allChukkas, teams, horses, welfareRules, teamWins, locks, _seed) {
  const available = horses.filter(h => h.unavailable !== true);
  const horseById = {};
  available.forEach(h => { horseById[h.id] = h; });

  const playerMap = {};
  teams.forEach(t => t.players.forEach(p => { playerMap[p.id] = { ...p, teamId: t.id }; }));

  const sorted = [...allChukkas].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));

  // Build slots
  const allSlots = [];
  for (const chukka of sorted) {
    for (const playerId of (chukka.playerIds || [])) {
      const player = playerMap[playerId];
      if (!player) continue;
      allSlots.push({
        chukkaId: chukka.id,
        chukkaNum: parseInt(chukka.chukkaNum) || 0,
        teamId: chukka.teamId,
        teamWins: teamWins[chukka.teamId] || 0,
        playerId,
        preferences: player.preferences || [],
        locked: locks[chukka.id]?.[playerId] || null,
      });
    }
  }

  // Usage tracking
  const usage = {};
  available.forEach(h => { usage[h.id] = []; });

  function canUse(horseId, chukkaNum) {
    const horse = horseById[horseId];
    if (!horse) return { ok: false, reason: "not in event" };
    const uses = usage[horseId];
    if (uses.length >= horse.maxChukkas) return { ok: false, reason: `at max ${horse.maxChukkas} chukkas` };
    for (const used of uses) {
      if (Math.abs(used - chukkaNum) < 2) return { ok: false, reason: `insufficient rest (used chukka ${used})` };
    }
    return { ok: true };
  }

  const result = {};

  // Apply locked slots first as fixed constraints
  for (const slot of allSlots.filter(s => s.locked)) {
    if (!result[slot.chukkaId]) result[slot.chukkaId] = {};
    const check = canUse(slot.locked, slot.chukkaNum);
    result[slot.chukkaId][slot.playerId] = {
      horseId: slot.locked, locked: true,
      warning: check.ok ? null : `Locked horse conflict: ${check.reason}`,
    };
    if (check.ok) usage[slot.locked].push(slot.chukkaNum);
  }

  // Free slots — solve with backtracking
  const freeSlots = allSlots.filter(s => !s.locked);

  // Sort by most constrained first (MRV heuristic)
  // Compute initial viable count for each slot
  function viableHorses(slot) {
    return slot.preferences.filter(hId => horseById[hId] && canUse(hId, slot.chukkaNum).ok);
  }

  freeSlots.sort((a, b) => {
    const va = viableHorses(a).length;
    const vb = viableHorses(b).length;
    if (va !== vb) return va - vb; // most constrained first
    if (b.teamWins !== a.teamWins) return b.teamWins - a.teamWins; // then by win priority
    if (a.chukkaNum !== b.chukkaNum) return a.chukkaNum - b.chukkaNum; // then by chukka order
    return Math.random() - 0.5; // tiebreak randomly so each recalc explores different tree
  });

  // Backtracking solver
  function solve(idx) {
    if (idx === freeSlots.length) return true;

    const slot = freeSlots[idx];
    if (!result[slot.chukkaId]) result[slot.chukkaId] = {};

    const viable = viableHorses(slot);

    if (viable.length === 0) {
      // Cannot assign — record failure and continue (don't block rest of day)
      result[slot.chukkaId][slot.playerId] = {
        horseId: null, locked: false, noHorse: true,
        failReasons: slot.preferences.map(hId => {
          const h = horseById[hId];
          if (!h) return { horseId: hId, horseName: hId, reason: "not in event" };
          return { horseId: hId, horseName: h.name, reason: canUse(hId, slot.chukkaNum).reason };
        }),
        noPreferences: slot.preferences.length === 0,
      };
      const ok = solve(idx + 1);
      if (!ok) delete result[slot.chukkaId][slot.playerId];
      return ok;
    }

    // Shuffle viable options so recalculate explores different solutions
    // Preferences still respected via MRV sort — this just varies the path taken
    const shuffled = [...viable].sort(() => Math.random() - 0.5);
    for (const horseId of shuffled) {
      usage[horseId].push(slot.chukkaNum);
      result[slot.chukkaId][slot.playerId] = { horseId, locked: false };

      if (solve(idx + 1)) return true;

      // Backtrack
      usage[horseId].splice(usage[horseId].lastIndexOf(slot.chukkaNum), 1);
      delete result[slot.chukkaId][slot.playerId];
    }

    // All options exhausted — record failure and continue
    result[slot.chukkaId][slot.playerId] = {
      horseId: null, locked: false, noHorse: true,
      failReasons: slot.preferences.map(hId => {
        const h = horseById[hId];
        if (!h) return { horseId: hId, horseName: hId, reason: "not in event" };
        return { horseId: hId, horseName: h.name, reason: canUse(hId, slot.chukkaNum).reason };
      }),
    };
    return solve(idx + 1);
  }

  solve(0);

  // Attach welfare codes
  // Build horse timeline from result
  const horseTimeline = {}; // horseId -> [{chukkaId, chukkaNum}]
  available.forEach(h => { horseTimeline[h.id] = []; });
  for (const chukka of sorted) {
    for (const playerId of (chukka.playerIds || [])) {
      const assignment = result[chukka.id]?.[playerId];
      if (assignment?.horseId) {
        horseTimeline[assignment.horseId].push({ chukkaId: chukka.id, chukkaNum: parseInt(chukka.chukkaNum) || 0 });
      }
    }
  }
  // Sort timelines
  Object.values(horseTimeline).forEach(tl => tl.sort((a, b) => a.chukkaNum - b.chukkaNum));

  // Attach welfare to each assignment
  for (const chukka of sorted) {
    const thisNum = parseInt(chukka.chukkaNum) || 0;
    for (const playerId of (chukka.playerIds || [])) {
      const a = result[chukka.id]?.[playerId];
      if (!a || !a.horseId) continue;
      const tl = horseTimeline[a.horseId];
      const idx = tl.findIndex(x => x.chukkaId === chukka.id);
      const next = tl[idx + 1];
      const gapChukkas = next ? next.chukkaNum - thisNum - 1 : null;
      a.welfare = getWelfareCode(gapChukkas, welfareRules);
      a.gapChukkas = gapChukkas;
    }
  }

  // Build conflicts list
  const conflicts = [];
  for (const chukka of sorted) {
    for (const playerId of (chukka.playerIds || [])) {
      const a = result[chukka.id]?.[playerId];
      if (a?.noHorse) {
        const player = playerMap[playerId];
        const team = teams.find(t => t.id === chukka.teamId);
        conflicts.push({
          chukkaId: chukka.id,
          chukkaNum: chukka.chukkaNum,
          playerId,
          playerName: player?.name || playerId,
          teamName: team?.name || "",
          failReasons: a.failReasons || [],
          noPreferences: (player?.preferences || []).length === 0,
        });
      }
      if (a?.warning) {
        conflicts.push({
          chukkaId: chukka.id,
          chukkaNum: chukka.chukkaNum,
          playerId,
          playerName: playerMap[playerId]?.name || playerId,
          warning: a.warning,
          isLockConflict: true,
        });
      }
    }
  }

  return { assignments: result, conflicts };
}


// ── Summer 2026 schedule — from official SUPA Excel, V2, 19/05/26 ──────────────
// Complete schedule: all chukkas, both pitches, all 3 days
// Format: [chukkaNum, time, division, pitch, matchLetter, koAmt, teamA, teamB]
const SUMMER_2026_RAW = {
  "Friday 12th June": [
    [1, "09:00", "Upper Beginner", 1, "a", "KO", "Durham Divas", "Nott Horsing Around"],
    [1, "09:00", "Lower Novice Combined", 2, "a", "KO", "Newcastle Pink Stars", "OxExeter Combined"],
    [2, "09:12", "Upper Beginner", 1, "b", "KO", "Brumbastic Side Eye", "Exeter Valentina"],
    [2, "09:12", "Lower Novice Combined", 2, "b", "KO", "Pasture Bedtime", "Bristol Badgers"],
    [3, "09:25", "Lower Beginner", 1, "b", "AMT1", "Lboro Llamas", "UCL Beginner 4"],
    [3, "09:25", "Upper Novice", 2, "a", "KO", "Warwick UN", "Exeter Larry"],
    [4, "09:37", "Lower Beginner", 1, "a", "KO", "RHUL Hook her? I hardly know her!", "Reining Kings"],
    [4, "09:37", "Upper Novice", 2, "b", "KO", "Surrey Stallions", "Edinburgh Goal Diggers"],
    [5, "09:50", "Upper Beginner", 1, "a", "KO", "Durham Dynamos", "Exeter Scribble"],
    [5, "09:50", "Upper Novice", 2, "c", "KO", "Durham Pole Dancers", "Harper Mother Chukkas"],
    [6, "10:02", "Upper Beginner", 1, "b", "KO", "Warwick UB", "UCL Beginner 1"],
    [6, "10:02", "Upper Novice", 2, "d", "KO", "Nott Another One", "Exeter Quadir"],
    [7, "10:15", "Upper Beginner", 1, "c", "AMT1", "Liverpool\'s 50 Shades of Bay", "Edinburgh Haggis Hoofers"],
    [7, "10:15", "Upper Novice Combined", 2, "a", "KO", "Blue Dragons", "Brookes Upper Nov"],
    [8, "10:27", "Upper Beginner", 1, "d", "AMT2", "Surrey Angels", "Harper Hold Your Horses"],
    [8, "10:27", "Upper Novice Combined", 2, "b", "AMT1", "The Flamingos", "HartDur Strikers"],
    [9, "10:40", "Upper Beginner", 1, "c", "AMT1", "Durham Dynamites", "Exeter Cielo"],
    [9, "10:40", "Upper Novice Combined", 2, "c", "KO", "Highland Hookers", "Harper/Keele Chukka Me Harder"],
    [10, "10:52", "Upper Beginner", 1, "d", "AMT2", "Cardiff Dragon These Balls", "Keele Cavaliers"],
    [10, "10:52", "Lower Novice", 2, "a", "KO", "Durham Die Hard", "Nott My First Rodeo"],
    [11, "11:05", "Median", 1, "b", "AMT1", "Winchester\'s Four Horsemen", "RVC/Brookes Median"],
    [11, "11:05", "Lower Novice", 2, "b", "AMT1", "Liv and Let Die", "NCL Neigh Way"],
    [12, "11:17", "Median", 1, "c", "KO", "NCL Angels of the North", "Hay there Delilah"],
    [12, "11:17", "Lower Novice", 2, "a", "AMT1", "RHUL Fruit Pastilles", "Birmingham Bucking Broncos"],
    [13, "11:30", "Beginner Combined A (7)", 1, "a", "KO", "ToonPool Trotters", "Leics Talk More Polo"],
    [13, "11:30", "Lower Novice", 2, "b", "AMT2", "Kensington Cavaliers", "Exeter Batman"],
    [14, "11:42", "Beginner Combined A (7)", 1, "b", "AMT1", "Egregious Fouls", "Southern MayoNeighs"],
    [14, "11:42", "Lower Inters", 2, "c", "KO", "Durham Degrees Pending", "Royally Chukked"],
    [15, "11:55", "Beginner Combined A (7)", 1, "c", "KO", "Man-drews Mavericks", "Mane Attraction"],
    [15, "11:55", "Lower Inters", 2, "a", "AMT1", "Notts Past and Present", "Brookes With Some Books"],
    [16, "12:07", "Beginner Combined B (6)", 1, "a", "AMT1", "Irn-Bruham", "Three Mares and a Spare"],
    [16, "12:07", "Lower Inters", 2, "b", "KO", "Glasgow Cambiasos", "Sun\'s Out Brums Out"],
    [17, "12:20", "Beginner Combined B (6)", 1, "b", "AMT2", "RVC/Brookes BC", "The Royal Mile High Club"],
    [17, "12:20", "Lower Novice Combined", 2, "c", "KO", "Royal Dragons", "Midlands Maniacs"],
    [18, "12:32", "Lower Beginner", 1, "c", "AMT2", "UCL Beginner 3", "Exeter Milo"],
    [18, "12:32", "Open", 2, "a", "AMT1", "Exeter Song", "Durham Double Time"],
    [19, "12:45", "Lower Beginner", 1, "d", "KO", "Durham Horsepower", "Nott Our First Rodeo"],
    [19, "12:45", "Open", 2, "b", "AMT1", "Loughborough", "Longchen"],
    [20, "12:57", "Lower Beginner", 1, "e", "AMT1", "Lboro Llamas", "Oxford B3"],
    [20, "12:57", "Open", 2, "c", "AMT1", "Durham Double Time", "Loughborough"],
    [21, "13:10", "Upper Beginner", 1, "e", "AMT1", "Liverpool\'s 50 Shades of Bay", "Exeter Dave"],
    [21, "13:10", "Open", 2, "d", "AMT1", "Exeter Song", "Longchen"],
    [22, "13:22", "Upper Beginner", 1, "f", "KO", "Win a", "Win b"],
    [22, "13:22", "Open", 2, "e", "AMT1", "Durham Double Time", "Longchen"],
    [23, "13:35", "Upper Beginner", 1, "h", "KO", "Loss a", "Loss b"],
    [23, "13:35", "Open", 2, "f", "AMT1", "Exeter Song", "Loughborough"],
    [24, "13:47", "Lower Beginner", 1, "f", "AMT2", "UCL Beginner 3", "Oxford B3A"],
    [24, "13:47", "Open", 2, "g", "KO", "1st AMT1", "2nd AMT1"],
    [25, "14:00", "Lower Beginner", 1, "g", "KO", "RHUL Saddled with Debt", "Kensington Knights"],
    [25, "14:00", "Open", 2, "h", "KO", "3rd AMT1", "4th AMT1"],
    [26, "14:12", "Median", 1, "d", "AMT1", "Winchester\'s Four Horsemen", "Cardiff Claws"],
    [26, "14:12", "Upper Novice", 2, "e", "KO", "Win a", "Win b"],
    [27, "14:25", "Median", 1, "f", "KO", "NCL Angels of the North", "Hay there Delilah"],
    [27, "14:25", "Upper Novice", 2, "g", "KO", "Loss a", "Loss b"],
    [28, "14:37", "Upper Beginner", 1, "e", "AMT1", "Durham Dynamites", "Oxford B1"],
    [28, "14:37", "Lower Novice Combined", 2, "d", "KO", "Glasgow/Nott Byres a Pony", "Hot Goal Summer"],
    [29, "14:50", "Upper Beginner", 1, "f", "KO", "Win a", "Win b"],
    [29, "14:50", "Lower Novice Combined", 2, "e", "KO", "Brookes Lower Nov", "War-Kings NC"],
    [30, "15:02", "Upper Beginner", 1, "h", "KO", "Loss a", "Loss b"],
    [30, "15:02", "Lower Novice Combined", 2, "f", "KO", "Loughborough/Winchester Hookers", "Warnotts NC"],
    [31, "15:15", "Lower Beginner", 1, "h", "AMT1", "UCL Beginner 4", "Oxford B3"],
    [31, "15:15", "Lower Novice", 2, "d", "AMT1", "Liv and Let Die", "Exeter Prada"],
    [32, "15:27", "Lower Beginner", 1, "j", "KO", "USTA East Fife Hookers", "Warwick LB"],
    [32, "15:27", "Lower Novice", 2, "c", "AMT1", "RHUL Fruit Pastilles", "Durham Desperadoes"],
    [33, "15:40", "Beginner Combined A (7)", 1, "e", "KO", "ToonPool Trotters", "Leics Talk More Polo"],
    [33, "15:40", "Lower Novice", 2, "d", "AMT2", "Kensington Cavaliers", "King Charlie\'s Angels"],
    [34, "15:52", "Lower Beginner", 1, "i", "AMT2", "Exeter Milo", "Oxford B3A"],
    [34, "15:52", "Upper Novice Combined", 2, "d", "AMT1", "The Flamingos", "Conroy Coalition"],
    [35, "16:05", "Beginner Combined A (7)", 1, "d", "AMT1", "Egregious Fouls", "RVC/York/Notts"],
    [35, "16:05", "Lower Novice Combined", 2, "g", "KO", "Win a", "Win b"],
    [36, "16:17", "Beginner Combined B (6)", 1, "c", "AMT1", "Irn-Bruham", "Get HAMmered"],
    [36, "16:17", "Lower Novice Combined", 2, "j", "KO", "Loss a", "Loss b"],
    [37, "16:30", "Beginner Combined B (6)", 1, "d", "AMT2", "RVC/Brookes BC", "Warnotts BC"],
    [37, "16:30", "Lower Inters", 2, "e", "KO", "Hungover Horsemen", "Grant\'s Gooners"],
    [38, "16:42", "Median", 1, "a", "KO", "Surrey Not Sorry", "Cambridge"],
    [38, "16:42", "Lower Inters", 2, "f", "AMT1", "Notts Past and Present", "Warnott Kings"],
    [39, "16:55", "Lower Inters", 2, "d", "KO", "BHC Polo", "Tartan Thunder"],
    [40, "17:07", "Lower Novice", 2, "c", "KO", "Edinburgh Loched and Loaded", "Harper Rein It In"],
  ],
  "Saturday 13th June": [
    [1, "09:00", "Upper Beginner", 1, "g", "AMT2", "Surrey Angels", "Nott Done Being Iconic"],
    [1, "09:00", "Lower Novice", 2, "f", "AMT2", "Exeter Batman", "King Charlie\'s Angels"],
    [2, "09:12", "Upper Beginner", 1, "i", "AMT1", "Edinburgh Haggis Hoofers", "Exeter Dave"],
    [2, "09:12", "Lower Novice", 2, "e", "AMT1", "Birmingham Bucking Broncos", "Durham Desperadoes"],
    [3, "09:25", "Upper Beginner", 1, "g", "AMT2", "Cardiff Dragon These Balls", "USTA Hook Her? I hardly know her"],
    [3, "09:25", "Lower Novice", 2, "e", "KO", "Durham Die Hard", "Nott My First Rodeo"],
    [4, "09:37", "Upper Beginner", 1, "i", "AMT1", "Exeter Cielo", "Oxford B1"],
    [4, "09:37", "Lower Novice", 2, "f", "KO", "Edinburgh Loched and Loaded", "Harper Rein It In"],
    [5, "09:50", "Lower Beginner", 1, "k", "KO", "Win a", "Win d"],
    [5, "09:50", "Lower Novice", 2, "g", "AMT1", "NCL Neigh Way", "Exeter Prada"],
    [6, "10:02", "Lower Beginner", 1, "l", "KO", "Win g", "Win j"],
    [6, "10:02", "Upper Novice Combined", 2, "e", "KO", "Blue Dragons", "Brookes Upper Nov"],
    [7, "10:15", "Lower Beginner", 1, "m", "KO", "Loss a", "Loss d"],
    [7, "10:15", "Upper Novice Combined", 2, "f", "KO", "Highland Hookers", "Harper/Keele Chukka Me Harder"],
    [8, "10:27", "Lower Beginner", 1, "n", "KO", "Loss g", "Loss j"],
    [8, "10:27", "Upper Novice Combined", 2, "g", "AMT1", "HartDur Strikers", "Conroy Coalition"],
    [9, "10:40", "Median", 1, "e", "KO", "Surrey Not Sorry", "Cambridge"],
    [9, "10:40", "Lower Inters", 2, "g", "KO", "Win b", "Win c"],
    [10, "10:52", "Median", 1, "g", "AMT1", "RVC/Brookes Median", "Cardiff Claws"],
    [10, "10:52", "Lower Inters", 2, "i", "KO", "Loss b", "Loss c"],
    [11, "11:05", "Upper Beginner", 1, "j", "AMT2", "Harper Hold Your Horses", "Nott Done Being Iconic"],
    [11, "11:05", "Lower Novice Combined", 2, "h", "KO", "Win c", "Win d"],
    [12, "11:17", "Beginner Combined A (7)", 1, "f", "KO", "Man-drews Mavericks", "Mane Attraction"],
    [12, "11:17", "Lower Novice Combined", 2, "k", "KO", "Loss c", "Loss d"],
    [13, "11:30", "Beginner Combined A (7)", 1, "g", "AMT1", "Southern MayoNeighs", "RVC/York/Notts"],
    [13, "11:30", "Upper Novice", 2, "f", "KO", "Win c", "Win d"],
    [14, "11:42", "Beginner Combined B (6)", 1, "e", "AMT1", "Three Mares and a Spare", "Get HAMmered"],
    [14, "11:42", "Upper Novice", 2, "h", "KO", "Loss c", "Loss d"],
    [15, "11:55", "Beginner Combined B (6)", 1, "f", "AMT2", "The Royal Mile High Club", "Warnotts BC"],
    [15, "11:55", "Lower Novice", 2, "h", "AMT2", "Win ae", "Win cf"],
    [16, "12:07", "Upper Beginner", 1, "j", "AMT2", "Keele Cavaliers", "USTA Hook Her? I hardly know her"],
    [16, "12:07", "Lower Novice", 2, "i", "KO", "Loss ae", "RU AMT1"],
    [17, "12:20", "Upper Beginner", 1, "k", "KO", "Win f", "Win AMT1"],
    [17, "12:20", "Lower Novice Combined", 2, "i", "KO", "Win e", "Win f"],
    [18, "12:32", "Upper Beginner", 1, "l", "KO", "Loss f", "Win AMT2"],
    [18, "12:32", "Lower Novice Combined", 2, "l", "KO", "Loss e", "Loss f"],
    [19, "12:45", "Upper Beginner", 1, "k", "KO", "Win f", "Win AMT1"],
    [19, "12:45", "Lower Novice", 2, "g", "KO", "Win AMT1", "Win AMT2"],
    [20, "12:57", "Upper Beginner", 1, "l", "KO", "Loss f", "Win AMT2"],
    [20, "12:57", "Lower Novice", 2, "h", "KO", "RU AMT1", "RU AMT2"],
    [21, "13:10", "Lower Beginner", 1, "o", "KO", "Win k", "Win AMT1"],
    [21, "13:10", "Lower Inters", 2, "h", "KO", "Win d", "Win e"],
    [22, "13:22", "Lower Beginner", 1, "p", "KO", "Win l", "Win AMT2"],
    [22, "13:22", "Lower Inters", 2, "j", "KO", "Loss d", "Loss e"],
    [23, "13:35", "Lower Beginner", 1, "q", "KO", "Loss k", "RU AMT1"],
    [23, "13:35", "Lower Inters", 2, "k", "AMT1", "Brookes With Some Books", "Warnott Kings"],
    [24, "13:47", "Lower Beginner", 1, "r", "KO", "Loss l", "RU AMT2"],
    [24, "13:47", "Upper Inters", 2, "a", "AMT1", "Exeter Warwick", "Lboro Lions"],
    [25, "14:00", "Median", 1, "h", "AMT2", "Win ae", "Win cf"],
    [25, "14:00", "Upper Inters", 2, "b", "AMT1", "Cowboy Casanovas", "UCL Upper Intermediate"],
    [26, "14:12", "Median", 1, "i", "KO", "Loss ae", "RU AMT1"],
    [26, "14:12", "Lower Novice Combined", 2, "m", "AMT1", "Win g", "Win h"],
    [27, "14:25", "Beginner Combined A (7)", 1, "i", "KO", "Loss ae", "RU AMT1"],
    [27, "14:25", "Lower Novice Combined", 2, "n", "AMT2", "Loss g", "Loss h"],
    [28, "14:37", "Beginner Combined A (7)", 1, "h", "AMT2", "Win ae", "Win cf"],
    [28, "14:37", "Upper Inters", 2, "c", "AMT1", "Lboro Lions", "Cowboy Casanovas"],
    [29, "14:50", "Beginner Combined B (6)", 1, "g", "KO", "Win AMT1", "Win AMT2"],
    [29, "14:50", "Upper Inters", 2, "d", "AMT1", "Exeter Warwick", "UCL Upper Intermediate"],
    [30, "15:02", "Beginner Combined B (6)", 1, "h", "KO", "RU AMT1", "RU AMT2"],
    [30, "15:02", "Lower Inters", 2, "l", "KO", "Loss g", "Win i"],
    [31, "15:15", "Upper Beginner", 1, "m", "AMT3", "RU AMT1", "RU AMT2"],
    [31, "15:15", "Lower Inters", 2, "n", "KO", "Win g", "Win AMT1"],
    [32, "15:27", "Upper Beginner", 1, "n", "AMT4", "Loss AMT1", "Loss AMT2"],
    [32, "15:27", "Upper Novice", 2, "i", "KO", "Win e", "Win f"],
    [33, "15:40", "Upper Beginner", 1, "m", "AMT3", "RU AMT1", "RU AMT2"],
    [33, "15:40", "Upper Novice", 2, "j", "KO", "Loss e", "Loss f"],
    [34, "15:52", "Upper Beginner", 1, "n", "AMT4", "Loss AMT1", "Loss AMT2"],
    [34, "15:52", "Lower Inters", 2, "m", "KO", "Loss h", "Win j"],
    [35, "16:05", "Lower Beginner", 1, "s", "KO", "Win m", "Loss AMT1"],
    [35, "16:05", "Lower Inters", 2, "o", "KO", "Win h", "RU AMT1"],
    [36, "16:17", "Upper Novice Combined", 2, "h", "AMT2", "Win ae", "Win cf"],
    [37, "16:30", "Upper Novice Combined", 2, "i", "KO", "Loss ae", "RU AMT1"],
    [38, "16:42", "Lower Novice Combined", 2, "o", "AMT3", "Win j", "Win k"],
    [39, "16:55", "Lower Novice Combined", 2, "p", "AMT4", "Loss j", "Loss k"],
  ],
  "Sunday 14th June": [
    [1, "09:00", "Median", 1, "j", "AMT2", "Win ae", "Win AMT1"],
    [1, "09:00", "Upper Novice", 2, "k", "KO", "Win g", "Win h"],
    [2, "09:12", "Upper Beginner", 1, "o", "AMT3", "RU AMT1", "Win h"],
    [2, "09:12", "Upper Novice", 2, "l", "KO", "Loss g", "Loss h"],
    [3, "09:25", "Upper Beginner", 1, "p", "AMT4", "Loss AMT1", "Loss h"],
    [3, "09:25", "Lower Novice", 2, "j", "AMT2", "Win ae", "Win AMT1"],
    [4, "09:37", "Upper Beginner", 1, "o", "AMT3", "RU AMT1", "Win h"],
    [4, "09:37", "Lower Novice", 2, "k", "KO", "Loss cf", "Loss AMT1"],
    [5, "09:50", "Upper Beginner", 1, "p", "AMT4", "Loss AMT1", "Loss h"],
    [5, "09:50", "Lower Novice", 2, "i", "KO", "Loss AMT1", "Loss AMT2"],
    [6, "10:02", "Lower Beginner", 1, "t", "KO", "Win n", "Loss AMT2"],
    [6, "10:02", "Lower Novice", 2, "j", "KO", "Win AMT1", "Win AMT2"],
    [7, "10:15", "Lower Beginner", 1, "u", "KO", "Loss m", "Loss n"],
    [7, "10:15", "Lower Inters", 2, "p", "AMT2", "Loss AMT1", "Loss i"],
    [8, "10:27", "Lower Beginner", 1, "v", "KO", "Win o", "Win p"],
    [8, "10:27", "Lower Inters", 2, "q", "KO", "Loss l", "Loss m"],
    [9, "10:40", "Lower Beginner", 1, "w", "KO", "Win q", "Win r"],
    [9, "10:40", "Lower Inters", 2, "r", "KO", "Win l", "Win m"],
    [10, "10:52", "Median", 1, "k", "KO", "Loss cf", "Loss AMT1"],
    [10, "10:52", "Upper Novice Combined", 2, "j", "AMT2", "Win ae", "Win AMT1"],
    [11, "11:05", "Median", 1, "l", "AMT2", "Win cf", "Win AMT1"],
    [11, "11:05", "Upper Novice Combined", 2, "k", "KO", "Loss cf", "Loss AMT1"],
    [12, "11:17", "Beginner Combined A (7)", 1, "j", "AMT2", "Win ae", "Win AMT1"],
    [12, "11:17", "Upper Novice", 2, "m", "KO", "Win e", "Win f"],
    [13, "11:30", "Beginner Combined A (7)", 1, "k", "KO", "Loss cf", "Loss AMT1"],
    [13, "11:30", "Upper Novice", 2, "n", "KO", "Loss e", "Loss f"],
    [14, "11:42", "Beginner Combined A (7)", 1, "l", "AMT2", "Win cf", "Win AMT1"],
    [14, "11:42", "Lower Novice", 2, "l", "AMT2", "Win cf", "Win AMT1"],
    [15, "11:55", "Beginner Combined B (6)", 1, "i", "KO", "Loss AMT1", "Loss AMT2"],
    [15, "11:55", "Lower Novice", 2, "m", "KO", "Win i", "Win k"],
    [16, "12:07", "Beginner Combined B (6)", 1, "j", "KO", "Win AMT1", "Win AMT2"],
    [16, "12:07", "Lower Novice", 2, "n", "KO", "Loss i", "Loss k"],
    [17, "12:20", "Upper Beginner", 1, "q", "AMT3", "RU AMT2", "Win h"],
    [17, "12:20", "Lower Novice", 2, "k", "KO", "RU AMT1", "RU AMT2"],
    [18, "12:32", "Upper Beginner", 1, "r", "AMT4", "Loss AMT2", "Loss h"],
    [18, "12:32", "Lower Novice", 2, "l", "KO", "Loss AMT1", "Loss AMT2"],
    [19, "12:45", "Upper Beginner", 1, "q", "AMT3", "RU AMT2", "Win h"],
    [19, "12:45", "Upper Inters", 2, "e", "AMT1", "Lboro Lions", "UCL Upper Intermediate"],
    [20, "12:57", "Upper Beginner", 1, "r", "AMT4", "Loss AMT2", "Loss h"],
    [20, "12:57", "Upper Inters", 2, "f", "AMT1", "Exeter Warwick", "Cowboy Casanovas"],
    [21, "13:10", "Lower Beginner", 1, "x", "KO", "Win s", "Win t"],
    [21, "13:10", "Lower Inters", 2, "s", "AMT2", "Loss AMT1", "Loss j"],
    [22, "13:22", "Lower Beginner", 1, "y", "KO", "Loss o", "Loss p"],
    [22, "13:22", "Lower Novice Combined", 2, "q", "AMT1", "Win g", "Win i"],
    [23, "13:35", "Lower Beginner", 1, "z", "KO", "Loss q", "Loss r"],
    [23, "13:35", "Lower Novice Combined", 2, "r", "AMT2", "Loss g", "Loss i"],
    [24, "13:47", "Upper Beginner", 1, "s", "KO", "Loss k", "Loss l"],
    [24, "13:47", "Lower Novice Combined", 2, "s", "AMT3", "Win j", "Win l"],
    [25, "14:00", "Upper Beginner", 1, "t", "KO", "Win k", "Win l"],
    [25, "14:00", "Lower Novice Combined", 2, "t", "AMT4", "Loss j", "Loss l"],
    [26, "14:12", "Upper Beginner", 1, "s", "KO", "Loss k", "Loss l"],
    [26, "14:12", "Upper Inters", 2, "g", "KO", "1st AMT1", "2nd AMT1"],
    [27, "14:25", "Upper Beginner", 1, "t", "KO", "Win k", "Win l"],
    [27, "14:25", "Upper Inters", 2, "h", "KO", "3rd AMT1", "4th AMT1"],
    [28, "14:37", "Lower Beginner", 1, "ai", "KO", "Loss s", "Loss t"],
    [28, "14:37", "Lower Inters", 2, "t", "KO", "Loss n", "Loss o"],
    [29, "14:50", "Lower Beginner", 1, "bi", "KO", "Loss m", "Loss n"],
    [29, "14:50", "Lower Inters", 2, "u", "KO", "Win n", "Win o"],
    [30, "15:02", "Median", 1, "m", "KO", "Win i", "Win k"],
    [30, "15:02", "Lower Inters", 2, "v", "AMT2", "Loss i", "Loss j"],
    [31, "15:15", "Median", 1, "n", "KO", "Loss i", "Loss k"],
    [31, "15:15", "Upper Novice", 2, "o", "KO", "Win g", "Win h"],
    [32, "15:27", "Beginner Combined A (7)", 1, "m", "KO", "Win i", "Win k"],
    [32, "15:27", "Upper Novice", 2, "p", "KO", "Loss g", "Loss h"],
    [33, "15:40", "Beginner Combined A (7)", 1, "n", "KO", "Loss i", "Loss k"],
    [33, "15:40", "Upper Novice Combined", 2, "l", "AMT2", "Win cf", "Win AMT1"],
    [34, "15:02", "Beginner Combined B (6)", 1, "k", "KO", "RU AMT1", "RU AMT2"],
    [34, "15:52", "Upper Novice Combined", 2, "m", "KO", "Win i", "Win k"],
    [35, "15:15", "Beginner Combined B (6)", 1, "l", "KO", "Loss AMT1", "Loss AMT2"],
    [35, "16:05", "Upper Novice Combined", 2, "n", "KO", "Loss i", "Loss k"],
    [36, "16:17", "Lower Novice Combined", 2, "u", "AMT1", "Win h", "Win i"],
    [37, "16:30", "Lower Novice Combined", 2, "v", "AMT2", "Loss h", "Loss i"],
    [38, "16:42", "Lower Novice Combined", 2, "w", "AMT3", "Win k", "Win l"],
    [39, "16:55", "Lower Novice Combined", 2, "x", "AMT4", "Loss k", "Loss l"],
  ],
};

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Badge({ children, color = "#94a3b8" }) {
  return (
    <span style={{
      background: color + "22", color, border: "1px solid " + color + "44",
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: 1, textTransform: "uppercase",
    }}>{children}</span>
  );
}

function Btn({ children, onClick, variant = "primary", small, danger, disabled, full, style }) {
  const bg = danger ? "#dc2626" : variant === "primary" ? "#16a34a" : "#1e293b";
  const border = danger ? "#dc2626" : variant === "primary" ? "#16a34a" : "#334155";
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }} disabled={disabled} style={{
      background: disabled ? "#1e293b" : bg, color: disabled ? "#475569" : "#fff",
      border: "1px solid " + (disabled ? "#334155" : border),
      borderRadius: 6, padding: small ? "4px 10px" : "8px 16px",
      fontSize: small ? 12 : 14, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      whiteSpace: "nowrap", width: full ? "100%" : "auto", ...style,
    }}>{children}</button>
  );
}

function Input({ value, onChange, placeholder, type = "text", style }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={{
        background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
        color: "#f1f5f9", padding: "8px 12px", fontSize: 14, outline: "none",
        width: "100%", boxSizing: "border-box", ...style,
      }} />
  );
}

function Select({ value, onChange, children, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
      color: "#f1f5f9", padding: "8px 12px", fontSize: 14, outline: "none", width: "100%", ...style,
    }}>{children}</select>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  );
}

// ── Branch colour ─────────────────────────────────────────────────────────────
function branchStyle(branch) {
  if (branch === "confirmed") return { border: "#334155", bg: "#1e293b", label: null };
  if (branch === "win") return { border: "#16a34a", bg: "#14532d", label: "WIN PATH" };
  if (branch === "loss") return { border: "#dc2626", bg: "#450a0a", label: "LOSS PATH" };
  return { border: "#334155", bg: "#1e293b", label: branch?.toUpperCase() };
}

// ── Roster Manager ────────────────────────────────────────────────────────────
function RosterManager({ roster, onChange }) {
  const [name, setName] = useState("");
  const [max, setMax] = useState("4");

  function add() {
    if (!name.trim()) return;
    onChange([...roster, { id: uid(), name: name.trim(), maxChukkas: parseInt(max) || 4 }]);
    setName(""); setMax("4");
  }

  function recoverFromLegacy() {
    const legacyKeys = ["supa-allocator-v3", "supa-allocator-v2", "supa-allocator-data"];
    for (const key of legacyKeys) {
      try {
        const legacy = localStorage.getItem(key);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (parsed.roster && parsed.roster.length > 0) {
            onChange(parsed.roster);
            alert("✓ Recovered " + parsed.roster.length + " ponies from previous version");
            return;
          }
        }
      } catch {}
    }
    alert("No roster data found in previous versions");
  }

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 4px" }}>Pony Roster</h2>
      <p style={{ color: "#475569", fontSize: 12, margin: "0 0 16px" }}>Your full string — select attending ponies per event</p>
      {roster.length === 0 && (
        <div style={{ background: "#422006", border: "1px solid #d97706", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <p style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13, margin: "0 0 6px" }}>⚠ Roster appears empty</p>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 10px" }}>If you had ponies in a previous version, tap below to recover them.</p>
          <Btn onClick={recoverFromLegacy}>Recover from previous version</Btn>
        </div>
      )}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input value={name} onChange={setName} placeholder="Pony name" style={{ flex: 2, minWidth: 120 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>Max</span>
            <select value={max} onChange={e => setMax(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#f1f5f9", padding: "8px", fontSize: 13 }}>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <Btn onClick={add}>Add</Btn>
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {roster.map(h => (
          <Card key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
            <span style={{ flex: 1, color: "#f1f5f9", fontWeight: 600, fontSize: 15 }}>{h.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#64748b", fontSize: 12 }}>Max</span>
              <select value={h.maxChukkas} onChange={e => onChange(roster.map(x => x.id === h.id ? { ...x, maxChukkas: parseInt(e.target.value) } : x))}
                style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#f1f5f9", padding: "4px 8px", fontSize: 13 }}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <Btn small danger onClick={() => onChange(roster.filter(x => x.id !== h.id))}>✕</Btn>
          </Card>
        ))}
        {roster.length === 0 && <p style={{ color: "#475569", textAlign: "center", fontSize: 14 }}>No ponies in roster yet</p>}
      </div>
    </div>
  );
}

// ── June 2026 team data ───────────────────────────────────────────────────────
const JUNE_2026_TEAMS = [
  { name: "Surrey Angels", division: "Beginner", players: [
    { name: "Katya Williamson", division: "Beginner" },
    { name: "Ella Sidlow", division: "Beginner" },
    { name: "Maisie Filler", division: "Beginner" },
    { name: "Anwen Powell", division: "Beginner" },
  ]},
  { name: "Surrey Not Sorry", division: "Median", players: [
    { name: "George Saunders", division: "Median" },
    { name: "Hannah Chipling", division: "Median" },
    { name: "Sid Madhu", division: "Median" },
    { name: "Poppy Barnhurst", division: "Median" },
  ]},
  { name: "Surrey Stallions", division: "Novice", players: [
    { name: "Charlotte Stead", division: "Novice" },
    { name: "Bashir Dalhatu", division: "Novice" },
    { name: "Kara Hall", division: "Novice" },
    { name: "Freya Scaddan", division: "Novice" },
  ]},
  { name: "Conroy Coalition", division: "Novice", players: [
    { name: "Sophie Lea", division: "Novice" },
    { name: "Molly Weymouth", division: "Novice" },
    { name: "Julian Peplow", division: "Novice" },
    { name: "Benjamin Elliott", division: "Novice" },
  ]},
  { name: "Kensington Knights", division: "Beginner", players: [
    { name: "Daniel Hurst", division: "Beginner" },
    { name: "Mara-Sophie Molzahn", division: "Beginner" },
    { name: "Georgina Lockwood", division: "Beginner" },
    { name: "Michel Noumair", division: "Beginner" },
  ]},
  { name: "Kensington Cavaliers", division: "Novice", players: [
    { name: "Paula Buhring-Uhle", division: "Novice" },
    { name: "Martha Charlton", division: "Novice" },
    { name: "Sophie-Marie Pasewald", division: "Novice" },
    { name: "Ryaan Sultan", division: "Novice" },
  ]},
  { name: "Reining Kings", division: "Beginner", players: [
    { name: "Amira Ravshanova", division: "Beginner" },
    { name: "Alia Mohammed Almazrouei", division: "Beginner" },
    { name: "Mirza Daaniyal Ahmad", division: "Beginner" },
    { name: "Mateo Jesalva", division: "Beginner" },
  ]},
  { name: "King Charlie's Angels", division: "Novice", players: [
    { name: "Molly Coghlan", division: "Novice" },
    { name: "Valentina Pozzi", division: "Novice" },
    { name: "Jessica Croxford", division: "Novice" },
    { name: "Diana Reed", division: "Novice" },
  ]},
];

// ── Welfare rules editor ──────────────────────────────────────────────────────
function WelfareRulesEditor({ welfareRules, onChange }) {
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#0f172a", borderRadius: 6, padding: 10 }}>
          <p style={{ color: "#4ade80", fontSize: 11, margin: 0, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Hard rule — always enforced</p>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: "4px 0 0" }}>Minimum 1 chukka gap. No back-to-back ever.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Bandages off (chukkas)</p>
            <input type="number" min="1" max="10" value={welfareRules.bandagesOnly}
              onChange={e => onChange({ ...welfareRules, bandagesOnly: parseInt(e.target.value) || 3 })}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "8px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Fully untack (chukkas)</p>
            <input type="number" min="1" max="10" value={welfareRules.fullyUntack}
              onChange={e => onChange({ ...welfareRules, fullyUntack: parseInt(e.target.value) || 5 })}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "8px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }} />
          </div>
        </div>
        <p style={{ color: "#475569", fontSize: 11, margin: 0, lineHeight: 1.8 }}>
          1–{Math.max(1, welfareRules.bandagesOnly - 1)} rest → <span style={{ color: "#f87171" }}>BACK SOON</span> ·{" "}
          {welfareRules.bandagesOnly}–{Math.max(welfareRules.bandagesOnly, welfareRules.fullyUntack - 1)} → <span style={{ color: "#fbbf24" }}>BANDAGES OFF</span> ·{" "}
          {welfareRules.fullyUntack}+ → <span style={{ color: "#60a5fa" }}>FULLY UNTACK</span>
        </p>
      </div>
    </Card>
  );
}

// ── Delete with inline confirmation ──────────────────────────────────────────
function DeleteButton({ label, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 8, padding: 14 }}>
      <p style={{ color: "#f87171", fontWeight: 700, fontSize: 14, margin: "0 0 12px", textAlign: "center" }}>
        {label} — cannot be undone
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setConfirming(false)} style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={onDelete} style={{ flex: 1, background: "#dc2626", border: "1px solid #dc2626", borderRadius: 6, color: "#fff", padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Yes, Delete</button>
      </div>
    </div>
  ) : (
    <button onClick={() => setConfirming(true)} style={{ background: "#1e293b", border: "1px solid #dc2626", borderRadius: 8, color: "#f87171", padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>
      {label}
    </button>
  );
}


// ── Roster Manager ────────────────────────────────────────────────────────────

// ── New Event Wizard ──────────────────────────────────────────────────────────
function NewEventWizard({ roster, onSave, onCancel }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [selectedHorseIds, setSelectedHorseIds] = useState([]);
  const [teams, setTeams] = useState([]);
  const [juneImported, setJuneImported] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [activeTeam, setActiveTeam] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [playerDiv, setPlayerDiv] = useState("Beginner");

  function importJuneTeams() {
    const imported = JUNE_2026_TEAMS.map(t => ({
      id: uid(), name: t.name,
      players: t.players.map(p => ({ id: uid(), name: p.name, division: p.division, preferences: [] }))
    }));
    setTeams(imported);
    setJuneImported(true);
    setActiveTeam(imported[0]?.id || null);
  }

  function addTeam() {
    if (!teamName.trim()) return;
    const t = { id: uid(), name: teamName.trim(), players: [] };
    setTeams(prev => [...prev, t]);
    setTeamName(""); setActiveTeam(t.id);
  }

  function addPlayer() {
    if (!playerName.trim() || !activeTeam) return;
    setTeams(prev => prev.map(t => t.id === activeTeam ? {
      ...t, players: [...t.players, { id: uid(), name: playerName.trim(), division: playerDiv, preferences: [] }]
    } : t));
    setPlayerName("");
  }

  function createEvent() {
    onSave({
      id: uid(), name: name.trim() || "New Event", date,
      createdAt: new Date().toISOString(),
      horses: roster.filter(h => selectedHorseIds.includes(h.id)),
      teams, days: [],
      welfareRules: { bandagesOnly: 3, fullyUntack: 5 },
    });
  }

  const active = teams.find(t => t.id === activeTeam);

  return (
    <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {["Details", "Ponies", "Teams"].map((label, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 3, borderRadius: 2, marginBottom: 4, background: step > i ? "#16a34a" : step === i+1 ? "#3b82f6" : "#1e293b" }} />
            <span style={{ color: step === i+1 ? "#f1f5f9" : "#475569", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 16px" }}>New Event</h2>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Event name</p>
                <Input value={name} onChange={setName} placeholder="e.g. SUPA Summer Nationals 2026" />
              </div>
              <div>
                <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Date (first day)</p>
                <Input value={date} onChange={setDate} type="date" />
              </div>
            </div>
          </Card>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
            <Btn onClick={() => setStep(2)} disabled={!name.trim()} style={{ flex: 1 }}>Next — Ponies →</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 4px" }}>Select attending ponies</h2>
          <p style={{ color: "#475569", fontSize: 12, margin: "0 0 16px" }}>{selectedHorseIds.length} selected</p>
          {roster.length === 0 ? (
            <Card><p style={{ color: "#475569", fontSize: 14, textAlign: "center", margin: 0 }}>No ponies in roster yet — add them first.</p></Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {roster.map(h => {
                const sel = selectedHorseIds.includes(h.id);
                return (
                  <button key={h.id} onClick={() => setSelectedHorseIds(prev => sel ? prev.filter(x => x !== h.id) : [...prev, h.id])}
                    style={{ background: sel ? "#14532d" : "#1e293b", border: "2px solid " + (sel ? "#16a34a" : "#334155"), borderRadius: 10, padding: "14px 12px", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: sel ? "#16a34a" : "#0f172a", border: "2px solid " + (sel ? "#16a34a" : "#334155"), display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {sel && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                      </div>
                      <div>
                        <p style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14, margin: 0 }}>{h.name}</p>
                        <p style={{ color: "#475569", fontSize: 11, margin: 0 }}>Max {h.maxChukkas}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={() => setStep(1)}>← Back</Btn>
            <Btn onClick={() => setStep(3)} style={{ flex: 1 }}>Next — Teams →</Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 16px" }}>Teams & Players</h2>
          {!juneImported && (
            <div style={{ background: "#14532d22", border: "1px solid #16a34a44", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <p style={{ color: "#4ade80", fontWeight: 700, fontSize: 13, margin: "0 0 4px" }}>Summer Nationals 2026 — 8 teams · 32 players</p>
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 10px" }}>From official SUPA team sheet</p>
              <button onClick={() => importJuneTeams()} style={{ background: "#16a34a", border: "none", borderRadius: 8, color: "#fff", padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" }}>
                ⚡ Import June 2026 Teams
              </button>
            </div>
          )}
          {juneImported && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 10, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b", fontSize: 12 }}>✓ June 2026 teams imported</span>
              <button onClick={() => { setJuneImported(false); setTeams([]); }} style={{ background: "none", border: "none", color: "#475569", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Re-import</button>
            </div>
          )}
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={teamName} onChange={setTeamName} placeholder="Add team manually" />
              <Btn onClick={addTeam}>Add</Btn>
            </div>
          </Card>
          {teams.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {teams.map(t => (
                  <button key={t.id} onClick={() => setActiveTeam(t.id)} style={{ background: activeTeam === t.id ? "#16a34a" : "#1e293b", border: "1px solid " + (activeTeam === t.id ? "#16a34a" : "#334155"), borderRadius: 6, color: "#f1f5f9", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {t.name} ({t.players.length})
                  </button>
                ))}
              </div>
              {active && (
                <Card style={{ marginBottom: 16 }}>
                  <p style={{ color: "#f1f5f9", fontWeight: 600, margin: "0 0 10px" }}>{active.name}</p>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <Input value={playerName} onChange={setPlayerName} placeholder="Player name" style={{ flex: 2, minWidth: 120 }} />
                    <Select value={playerDiv} onChange={setPlayerDiv} style={{ flex: 1, minWidth: 100 }}>
                      {DIVISIONS.map(d => <option key={d}>{d}</option>)}
                    </Select>
                    <Btn onClick={addPlayer}>Add</Btn>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {active.players.map(p => (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0f172a", borderRadius: 6, padding: "6px 10px" }}>
                        <span style={{ color: "#f1f5f9", flex: 1, fontSize: 13 }}>{p.name}</span>
                        <Badge color={DIV_COLOR[p.division]}>{p.division}</Badge>
                        <Btn small danger onClick={() => setTeams(prev => prev.map(t => t.id === active.id ? { ...t, players: t.players.filter(x => x.id !== p.id) } : t))}>✕</Btn>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={() => setStep(2)}>← Back</Btn>
            <Btn onClick={createEvent} style={{ flex: 1 }}>✓ Create Event</Btn>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Horse Timeline Modal ──────────────────────────────────────────────────────
function HorseTimelineModal({ horse, allChukkas, assignments, teams, welfareRules, onClose }) {
  const WELFARE_COLOR = { DONE: "#4ade80", UNTACK: "#60a5fa", BANDAGES: "#fbbf24", READY: "#f87171" };

  // Find all chukkas this horse is assigned to
  const timeline = [];
  for (const chukka of allChukkas.sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0))) {
    for (const playerId of (chukka.playerIds || [])) {
      const a = assignments[chukka.id]?.[playerId];
      if (a?.horseId === horse.id) {
        const team = teams.find(t => t.id === chukka.teamId);
        const player = team?.players.find(p => p.id === playerId);
        timeline.push({ chukka, player, team, welfare: a.welfare, gapChukkas: a.gapChukkas });
      }
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ background: "#0f172a", borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "80vh", overflow: "auto", padding: 20 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h3 style={{ color: "#f1f5f9", fontSize: 18, margin: 0 }}>{horse.name}</h3>
            <p style={{ color: "#475569", fontSize: 12, margin: "2px 0 0" }}>
              {timeline.length}/{horse.maxChukkas} chukkas today
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", fontSize: 24, cursor: "pointer" }}>✕</button>
        </div>

        {timeline.length === 0 ? (
          <p style={{ color: "#475569", textAlign: "center", padding: "20px 0" }}>Not assigned to any chukkas today</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {timeline.map(({ chukka, player, team, welfare, gapChukkas }, i) => {
              const prevChukkaNum = i > 0 ? parseInt(timeline[i-1].chukka.chukkaNum) || 0 : null;
              const thisNum = parseInt(chukka.chukkaNum) || 0;
              const restSince = prevChukkaNum !== null ? thisNum - prevChukkaNum - 1 : null;

              return (
                <div key={chukka.id}>
                  {restSince !== null && (
                    <div style={{ textAlign: "center", padding: "4px 0", color: "#475569", fontSize: 11 }}>
                      ↕ {restSince} chukka{restSince !== 1 ? "s" : ""} rest
                    </div>
                  )}
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ textAlign: "center", minWidth: 36 }}>
                      <p style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 18, margin: 0, lineHeight: 1 }}>{chukka.chukkaNum}</p>
                      <p style={{ color: "#475569", fontSize: 9, margin: 0, textTransform: "uppercase" }}>chu</p>
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14, margin: 0 }}>{player?.name}</p>
                      <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>{team?.name} · {chukka.time}</p>
                    </div>
                    {welfare && (
                      <span style={{ background: WELFARE_COLOR[welfare.code] + "22", color: WELFARE_COLOR[welfare.code], border: "1px solid " + WELFARE_COLOR[welfare.code] + "44", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                        {welfare.code}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Gaps analysis */}
        <div style={{ marginTop: 16, background: "#1e293b", borderRadius: 8, padding: 12 }}>
          <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Available gaps today</p>
          {(() => {
            const usedNums = timeline.map(x => parseInt(x.chukka.chukkaNum) || 0).sort((a,b) => a-b);
            if (usedNums.length === 0) return <p style={{ color: "#4ade80", fontSize: 12, margin: 0 }}>Available all day</p>;
            if (usedNums.length >= horse.maxChukkas) return <p style={{ color: "#f87171", fontSize: 12, margin: 0 }}>At maximum chukkas for today</p>;
            return <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
              Used: chukka{usedNums.length > 1 ? "s" : ""} {usedNums.join(", ")} · {horse.maxChukkas - usedNums.length} slot{horse.maxChukkas - usedNums.length !== 1 ? "s" : ""} remaining
            </p>;
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Assignment picker ─────────────────────────────────────────────────────────
function AssignmentPicker({ chukka, playerId, playerName, currentHorseId, horses, allChukkas, allAssignments, welfareRules, onAssign, onClose }) {
  const available = horses.filter(h => h.unavailable !== true);
  const thisNum = parseInt(chukka.chukkaNum) || 0;

  // For each horse, check if it can be used at this chukka
  function getHorseStatus(horse) {
    // Count current uses excluding this slot
    const uses = [];
    for (const c of allChukkas) {
      if (c.id === chukka.id) continue;
      for (const pid of (c.playerIds || [])) {
        if (pid === playerId) continue;
        const a = allAssignments[c.id]?.[pid];
        if (a?.horseId === horse.id) {
          uses.push(parseInt(c.chukkaNum) || 0);
        }
      }
    }
    // Also include current assignment if locked to this horse by someone else
    if (uses.length >= horse.maxChukkas) return { ok: false, reason: `At max ${horse.maxChukkas}` };
    for (const used of uses) {
      if (Math.abs(used - thisNum) < 2) return { ok: false, reason: `Used at chukka ${used} (1 rest needed)` };
    }
    return { ok: true };
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ background: "#0f172a", borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "70vh", overflow: "auto", padding: 20 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ color: "#f1f5f9", fontSize: 16, margin: 0 }}>Assign horse</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", fontSize: 24, cursor: "pointer" }}>✕</button>
        </div>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>{playerName} · Chukka {chukka.chukkaNum}</p>

        {/* Auto option */}
        <button onClick={() => onAssign(null)} style={{
          width: "100%", background: currentHorseId === null ? "#1e3a5f" : "#1e293b",
          border: "1px solid " + (currentHorseId === null ? "#3b82f6" : "#334155"),
          borderRadius: 8, padding: "12px 16px", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        }}>
          <span style={{ color: "#93c5fd", fontSize: 18 }}>⚡</span>
          <div style={{ textAlign: "left" }}>
            <p style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14, margin: 0 }}>Auto (engine decides)</p>
            <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>Remove manual lock</p>
          </div>
          {currentHorseId === null && <span style={{ marginLeft: "auto", color: "#3b82f6", fontSize: 14 }}>✓</span>}
        </button>

        {/* Horse options */}
        {available.map(horse => {
          const status = getHorseStatus(horse);
          const isCurrent = currentHorseId === horse.id;
          return (
            <button key={horse.id} onClick={() => status.ok && onAssign(horse.id)} style={{
              width: "100%", background: isCurrent ? "#14532d" : status.ok ? "#1e293b" : "#0f172a",
              border: "1px solid " + (isCurrent ? "#16a34a" : status.ok ? "#334155" : "#1e293b"),
              borderRadius: 8, padding: "12px 16px", marginBottom: 6,
              display: "flex", alignItems: "center", gap: 10,
              cursor: status.ok ? "pointer" : "not-allowed", opacity: status.ok ? 1 : 0.5,
            }}>
              <div style={{ flex: 1, textAlign: "left" }}>
                <p style={{ color: status.ok ? "#f1f5f9" : "#475569", fontWeight: 600, fontSize: 14, margin: 0 }}>{horse.name}</p>
                {!status.ok && <p style={{ color: "#f87171", fontSize: 11, margin: 0 }}>{status.reason}</p>}
              </div>
              {isCurrent && <span style={{ color: "#4ade80", fontSize: 14 }}>🔒</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Scheduling pressure analysis ─────────────────────────────────────────────
// Detects when back-to-back chukkas create genuine horse shortages
// independent of preference lists — i.e. the schedule itself is the problem
function analyseSchedulePressure(allChukkas, assignments, horses, conflicts) {
  if (conflicts.length === 0) return [];

  const available = horses.filter(h => h.unavailable !== true);
  const pressureAlerts = [];

  const conflictedChukkaIds = new Set(conflicts.map(c => c.chukkaId));
  const sorted = [...allChukkas].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));

  // Group all chukkas by chukka number — multiple teams can share a number
  const byNum = {};
  for (const c of sorted) {
    const n = parseInt(c.chukkaNum) || 0;
    if (!byNum[n]) byNum[n] = [];
    byNum[n].push(c);
  }

  // For each conflicted chukka, check if adjacent chukka numbers used too many horses
  const checkedNums = new Set();
  for (const chukka of sorted) {
    if (!conflictedChukkaIds.has(chukka.id)) continue;
    const thisNum = parseInt(chukka.chukkaNum) || 0;
    if (checkedNums.has(thisNum)) continue;
    checkedNums.add(thisNum);

    // Collect ALL chukkas at adjacent numbers (±1) — could be multiple teams
    const adjacentNums = [thisNum - 1, thisNum + 1].filter(n => byNum[n]);
    if (adjacentNums.length === 0) continue;

    const adjacentChukkas = adjacentNums.flatMap(n => byNum[n]);

    // All horses used across all adjacent chukkas are on rest
    const horsesOnRest = new Set();
    for (const adj of adjacentChukkas) {
      for (const playerId of (adj.playerIds || [])) {
        const a = assignments[adj.id]?.[playerId];
        if (a?.horseId) horsesOnRest.add(a.horseId);
      }
    }

    if (horsesOnRest.size === 0) continue;

    // How many players at THIS chukka number still need a horse
    const allAtThisNum = byNum[thisNum] || [];
    const horsesNeeded = allAtThisNum.reduce((n, c) => {
      return n + (c.playerIds || []).filter(pid => !assignments[c.id]?.[pid]?.horseId).length;
    }, 0);

    const horsesAvailable = available.filter(h => !horsesOnRest.has(h.id)).length;

    if (horsesAvailable < horsesNeeded) {
      // Build description of which adjacent chukkas caused pressure
      const adjDesc = adjacentNums.map(n => {
        const teams = byNum[n].map(c => {
          const team = allChukkas.find(x => x.id === c.id);
          return `chukka ${n}`;
        });
        return `chukka ${n} (${byNum[n].length} team${byNum[n].length > 1 ? "s" : ""})`;
      }).join(" and ");

      pressureAlerts.push({
        chukkaNum: String(thisNum),
        horsesOnRest: horsesOnRest.size,
        horsesAvailable,
        horsesNeeded,
        adjacentDesc: adjDesc,
        shortfall: horsesNeeded - horsesAvailable,
        multipleTeamsAdjacent: adjacentChukkas.length > adjacentNums.length,
      });
    }
  }

  return pressureAlerts;
}

// ── Conflict panel ────────────────────────────────────────────────────────────
function ConflictPanel({ conflicts, horses, allChukkas, assignments }) {
  if (conflicts.length === 0) return null;

  const lockConflicts = conflicts.filter(c => c.isLockConflict);
  const noHorse = conflicts.filter(c => !c.isLockConflict);
  const pressureAlerts = analyseSchedulePressure(allChukkas, assignments, horses, noHorse);

  return (
    <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <p style={{ color: "#f87171", fontWeight: 700, fontSize: 13, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>
        ⚠ {conflicts.length} allocation problem{conflicts.length !== 1 ? "s" : ""}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

        {/* Schedule pressure alerts — shown first as root cause */}
        {pressureAlerts.map((alert, i) => (
          <div key={i} style={{ background: "#422006", border: "1px solid #d97706", borderRadius: 6, padding: 10 }}>
            <p style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13, margin: "0 0 4px" }}>
              📅 Schedule pressure — Chukka {alert.chukkaNum}
            </p>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 2px" }}>
              {alert.adjacentDesc} ran immediately before/after — {alert.horsesOnRest} horse{alert.horsesOnRest !== 1 ? "s" : ""} on mandatory rest.
            </p>
            <p style={{ color: "#fbbf24", fontSize: 12, margin: "0 0 2px" }}>
              {alert.horsesAvailable} horse{alert.horsesAvailable !== 1 ? "s" : ""} available, {alert.horsesNeeded} needed — shortfall of {alert.shortfall}.
            </p>
            <p style={{ color: "#64748b", fontSize: 11, margin: "4px 0 0" }}>
              Fix: move chukka {alert.chukkaNum} further in the schedule, authorise a 5th chukka, or mark a horse available.
            </p>
          </div>
        ))}

        {/* Individual player conflicts */}
        {noHorse.map((c, i) => (
          <div key={i} style={{ background: "#0f172a", borderRadius: 6, padding: 10 }}>
            <p style={{ color: "#f87171", fontWeight: 600, fontSize: 13, margin: "0 0 4px" }}>
              {c.playerName} · {c.teamName} · Chukka {c.chukkaNum}
            </p>
            {c.noPreferences ? (
              <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>No preferences set — add horses to this player's list</p>
            ) : c.failReasons?.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>No horses available</p>
            ) : (
              <div>
                {(c.failReasons || []).map((r, j) => {
                  const horse = horses.find(h => h.id === r.horseId);
                  return (
                    <p key={j} style={{ color: "#64748b", fontSize: 12, margin: "2px 0 0" }}>
                      • {horse?.name || r.horseName || r.horseId}: {r.reason}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Lock conflicts */}
        {lockConflicts.map((c, i) => (
          <div key={i} style={{ background: "#422006", borderRadius: 6, padding: 10, border: "1px solid #d97706" }}>
            <p style={{ color: "#fbbf24", fontWeight: 600, fontSize: 13, margin: "0 0 2px" }}>
              🔒 Lock conflict · {c.playerName} · Chukka {c.chukkaNum}
            </p>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>{c.warning} — consider unlocking this assignment</p>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Day View Tab ──────────────────────────────────────────────────────────────
function DayViewTab({ day, event, allDayResults, onUpdateDay }) {
  const { teams, horses, welfareRules } = event;
  const [horseModal, setHorseModal] = useState(null);
  const [pickerState, setPickerState] = useState(null);
  const [searchName, setSearchName] = useState("");
  const [showSaved, setShowSaved] = useState(false);

  // Solution history — ephemeral browsing, resets on navigation (that's fine)
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [completeOnly, setCompleteOnly] = useState(false);
  const [searching, setSearching] = useState(false);

  // Saved solutions — persisted in day object so they survive navigation
  const savedSolutions = day.savedSolutions || [];
  function setSavedSolutions(updater) {
    const next = typeof updater === "function" ? updater(savedSolutions) : updater;
    onUpdateDay({ ...day, savedSolutions: next });
  }

  const teamWins = getTeamWins(teams, allDayResults);
  const locks = day.locks || {};

  // Build allocatable chukkas
  const bracketChukkas = SUMMER_2026_RAW[day.name]
    ? findConroyChukkas(day.name, teams, day.results || {})
    : [];
  const manualChukkas = (day.schedule || []).map(c => ({
    ...c, conroyTeam: teams.find(t => t.id === c.teamId), branch: c.branch || "confirmed", isConditional: c.isConditional || false,
  }));
  const allConroyChukkas = [...bracketChukkas.map(c => {
    const overrideKey = `${c.chukkaNum}-${c.pitch}-${c.conroyTeam?.id}-${c.branch}`;
    const timeOverride = (day.timeOverrides || {})[overrideKey];
    return timeOverride ? { ...c, time: timeOverride } : c;
  })];
  for (const mc of manualChukkas) {
    const isDup = allConroyChukkas.some(c => c.chukkaNum === mc.chukkaNum && c.conroyTeam?.id === mc.teamId && c.branch === mc.branch);
    if (!isDup) allConroyChukkas.push(mc);
  }
  const allocatable = bracketToAllocatable(allConroyChukkas);

  // Generate a new solution and add to history
  // If completeOnly is on, keep trying until conflict-free or 100 attempts
  function generateSolution() {
    if (completeOnly) {
      setSearching(true);
      let attempts = 0;
      let found = null;
      while (attempts < 100) {
        const result = runAllocation(allocatable, teams, horses, welfareRules, teamWins, locks, Date.now() + attempts);
        if (result.conflicts.length === 0) { found = result; break; }
        attempts++;
      }
      setSearching(false);
      if (found) {
        const newHistory = [...history.slice(0, historyIdx + 1), found];
        setHistory(newHistory);
        setHistoryIdx(newHistory.length - 1);
      } else {
        // No complete solution found — add best attempt (fewest conflicts)
        const best = Array.from({ length: 10 }, (_, i) =>
          runAllocation(allocatable, teams, horses, welfareRules, teamWins, locks, Date.now() + i + 200)
        ).sort((a, b) => a.conflicts.length - b.conflicts.length)[0];
        const newHistory = [...history.slice(0, historyIdx + 1), best];
        setHistory(newHistory);
        setHistoryIdx(newHistory.length - 1);
        alert(`No complete solution found in 100 attempts. Showing best result with ${best.conflicts.length} conflict${best.conflicts.length !== 1 ? "s" : ""}. Try authorising a 5th chukka or adjusting preferences.`);
      }
    } else {
      const result = runAllocation(allocatable, teams, horses, welfareRules, teamWins, locks, Date.now());
      const newHistory = [...history.slice(0, historyIdx + 1), result];
      setHistory(newHistory);
      setHistoryIdx(newHistory.length - 1);
    }
  }

  // Initialise with first solution if history is empty
  const currentSolution = historyIdx >= 0 && history[historyIdx]
    ? history[historyIdx]
    : (() => {
        const result = runAllocation(allocatable, teams, horses, welfareRules, teamWins, locks, 0);
        if (history.length === 0) {
          // Defer state update to avoid render loop
          setTimeout(() => {
            setHistory([result]);
            setHistoryIdx(0);
          }, 0);
        }
        return result;
      })();

  const { assignments, conflicts } = currentSolution;

  const sorted = [...allocatable].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));
  const searchLower = searchName.toLowerCase().trim();
  const filtered = searchLower ? sorted.filter(chukka => {
    const team = teams.find(t => t.id === chukka.teamId);
    return team?.name.toLowerCase().includes(searchLower) ||
      (chukka.playerIds || []).some(pid => {
        const p = team?.players.find(p => p.id === pid);
        return p?.name.toLowerCase().includes(searchLower);
      }) ||
      (chukka.playerIds || []).some(pid => {
        const a = assignments[chukka.id]?.[pid];
        const h = horses.find(h => h.id === a?.horseId);
        return h?.name.toLowerCase().includes(searchLower);
      });
  }) : sorted;

  function setLock(chukkaId, playerId, horseId) {
    const newLocks = { ...locks };
    if (!newLocks[chukkaId]) newLocks[chukkaId] = {};
    if (horseId === null) {
      delete newLocks[chukkaId][playerId];
      if (Object.keys(newLocks[chukkaId]).length === 0) delete newLocks[chukkaId];
    } else {
      newLocks[chukkaId][playerId] = horseId;
    }
    onUpdateDay({ ...day, locks: newLocks });
  }

  function resetAllLocks() {
    onUpdateDay({ ...day, locks: {} });
  }

  const WELFARE_COLOR = { DONE: "#4ade80", UNTACK: "#60a5fa", BANDAGES: "#fbbf24", READY: "#f87171" };

  // Lunch suggestions
  const horseLunchSuggestions = {};
  horses.filter(h => h.unavailable !== true).forEach(horse => {
    const hChukkas = sorted.filter(c => Object.values(assignments[c.id] || {}).some(a => a.horseId === horse.id && c.branch === "confirmed"));
    for (let i = 0; i < hChukkas.length - 1; i++) {
      const gap = (parseInt(hChukkas[i+1].chukkaNum) || 0) - (parseInt(hChukkas[i].chukkaNum) || 0) - 1;
      if (gap >= 5 && !horseLunchSuggestions[horse.id]) {
        horseLunchSuggestions[horse.id] = { afterChukka: hChukkas[i].chukkaNum, afterTime: hChukkas[i].time, beforeChukka: hChukkas[i+1].chukkaNum, beforeTime: hChukkas[i+1].time, gap };
      }
    }
  });

  const lockCount = Object.values(locks).reduce((n, v) => n + Object.keys(v).length, 0);

  return (
    <div>
      {/* Modals */}
      {horseModal && (
        <HorseTimelineModal
          horse={horseModal} allChukkas={allocatable} assignments={assignments}
          teams={teams} welfareRules={welfareRules}
          onClose={() => setHorseModal(null)}
        />
      )}
      {pickerState && (
        <AssignmentPicker
          chukka={pickerState.chukka}
          playerId={pickerState.playerId}
          playerName={pickerState.playerName}
          currentHorseId={locks[pickerState.chukka.id]?.[pickerState.playerId] || null}
          horses={horses}
          allChukkas={allocatable}
          allAssignments={assignments}
          welfareRules={welfareRules}
          onAssign={horseId => { setLock(pickerState.chukka.id, pickerState.playerId, horseId); setPickerState(null); }}
          onClose={() => setPickerState(null)}
        />
      )}

      {/* Solution history navigation */}
      <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
        {/* Nav row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={() => historyIdx > 0 && setHistoryIdx(historyIdx - 1)}
            disabled={historyIdx <= 0}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: historyIdx > 0 ? "#f1f5f9" : "#334155", padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: historyIdx > 0 ? "pointer" : "not-allowed" }}>
            ← Prev
          </button>
          <span style={{ color: "#64748b", fontSize: 12, flex: 1, textAlign: "center" }}>
            Solution {historyIdx + 1} of {history.length}
            {conflicts.length === 0
              ? <span style={{ color: "#4ade80", marginLeft: 6 }}>✓ Complete</span>
              : <span style={{ color: "#f87171", marginLeft: 6 }}>⚠ {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}</span>
            }
          </span>
          <button onClick={generateSolution} disabled={searching}
            style={{ background: searching ? "#1e293b" : "#1e293b", border: "1px solid #3b82f6", borderRadius: 6, color: searching ? "#475569" : "#93c5fd", padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: searching ? "not-allowed" : "pointer" }}>
            {searching ? "..." : "Next →"}
          </button>
        </div>
        {/* Complete only toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={() => setCompleteOnly(v => !v)} style={{
            background: completeOnly ? "#14532d" : "#1e293b",
            border: "1px solid " + (completeOnly ? "#16a34a" : "#334155"),
            borderRadius: 6, color: completeOnly ? "#4ade80" : "#64748b",
            padding: "4px 10px", fontSize: 11, fontWeight: 700,
            cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
          }}>
            {completeOnly ? "✓ Complete solutions only" : "Complete solutions only"}
          </button>
        </div>

        {/* Action row */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => {
            const label = `Solution ${history.length} — ${conflicts.length === 0 ? "complete" : conflicts.length + " conflicts"}`;
            setSavedSolutions(prev => [...prev, { ...currentSolution, label, id: uid() }]);
          }} style={{ flex: 1, background: "#14532d", border: "1px solid #16a34a", borderRadius: 6, color: "#4ade80", padding: "6px 0", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            ★ Save this
          </button>
          {savedSolutions.length > 0 && (
            <button onClick={() => setShowSaved(true)}
              style={{ flex: 1, background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 6, color: "#93c5fd", padding: "6px 0", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Saved ({savedSolutions.length})
            </button>
          )}
          {lockCount > 0 && (
            <button onClick={resetAllLocks}
              style={{ background: "#422006", border: "1px solid #d97706", borderRadius: 6, color: "#fbbf24", padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              🔓 {lockCount}
            </button>
          )}
        </div>
      </div>

      {/* Saved solutions modal */}
      {showSaved && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
          onClick={() => setShowSaved(false)}>
          <div style={{ background: "#0f172a", borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "80vh", overflow: "auto", padding: 20 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ color: "#f1f5f9", fontSize: 18, margin: 0 }}>Saved Solutions</h3>
              <button onClick={() => setShowSaved(false)} style={{ background: "none", border: "none", color: "#475569", fontSize: 24, cursor: "pointer" }}>✕</button>
            </div>
            {savedSolutions.length === 0 ? (
              <p style={{ color: "#475569", textAlign: "center", padding: "20px 0" }}>No saved solutions yet</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {savedSolutions.map((sol, i) => {
                  const conflictCount = sol.conflicts?.length || 0;
                  return (
                    <div key={sol.id} style={{ background: "#1e293b", border: "1px solid " + (conflictCount === 0 ? "#16a34a" : "#dc2626"), borderRadius: 10, padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ color: "#f1f5f9", fontWeight: 700, flex: 1 }}>★ Saved #{i + 1}</span>
                        <span style={{ color: conflictCount === 0 ? "#4ade80" : "#f87171", fontSize: 12, fontWeight: 700 }}>
                          {conflictCount === 0 ? "✓ Complete" : `⚠ ${conflictCount} conflict${conflictCount !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                      {/* Compact assignment summary */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
                        {allocatable.filter(c => c.branch === "confirmed").slice(0, 3).map(chukka => {
                          const team = teams.find(t => t.id === chukka.teamId);
                          const playerSummary = (chukka.playerIds || []).map(pid => {
                            const player = team?.players.find(p => p.id === pid);
                            const a = sol.assignments[chukka.id]?.[pid];
                            const horse = a?.horseId ? horses.find(h => h.id === a.horseId) : null;
                            return `${player?.name?.split(" ")[0]} → ${horse?.name || "?"}`;
                          }).join(", ");
                          return (
                            <p key={chukka.id} style={{ color: "#64748b", fontSize: 11, margin: 0 }}>
                              <span style={{ color: "#94a3b8" }}>Ch{chukka.chukkaNum} {team?.name?.split(" ").pop()}</span> · {playerSummary}
                            </p>
                          );
                        })}
                        {allocatable.filter(c => c.branch === "confirmed").length > 3 && (
                          <p style={{ color: "#475569", fontSize: 11, margin: 0 }}>+ {allocatable.filter(c => c.branch === "confirmed").length - 3} more chukkas...</p>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => {
                          // Apply this solution by adding it to history and navigating to it
                          const newHistory = [...history, sol];
                          setHistory(newHistory);
                          setHistoryIdx(newHistory.length - 1);
                          setShowSaved(false);
                        }} style={{ flex: 1, background: "#16a34a", border: "none", borderRadius: 6, color: "#fff", padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                          Apply
                        </button>
                        <button onClick={() => setSavedSolutions(prev => prev.filter(s => s.id !== sol.id))}
                          style={{ background: "#1e293b", border: "1px solid #dc2626", borderRadius: 6, color: "#f87171", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input value={searchName} onChange={e => setSearchName(e.target.value)} placeholder="Search player, team, horse..."
          style={{ width: "100%", boxSizing: "border-box", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", padding: "8px 12px", fontSize: 13, outline: "none" }} />
        {searchName && <button onClick={() => setSearchName("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#475569", fontSize: 16, cursor: "pointer" }}>✕</button>}
      </div>

      {/* Conflicts */}
      <ConflictPanel conflicts={conflicts} horses={horses} allChukkas={allocatable} assignments={assignments} />

      {/* Horse capacity tally */}
      {(() => {
        // Count assignments per horse across ALL chukkas (matches what engine uses)
        const usedCount = {};
        for (const chukka of sorted) {
          for (const playerId of (chukka.playerIds || [])) {
            const a = assignments[chukka.id]?.[playerId];
            if (a?.horseId) usedCount[a.horseId] = (usedCount[a.horseId] || 0) + 1;
          }
        }
        const withCapacity = horses
          .filter(h => h.unavailable !== true)
          .map(h => ({ horse: h, used: usedCount[h.id] || 0, remaining: h.maxChukkas - (usedCount[h.id] || 0) }))
          .filter(x => x.remaining > 0)
          .sort((a, b) => b.remaining - a.remaining);

        if (withCapacity.length === 0) return null;

        return (
          <div style={{ marginBottom: 12 }}>
            <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Horse capacity</p>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {withCapacity.map(({ horse, used, remaining }) => {
                const pct = used / horse.maxChukkas;
                const color = pct === 0 ? "#4ade80" : pct < 0.5 ? "#4ade80" : pct < 1 ? "#fbbf24" : "#f87171";
                return (
                  <button key={horse.id} onClick={() => setHorseModal(horse)} style={{
                    background: "#1e293b", border: "1px solid " + color + "44",
                    borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  }}>
                    <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{horse.name}</span>
                    <span style={{ color: color, fontSize: 12, fontWeight: 700 }}>{remaining}/{horse.maxChukkas}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Team wins */}
      {teams.some(t => (teamWins[t.id] || 0) > 0) && (
        <Card style={{ marginBottom: 12, background: "#0a0f1e", borderColor: "#1e293b" }}>
          <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Priority order (by wins)</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...teams].sort((a, b) => (teamWins[b.id] || 0) - (teamWins[a.id] || 0)).map((t, i) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e293b", borderRadius: 6, padding: "4px 10px" }}>
                <span style={{ color: "#475569", fontSize: 11 }}>#{i+1}</span>
                <span style={{ color: "#f1f5f9", fontSize: 12 }}>{t.name}</span>
                <span style={{ color: "#4ade80", fontSize: 12, fontWeight: 700 }}>{teamWins[t.id] || 0}W</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Lunch suggestions */}
      {Object.keys(horseLunchSuggestions).length > 0 && (
        <Card style={{ marginBottom: 12, background: "#14532d22", borderColor: "#16a34a44" }}>
          <p style={{ color: "#4ade80", fontWeight: 700, fontSize: 12, margin: "0 0 6px", letterSpacing: 1, textTransform: "uppercase" }}>🌿 Suggested Lunch Breaks</p>
          {Object.entries(horseLunchSuggestions).map(([horseId, info]) => {
            const horse = horses.find(h => h.id === horseId);
            return (
              <p key={horseId} style={{ color: "#94a3b8", fontSize: 12, margin: "2px 0 0" }}>
                <strong style={{ color: "#f1f5f9" }}>{horse?.name}</strong> — after chukka {info.afterChukka} ({info.afterTime}) → chukka {info.beforeChukka} ({info.beforeTime}) · {info.gap} chukka gap
              </p>
            );
          })}
        </Card>
      )}

      {/* Chukka list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(chukka => {
          const team = teams.find(t => t.id === chukka.teamId);
          const bs = branchStyle(chukka.branch);
          return (
            <div key={chukka.id} style={{ background: bs.bg, border: "1px solid " + bs.border, borderRadius: 10, overflow: "hidden" }}>
              {/* Chukka header */}
              <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: "1px solid #0f172a33" }}>
                <span style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 17 }}>Chukka {chukka.chukkaNum}</span>
                <span style={{ color: "#64748b", fontSize: 12 }}>{chukka.time}</span>
                {chukka.pitch && <span style={{ color: "#475569", fontSize: 11 }}>P{chukka.pitch}</span>}
                <Badge color={DIV_COLOR[chukka.division] || "#94a3b8"}>{chukka.division}</Badge>
                {bs.label && <Badge color={chukka.branch === "win" ? "#4ade80" : "#f87171"}>{bs.label}</Badge>}
                <span style={{ color: "#cbd5e1", fontSize: 14, flex: 1 }}>{team?.name}</span>
                {(teamWins[team?.id] || 0) > 0 && <span style={{ background: "#16a34a22", color: "#4ade80", border: "1px solid #16a34a44", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{teamWins[team?.id]}W</span>}
              </div>

              {/* Player rows */}
              {(chukka.playerIds || []).map(playerId => {
                const player = team?.players.find(p => p.id === playerId);
                const a = assignments[chukka.id]?.[playerId];
                const horse = a?.horseId ? horses.find(h => h.id === a.horseId) : null;
                const isLocked = !!locks[chukka.id]?.[playerId];
                const isHighlighted = searchLower && (
                  player?.name.toLowerCase().includes(searchLower) ||
                  horse?.name.toLowerCase().includes(searchLower)
                );
                return (
                  <button key={playerId}
                    onClick={() => setPickerState({ chukka, playerId, playerName: player?.name || playerId })}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "9px 14px", background: isHighlighted ? "#1d4ed822" : "transparent",
                      border: "none", borderBottom: "1px solid #0f172a22",
                      cursor: "pointer", textAlign: "left",
                    }}>
                    <span style={{ color: isHighlighted ? "#93c5fd" : "#f1f5f9", flex: 1, fontSize: 14, fontWeight: isHighlighted ? 700 : 400 }}>
                      {player?.name || playerId}
                    </span>
                    {/* Horse name — tap to see timeline */}
                    <span
                      onClick={e => { e.stopPropagation(); horse && setHorseModal(horse); }}
                      style={{ color: horse ? (isHighlighted ? "#93c5fd" : "#f1f5f9") : "#f87171", fontSize: 14, fontWeight: 600, minWidth: 60 }}>
                      {horse ? horse.name : "⚠ No horse"}
                    </span>
                    {isLocked && <span style={{ color: "#fbbf24", fontSize: 14 }}>🔒</span>}
                    {a?.welfare && !a.noHorse && (
                      <span style={{ background: WELFARE_COLOR[a.welfare.code] + "22", color: WELFARE_COLOR[a.welfare.code], border: "1px solid " + WELFARE_COLOR[a.welfare.code] + "44", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
                        {a.welfare.code}
                      </span>
                    )}
                    {a?.gapChukkas !== null && a?.gapChukkas !== undefined && !a.noHorse && (
                      <span style={{ color: "#334155", fontSize: 11 }}>{a.gapChukkas}r</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <Card style={{ textAlign: "center", padding: 24 }}>
            <p style={{ color: "#475569", fontSize: 14, margin: 0 }}>
              {searchLower ? `No results for "${searchName}"` : SUMMER_2026_RAW[day.name] ? "Chukkas load automatically for Summer 2026 days" : "No chukkas yet — add via Schedule tab"}
            </p>
          </Card>
        )}
      </div>

      {/* Reset to automatic */}
      {lockCount > 0 && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #1e293b" }}>
          <DeleteButton label={`Reset to automatic — clear all ${lockCount} manual lock${lockCount !== 1 ? "s" : ""} for ${day.name}`} onDelete={resetAllLocks} />
        </div>
      )}
    </div>
  );
}


// ── Excel schedule parser ─────────────────────────────────────────────────────
// Loads SheetJS from CDN and parses SUPA schedule Excel files
// Returns array of chukka objects for Conroy teams only

function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Failed to load SheetJS"));
    document.head.appendChild(script);
  });
}

function decToTime(d) {
  try {
    const mins = Math.round(parseFloat(d) * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  } catch { return "00:00"; }
}

function divMap(divStr) {
  const d = (divStr || "").toLowerCase();
  if (d.includes("upper beginner")) return "Upper Beginner";
  if (d.includes("lower beginner")) return "Lower Beginner";
  if (d.includes("median")) return "Median";
  if (d.includes("upper novice combined")) return "Upper Novice Combined";
  if (d.includes("lower novice combined")) return "Lower Novice Combined";
  if (d.includes("upper novice")) return "Upper Novice";
  if (d.includes("lower novice")) return "Lower Novice";
  if (d.includes("upper inters")) return "Upper Inters";
  if (d.includes("lower inters")) return "Lower Inters";
  return divStr || "Beginner";
}

function appDiv(divStr) {
  const d = (divStr || "").toLowerCase();
  if (d.includes("beginner")) return "Beginner";
  if (d.includes("median")) return "Median";
  return "Novice";
}

async function parseScheduleExcel(file, conroyTeams) {
  const XLSX = await loadSheetJS();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const teamNames = conroyTeams.map(t => t.name.toLowerCase());
  const results = [];

  for (const sheetName of workbook.SheetNames) {
    if (!sheetName.toLowerCase().includes("times")) continue;

    // Determine pitch from sheet name
    const pitch = sheetName.toLowerCase().includes("pitch 2") ? 2 : 1;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // Find header row
    let headerRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some(cell => String(cell).trim() === "Chu" || String(cell).trim() === "Chukka")) {
        headerRow = i;
        break;
      }
    }
    if (headerRow === -1) continue;

    // Parse data rows
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      const chu = row[1];
      const divRaw = String(row[2] || "");
      const matchLetter = String(row[4] || "").toLowerCase().trim();
      const teamA = String(row[5] || "").trim();
      const teamB = String(row[13] || row[6] || "").trim();
      const timeVal = row[0];

      if (!chu || isNaN(parseFloat(chu))) continue;
      if (!teamA || teamA === "PLEASE BE AWARE") continue;

      const chukkaNum = parseInt(parseFloat(chu));
      const time = typeof timeVal === "number" ? decToTime(timeVal) : String(timeVal || "");
      const division = divMap(divRaw);

      // Check if either team is a Conroy team
      for (const team of conroyTeams) {
        const tl = team.name.toLowerCase();
        if (teamA.toLowerCase() === tl || teamB.toLowerCase() === tl) {
          results.push({
            id: uid(),
            chukkaNum: String(chukkaNum),
            time,
            division,
            appDivision: appDiv(division),
            pitch,
            matchLetter,
            teamId: team.id,
            playerIds: team.players.map(p => p.id),
            teamA,
            teamB,
            branch: "confirmed",
            isConditional: false,
            fromExcel: true,
          });
          break;
        }
      }
    }
  }

  return results.sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));
}

// ── Schedule Tab ──────────────────────────────────────────────────────────────
function ScheduleTab({ day, event, onUpdateDay }) {
  const { teams } = event;
  const schedule = day.schedule || [];
  const [time, setTime] = useState("");
  const [chukkaNum, setChukkaNum] = useState("");
  const [division, setDivision] = useState("Beginner");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [branch, setBranch] = useState("confirmed");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // { success, count, warnings }
  const fileInputRef = useRef(null);

  const team = teams.find(t => t.id === selectedTeam);

  function addChukka() {
    if (!time || !selectedTeam || selectedPlayers.length === 0) return;
    onUpdateDay({ ...day, schedule: [...schedule, {
      id: uid(), time, chukkaNum: chukkaNum || "?", division,
      teamId: selectedTeam, playerIds: selectedPlayers,
      branch, isConditional: branch !== "confirmed",
    }]});
    setTime(""); setChukkaNum(""); setSelectedPlayers([]);
  }

  async function handleExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadStatus(null);

    try {
      const parsed = await parseScheduleExcel(file, teams);

      if (parsed.length === 0) {
        setUploadStatus({ success: false, error: "No chukkas found for your teams in this file. Check the sheet names contain 'Times'." });
        setUploading(false);
        return;
      }

      // Replace Excel-sourced chukkas, keep manual ones and preserve locks/results
      const manualChukkas = schedule.filter(c => !c.fromExcel);
      const newSchedule = [...manualChukkas, ...parsed];

      onUpdateDay({ ...day, schedule: newSchedule });
      setUploadStatus({ success: true, count: parsed.length });
    } catch (err) {
      setUploadStatus({ success: false, error: "Failed to parse file: " + err.message });
    }

    setUploading(false);
    // Reset file input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const bracketCount = SUMMER_2026_RAW[day.name]
    ? findConroyChukkas(day.name, teams, day.results || {}).length
    : 0;

  const excelChukkas = schedule.filter(c => c.fromExcel);
  const manualChukkas = schedule.filter(c => !c.fromExcel);
  const sorted = [...schedule].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));

  return (
    <div>
      {/* Excel upload — primary workflow */}
      <Card style={{ marginBottom: 16, background: "#0a0f1e", borderColor: "#334155" }}>
        <p style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, margin: "0 0 4px" }}>📊 Upload updated schedule</p>
        <p style={{ color: "#475569", fontSize: 12, margin: "0 0 12px" }}>
          Upload the latest SUPA Excel sheet. Replaces previous Excel data, keeps your manual additions and all locks.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleExcelUpload}
          style={{ display: "none" }}
          id="excel-upload"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            width: "100%", background: uploading ? "#1e293b" : "#1d4ed8",
            border: "1px solid " + (uploading ? "#334155" : "#1d4ed8"),
            borderRadius: 8, color: uploading ? "#475569" : "#fff",
            padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: uploading ? "not-allowed" : "pointer",
          }}>
          {uploading ? "Parsing..." : "Select Excel file"}
        </button>

        {uploadStatus?.success && (
          <div style={{ marginTop: 10, background: "#14532d", border: "1px solid #16a34a", borderRadius: 6, padding: "8px 12px" }}>
            <p style={{ color: "#4ade80", fontWeight: 700, fontSize: 13, margin: 0 }}>
              ✓ Imported {uploadStatus.count} chukka{uploadStatus.count !== 1 ? "s" : ""} for your teams
            </p>
          </div>
        )}
        {uploadStatus?.error && (
          <div style={{ marginTop: 10, background: "#450a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "8px 12px" }}>
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>{uploadStatus.error}</p>
          </div>
        )}

        {excelChukkas.length > 0 && !uploadStatus && (
          <p style={{ color: "#475569", fontSize: 12, margin: "10px 0 0" }}>
            {excelChukkas.length} chukka{excelChukkas.length !== 1 ? "s" : ""} from last upload
          </p>
        )}
      </Card>

      {bracketCount > 0 && (
        <Card style={{ marginBottom: 16, background: "#0a0f1e", borderColor: "#1e293b" }}>
          <p style={{ color: "#4ade80", fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>✓ {bracketCount} chukkas tracked from hardcoded schedule</p>
          <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>Upload an updated Excel to override these with the latest data.</p>
        </Card>
      )}

      {/* Manual add */}
      <Card style={{ marginBottom: 16 }}>
        <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>Add chukka manually</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input value={time} onChange={setTime} type="time" style={{ flex: 1, minWidth: 100 }} />
            <Input value={chukkaNum} onChange={setChukkaNum} placeholder="Chukka #" style={{ flex: 1, minWidth: 80 }} />
            <Select value={division} onChange={setDivision} style={{ flex: 1, minWidth: 100 }}>
              {DIVISIONS.map(d => <option key={d}>{d}</option>)}
            </Select>
          </div>
          <Select value={selectedTeam} onChange={v => { setSelectedTeam(v); setSelectedPlayers([]); }}>
            <option value="">Select team</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {team && (
            <div>
              <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Players</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {team.players.map(p => (
                  <button key={p.id} onClick={() => setSelectedPlayers(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                    style={{ background: selectedPlayers.includes(p.id) ? "#16a34a" : "#0f172a", border: "1px solid " + (selectedPlayers.includes(p.id) ? "#16a34a" : "#334155"), borderRadius: 6, color: "#f1f5f9", padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {["confirmed", "win", "loss"].map(b => (
              <button key={b} onClick={() => setBranch(b)} style={{ flex: 1, background: branch === b ? (b === "win" ? "#16a34a" : b === "loss" ? "#dc2626" : "#3b82f6") : "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {b.charAt(0).toUpperCase() + b.slice(1)}
              </button>
            ))}
          </div>
          <Btn onClick={addChukka} disabled={!time || !selectedTeam || selectedPlayers.length === 0}>Add Chukka</Btn>
        </div>
      </Card>
      {/* All tracked chukkas — bracket + excel + manual, all editable */}
      {(() => {
        const bracketCh = SUMMER_2026_RAW[day.name]
          ? findConroyChukkas(day.name, teams, day.results || {})
          : [];
        const allTracked = [...bracketCh.map(c => ({
          id: `bracket-${c.chukkaNum}-${c.pitch}-${c.conroyTeam?.id}-${c.branch}`,
          chukkaNum: c.chukkaNum,
          time: c.time,
          division: c.division,
          teamId: c.conroyTeam?.id,
          teamName: c.conroyTeam?.name,
          branch: c.branch,
          source: "bracket",
          timeOverride: (day.timeOverrides || {})[`${c.chukkaNum}-${c.pitch}-${c.conroyTeam?.id}-${c.branch}`],
        })), ...sorted.map(c => ({
          ...c,
          teamName: teams.find(t => t.id === c.teamId)?.name,
          source: c.fromExcel ? "excel" : "manual",
          timeOverride: null,
        }))];

        if (allTracked.length === 0) return null;

        return (
          <AllChukkaList
            chukkas={allTracked}
            teams={teams}
            day={day}
            onUpdateDay={onUpdateDay}
            schedule={schedule}
          />
        );
      })()}
    </div>
  );
}

function AllChukkaList({ chukkas, teams, day, onUpdateDay, schedule }) {
  const [selectedChukka, setSelectedChukka] = useState(null);
  const [pendingTime, setPendingTime] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const sorted = [...chukkas].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));

  function openChukka(c) {
    setSelectedChukka(c);
    setPendingTime(c.timeOverride || c.time || "");
    setConfirmingDelete(false);
  }

  function saveTime() {
    if (!selectedChukka || !pendingTime) return;
    if (selectedChukka.source === "manual" || selectedChukka.source === "excel") {
      onUpdateDay({ ...day, schedule: schedule.map(c => c.id === selectedChukka.id ? { ...c, time: pendingTime } : c) });
    } else {
      const key = selectedChukka.id.replace("bracket-", "");
      onUpdateDay({ ...day, timeOverrides: { ...(day.timeOverrides || {}), [key]: pendingTime } });
    }
    setSelectedChukka(null);
  }

  function resetTime() {
    const key = selectedChukka.id.replace("bracket-", "");
    const overrides = { ...(day.timeOverrides || {}) };
    delete overrides[key];
    onUpdateDay({ ...day, timeOverrides: overrides });
    setSelectedChukka(null);
  }

  function deleteChukka() {
    if (selectedChukka.source === "manual" || selectedChukka.source === "excel") {
      onUpdateDay({ ...day, schedule: schedule.filter(c => c.id !== selectedChukka.id) });
    }
    setSelectedChukka(null);
    setConfirmingDelete(false);
  }

  const sourceLabel = { bracket: "AUTO", excel: "EXCEL", manual: "MANUAL" };
  const sourceColor = { bracket: "#475569", excel: "#3b82f6", manual: "#a855f7" };

  return (
    <div>
      <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>
        All tracked chukkas — tap to edit
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map(c => {
          const bs = branchStyle(c.branch || "confirmed");
          const displayTime = c.timeOverride || c.time;
          return (
            <button key={c.id} onClick={() => openChukka(c)} style={{
              background: bs.bg, border: "1px solid " + bs.border,
              borderRadius: 8, padding: "10px 14px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8, textAlign: "left", width: "100%",
            }}>
              <span style={{ color: "#f1f5f9", fontWeight: 700, minWidth: 28, fontSize: 14 }}>{c.chukkaNum}</span>
              <span style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: c.timeOverride ? "#fbbf24" : "#64748b", padding: "2px 7px", fontSize: 11 }}>
                {displayTime || "—"}{c.timeOverride ? " ✎" : ""}
              </span>
              <span style={{ background: sourceColor[c.source] + "22", color: sourceColor[c.source], border: "1px solid " + sourceColor[c.source] + "44", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                {sourceLabel[c.source]}
              </span>
              {bs.label && <Badge color={c.branch === "win" ? "#4ade80" : "#f87171"}>{bs.label}</Badge>}
              <span style={{ color: "#cbd5e1", fontSize: 13, flex: 1 }}>{c.teamName}</span>
              <span style={{ color: "#334155", fontSize: 14 }}>›</span>
            </button>
          );
        })}
      </div>

      {/* Chukka detail modal */}
      {selectedChukka && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
          onClick={() => { setSelectedChukka(null); setConfirmingDelete(false); }}>
          <div style={{ background: "#0f172a", borderRadius: "16px 16px 0 0", width: "100%", padding: 20 }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ color: "#f1f5f9", fontSize: 17, margin: 0 }}>Chukka {selectedChukka.chukkaNum} — {selectedChukka.teamName}</h3>
                <p style={{ color: "#475569", fontSize: 12, margin: "2px 0 0" }}>
                  {selectedChukka.division} · {selectedChukka.branch !== "confirmed" ? selectedChukka.branch.toUpperCase() + " PATH · " : ""}
                  <span style={{ color: sourceColor[selectedChukka.source] }}>{sourceLabel[selectedChukka.source]}</span>
                </p>
              </div>
              <button onClick={() => { setSelectedChukka(null); setConfirmingDelete(false); }}
                style={{ background: "none", border: "none", color: "#475569", fontSize: 24, cursor: "pointer" }}>✕</button>
            </div>

            {/* Time edit */}
            <div style={{ marginBottom: 16 }}>
              <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Time</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="time" value={pendingTime} onChange={e => setPendingTime(e.target.value)}
                  style={{ flex: 1, background: "#1e293b", border: "1px solid #3b82f6", borderRadius: 8, color: "#f1f5f9", padding: "10px 14px", fontSize: 16, outline: "none" }} />
                {selectedChukka.timeOverride && (
                  <button onClick={resetTime} style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#64748b", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>
                    Reset
                  </button>
                )}
              </div>
              {pendingTime !== (selectedChukka.timeOverride || selectedChukka.time) && (
                <div style={{ marginTop: 10, background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 8, padding: 12 }}>
                  <p style={{ color: "#93c5fd", fontSize: 13, margin: "0 0 10px" }}>
                    Change time from <strong>{selectedChukka.timeOverride || selectedChukka.time}</strong> to <strong>{pendingTime}</strong>?
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveTime} style={{ flex: 1, background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                      Confirm change
                    </button>
                    <button onClick={() => setPendingTime(selectedChukka.timeOverride || selectedChukka.time || "")}
                      style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Delete — only for manual/excel chukkas */}
            {(selectedChukka.source === "manual" || selectedChukka.source === "excel") && (
              <div style={{ borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                {!confirmingDelete ? (
                  <button onClick={() => setConfirmingDelete(true)} style={{ width: "100%", background: "#1e293b", border: "1px solid #dc2626", borderRadius: 8, color: "#f87171", padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    Remove this chukka
                  </button>
                ) : (
                  <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 8, padding: 12 }}>
                    <p style={{ color: "#f87171", fontWeight: 700, fontSize: 13, margin: "0 0 10px", textAlign: "center" }}>
                      Remove chukka {selectedChukka.chukkaNum} ({selectedChukka.teamName})?
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setConfirmingDelete(false)} style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", padding: "10px 0", fontSize: 14, cursor: "pointer" }}>Cancel</button>
                      <button onClick={deleteChukka} style={{ flex: 1, background: "#dc2626", border: "none", borderRadius: 6, color: "#fff", padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Yes, remove</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Results Tab ───────────────────────────────────────────────────────────────
function trafficLight(outcome) {
  if (outcome === "win")  return { bg: "#14532d", border: "#16a34a", dot: "#4ade80", label: "WIN" };
  if (outcome === "loss") return { bg: "#450a0a", border: "#dc2626", dot: "#f87171", label: "LOSS" };
  return { bg: "#422006", border: "#d97706", dot: "#fbbf24", label: "DRAW" };
}

function ResultsTab({ day, event, onUpdateDay }) {
  const { teams } = event;
  const results = day.results || {};
  const [editId, setEditId] = useState(null);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [decider, setDecider] = useState(null);
  const [deciderWinner, setDeciderWinner] = useState(null);

  const bracketChukkas = SUMMER_2026_RAW[day.name]
    ? findConroyChukkas(day.name, teams, results).filter(c => c.branch === "confirmed" || c.isConditional)
    : [];
  const manualChukkas = day.schedule || [];
  const allForResults = [
    ...bracketChukkas.map(c => ({ id: `${c.chukkaNum}-${c.pitch}-${c.conroyTeam?.id}-${c.branch}`, chukkaNum: c.chukkaNum, time: c.time, teamId: c.conroyTeam?.id, pitch: c.pitch, branch: c.branch })),
    ...manualChukkas,
  ].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));

  function startEdit(chukka) {
    const ex = results[chukka.id];
    setEditId(chukka.id);
    setScoreA(ex ? String(ex.scoreA) : "");
    setScoreB(ex ? String(ex.scoreB) : "");
    setDecider(ex?.decider || null);
    setDeciderWinner(ex?.deciderWinner || null);
  }

  function saveResult(chukka) {
    const a = parseInt(scoreA) || 0, b = parseInt(scoreB) || 0;
    const isDraw = a === b;
    let outcome = null;
    if (!isDraw) outcome = a > b ? "win" : "loss";
    else if (decider && deciderWinner) outcome = deciderWinner === "A" ? "win" : "loss";
    onUpdateDay({ ...day, results: { ...results, [chukka.id]: { scoreA: a, scoreB: b, isDraw, decider, deciderWinner, outcome, teamId: chukka.teamId, chukkaNum: chukka.chukkaNum } } });
    setEditId(null); setDecider(null); setDeciderWinner(null);
  }

  function clearResult(id) { const n = { ...results }; delete n[id]; onUpdateDay({ ...day, results: n }); }

  return (
    <div>
      <p style={{ color: "#475569", fontSize: 12, margin: "0 0 16px" }}>Tap a chukka to record result. Results update allocation priority.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {allForResults.map(chukka => {
          const team = teams.find(t => t.id === chukka.teamId);
          const result = results[chukka.id];
          const isEditing = editId === chukka.id;
          const a = parseInt(scoreA) || 0, b = parseInt(scoreB) || 0;
          const liveIsDraw = scoreA !== "" && scoreB !== "" && a === b;
          const tl = result ? trafficLight(result.outcome) : null;
          const bs = branchStyle(chukka.branch || "confirmed");
          return (
            <div key={chukka.id}>
              <div onClick={() => !isEditing && startEdit(chukka)} style={{
                background: tl ? tl.bg : bs.bg, border: "1px solid " + (tl ? tl.border : bs.border),
                borderRadius: isEditing ? "10px 10px 0 0" : 10,
                padding: "12px 16px", cursor: isEditing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: tl ? tl.dot : "#334155", flexShrink: 0, boxShadow: tl ? "0 0 6px " + tl.dot : "none" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>Chukka {chukka.chukkaNum}</span>
                    <span style={{ color: "#64748b", fontSize: 12 }}>{chukka.time}</span>
                    {chukka.pitch && <span style={{ color: "#475569", fontSize: 11 }}>P{chukka.pitch}</span>}
                    {bs.label && <Badge color={chukka.branch === "win" ? "#4ade80" : "#f87171"}>{bs.label}</Badge>}
                    <span style={{ color: "#94a3b8", fontSize: 13 }}>{team?.name}</span>
                  </div>
                  {result ? (
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: tl.dot, fontWeight: 700, fontSize: 16 }}>{result.scoreA} — {result.scoreB}</span>
                      <span style={{ color: tl.dot, fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>{tl.label}</span>
                      {result.isDraw && result.decider && <span style={{ color: "#fbbf24", fontSize: 11 }}>{result.decider === "RunDown" ? "Run Down" : "Penalties"} — {result.deciderWinner === "A" ? team?.name : "Opponents"}</span>}
                    </div>
                  ) : <p style={{ color: "#475569", fontSize: 12, margin: "4px 0 0" }}>Tap to enter result</p>}
                </div>
                {result && !isEditing && <button onClick={e => { e.stopPropagation(); clearResult(chukka.id); }} style={{ background: "none", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", padding: 4 }}>✕</button>}
              </div>
              {isEditing && (
                <div style={{ background: "#0f172a", border: "1px solid #334155", borderTop: "none", borderRadius: "0 0 10px 10px", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>{team?.name || "Your team"}</p>
                      <input type="number" min="0" value={scoreA} onChange={e => setScoreA(e.target.value)} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 40, fontWeight: 700, textAlign: "center", padding: "10px 0", outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <span style={{ color: "#475569", fontSize: 28, fontWeight: 700 }}>—</span>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Opponents</p>
                      <input type="number" min="0" value={scoreB} onChange={e => setScoreB(e.target.value)} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 40, fontWeight: 700, textAlign: "center", padding: "10px 0", outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  {liveIsDraw && (
                    <div style={{ background: "#422006", border: "1px solid #d97706", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                      <p style={{ color: "#fbbf24", fontSize: 12, margin: "0 0 10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>🟡 Drawn — select decider</p>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        {["RunDown", "Penalties"].map(d => (
                          <button key={d} onClick={() => setDecider(d)} style={{ flex: 1, background: decider === d ? "#d97706" : "#1e293b", border: "1px solid " + (decider === d ? "#d97706" : "#475569"), borderRadius: 6, color: "#f1f5f9", padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{d === "RunDown" ? "Run Down" : "Penalties"}</button>
                        ))}
                      </div>
                      {decider && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setDeciderWinner("A")} style={{ flex: 1, background: deciderWinner === "A" ? "#16a34a" : "#1e293b", border: "1px solid " + (deciderWinner === "A" ? "#16a34a" : "#475569"), borderRadius: 6, color: "#f1f5f9", padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🟢 {team?.name}</button>
                          <button onClick={() => setDeciderWinner("B")} style={{ flex: 1, background: deciderWinner === "B" ? "#dc2626" : "#1e293b", border: "1px solid " + (deciderWinner === "B" ? "#dc2626" : "#475569"), borderRadius: 6, color: "#f1f5f9", padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🔴 Opponents</button>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => saveResult(chukka)} style={{ flex: 1, background: "#16a34a", border: "1px solid #16a34a", borderRadius: 8, color: "#fff", padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Save Result</button>
                    <button onClick={() => setEditId(null)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", padding: "12px 16px", fontSize: 14, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {allForResults.length === 0 && <p style={{ color: "#475569", fontSize: 14, textAlign: "center" }}>No chukkas yet</p>}
      </div>
    </div>
  );
}

// ── Teams Tab ─────────────────────────────────────────────────────────────────
function TeamsTab({ event, onUpdate }) {
  const { teams, horses } = event;
  const [activeTeam, setActiveTeam] = useState(teams[0]?.id || null);
  const [playerName, setPlayerName] = useState("");
  const [playerDiv, setPlayerDiv] = useState("Beginner");
  const active = teams.find(t => t.id === activeTeam);

  function updatePrefs(teamId, playerId, prefs) {
    onUpdate({ ...event, teams: teams.map(t => t.id === teamId ? { ...t, players: t.players.map(p => p.id === playerId ? { ...p, preferences: prefs } : p) } : t) });
  }

  function movePreference(teamId, playerId, from, to) {
    const team = teams.find(t => t.id === teamId);
    const player = team.players.find(p => p.id === playerId);
    const prefs = [...player.preferences];
    const [moved] = prefs.splice(from, 1);
    prefs.splice(to, 0, moved);
    updatePrefs(teamId, playerId, prefs);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {teams.map(t => (
          <button key={t.id} onClick={() => setActiveTeam(t.id)} style={{ background: activeTeam === t.id ? "#16a34a" : "#1e293b", border: "1px solid " + (activeTeam === t.id ? "#16a34a" : "#334155"), borderRadius: 6, color: "#f1f5f9", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {t.name} ({t.players.length})
          </button>
        ))}
      </div>
      {active && (
        <Card>
          <p style={{ color: "#f1f5f9", fontWeight: 700, margin: "0 0 12px" }}>{active.name}</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Input value={playerName} onChange={setPlayerName} placeholder="Player name" style={{ flex: 2, minWidth: 120 }} />
            <Select value={playerDiv} onChange={setPlayerDiv} style={{ flex: 1, minWidth: 100 }}>
              {DIVISIONS.map(d => <option key={d}>{d}</option>)}
            </Select>
            <Btn onClick={() => {
              if (!playerName.trim()) return;
              onUpdate({ ...event, teams: teams.map(t => t.id === active.id ? { ...t, players: [...t.players, { id: uid(), name: playerName.trim(), division: playerDiv, preferences: [] }] } : t) });
              setPlayerName("");
            }}>Add</Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {active.players.map(player => (
              <div key={player.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ color: "#f1f5f9", fontWeight: 600, flex: 1 }}>{player.name}</span>
                  <Badge color={DIV_COLOR[player.division]}>{player.division}</Badge>
                  <Btn small danger onClick={() => onUpdate({ ...event, teams: teams.map(t => t.id === active.id ? { ...t, players: t.players.filter(p => p.id !== player.id) } : t) })}>✕</Btn>
                </div>
                <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Horse preferences (in order)</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  {player.preferences.map((horseId, idx) => {
                    const horse = horses.find(h => h.id === horseId);
                    if (!horse) return null;
                    return (
                      <div key={horseId} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e293b", borderRadius: 4, padding: "4px 8px" }}>
                        <span style={{ color: "#64748b", fontSize: 11, width: 16 }}>{idx + 1}</span>
                        <span style={{ color: "#f1f5f9", flex: 1, fontSize: 13 }}>{horse.name}</span>
                        <Btn small variant="secondary" onClick={() => idx > 0 && movePreference(active.id, player.id, idx, idx - 1)} disabled={idx === 0}>↑</Btn>
                        <Btn small variant="secondary" onClick={() => idx < player.preferences.length - 1 && movePreference(active.id, player.id, idx, idx + 1)} disabled={idx === player.preferences.length - 1}>↓</Btn>
                        <Btn small danger onClick={() => updatePrefs(active.id, player.id, player.preferences.filter(id => id !== horseId))}>✕</Btn>
                      </div>
                    );
                  })}
                </div>
                <Select value="" onChange={v => v && updatePrefs(active.id, player.id, [...player.preferences, v])}>
                  <option value="">+ Add horse to preferences</option>
                  {horses.filter(h => !player.preferences.includes(h.id)).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Ponies Tab ────────────────────────────────────────────────────────────────
function PoniesTab({ event, roster, onUpdate }) {
  const { horses, welfareRules } = event;
  const [showWelfare, setShowWelfare] = useState(false);
  const rosterNotInEvent = roster.filter(r => !horses.find(h => h.id === r.id || h.name === r.name));

  function toggleAvailable(horseId) {
    onUpdate({ ...event, horses: horses.map(h => h.id === horseId ? { ...h, unavailable: h.unavailable !== true } : h) });
  }
  function updateMax(horseId, val) {
    onUpdate({ ...event, horses: horses.map(h => h.id === horseId ? { ...h, maxChukkas: parseInt(val) || 4 } : h) });
  }
  function addFromRoster(rosterId) {
    if (!rosterId) return;
    const rh = roster.find(r => r.id === rosterId);
    if (!rh) return;
    onUpdate({ ...event, horses: [...horses, { ...rh, unavailable: false }] });
  }

  const available = horses.filter(h => h.unavailable !== true);
  const unavailable = horses.filter(h => h.unavailable === true);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>{available.length} available · {unavailable.length} unavailable</p>
        <button onClick={() => setShowWelfare(v => !v)} style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#64748b", padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>
          {showWelfare ? "Hide welfare" : "Edit welfare"}
        </button>
      </div>
      {showWelfare && (
        <div style={{ marginBottom: 16 }}>
          <WelfareRulesEditor welfareRules={welfareRules} onChange={wr => onUpdate({ ...event, welfareRules: wr })} />
        </div>
      )}
      {rosterNotInEvent.length > 0 && (
        <Card style={{ marginBottom: 16, background: "#0a0f1e", borderColor: "#1e293b" }}>
          <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>Add pony to this event</p>
          <select defaultValue="" onChange={e => { addFromRoster(e.target.value); e.target.value = ""; }}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 14, outline: "none", width: "100%" }}>
            <option value="">Select pony from roster...</option>
            {rosterNotInEvent.map(h => <option key={h.id} value={h.id}>{h.name} (max {h.maxChukkas})</option>)}
          </select>
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {horses.map(h => {
          const isUnavailable = h.unavailable === true;
          return (
            <div key={h.id} style={{ background: isUnavailable ? "#450a0a" : "#1e293b", border: "1px solid " + (isUnavailable ? "#dc2626" : "#334155"), borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", flexShrink: 0, background: isUnavailable ? "#f87171" : "#4ade80", boxShadow: "0 0 6px " + (isUnavailable ? "#f87171" : "#4ade80") }} />
              <span style={{ flex: 1, color: isUnavailable ? "#94a3b8" : "#f1f5f9", fontWeight: 600, fontSize: 15, textDecoration: isUnavailable ? "line-through" : "none" }}>{h.name}</span>
              {!isUnavailable && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#64748b", fontSize: 11 }}>Max</span>
                  <select value={h.maxChukkas} onChange={e => updateMax(h.id, e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#f1f5f9", padding: "4px 8px", fontSize: 13 }}>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
              <button onClick={() => toggleAvailable(h.id)} style={{ background: isUnavailable ? "#16a34a" : "#0f172a", border: "1px solid " + (isUnavailable ? "#16a34a" : "#dc2626"), borderRadius: 6, color: isUnavailable ? "#fff" : "#f87171", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {isUnavailable ? "✓ Restore" : "Unavailable"}
              </button>
            </div>
          );
        })}
        {horses.length === 0 && <p style={{ color: "#475569", fontSize: 14, textAlign: "center" }}>No ponies in this event</p>}
      </div>
    </div>
  );
}

// ── Welfare Tab ───────────────────────────────────────────────────────────────
function WelfareTab({ event, onUpdate }) {
  return (
    <div>
      <p style={{ color: "#475569", fontSize: 12, margin: "0 0 12px" }}>Changes take effect immediately in the day view.</p>
      <WelfareRulesEditor welfareRules={event.welfareRules} onChange={wr => onUpdate({ ...event, welfareRules: wr })} />
    </div>
  );
}

// ── Print View ────────────────────────────────────────────────────────────────
function PrintView({ day, event, allDayResults }) {
  const { teams, horses, welfareRules, name } = event;
  const teamWins = getTeamWins(teams, allDayResults);
  const locks = day.locks || {};

  const bracketChukkas = SUMMER_2026_RAW[day.name] ? findConroyChukkas(day.name, teams, day.results || {}) : [];
  const manualChukkas = (day.schedule || []).map(c => ({ ...c, conroyTeam: teams.find(t => t.id === c.teamId), branch: c.branch || "confirmed" }));
  const all = [...bracketChukkas, ...manualChukkas.filter(mc => !bracketChukkas.some(bc => bc.chukkaNum === mc.chukkaNum && bc.conroyTeam?.id === mc.teamId))];
  const allocatable = bracketToAllocatable(all);
  const { assignments } = runAllocation(allocatable, teams, horses, welfareRules, teamWins, locks, 0);
  const sorted = [...allocatable].sort((a, b) => (parseInt(a.chukkaNum) || 0) - (parseInt(b.chukkaNum) || 0));
  const wl = { DONE: "DONE", UNTACK: "UNTACK", BANDAGES: "BANDS OFF", READY: "BACK SOON" };

  return (
    <div style={{ background: "#fff", color: "#000", padding: 20, fontFamily: "monospace", fontSize: 12, lineHeight: 1.4 }}>
      <h2 style={{ textAlign: "center", margin: "0 0 2px" }}>CONROY POLO — SUPA ALLOCATION</h2>
      <p style={{ textAlign: "center", margin: "0 0 2px", fontSize: 13, fontWeight: 700 }}>{name} — {day.name}</p>
      <p style={{ textAlign: "center", margin: "0 0 16px", fontSize: 10, color: "#666" }}>Printed {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #000" }}>
            {["CHU","TIME","P","BRANCH","TEAM","PLAYER","PONY","AFTER"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "4px 6px" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((chukka, ci) => {
            const team = teams.find(t => t.id === chukka.teamId);
            return (chukka.playerIds || []).map((pid, ai) => {
              const player = team?.players.find(p => p.id === pid);
              const a = assignments[chukka.id]?.[pid];
              const horse = a?.horseId ? horses.find(h => h.id === a.horseId) : null;
              const isLocked = !!locks[chukka.id]?.[pid];
              return (
                <tr key={ci+"-"+ai} style={{ borderBottom: "1px solid #ddd", background: chukka.branch === "win" ? "#f0fff4" : chukka.branch === "loss" ? "#fff5f5" : "#fff" }}>
                  <td style={{ padding: "3px 6px", fontWeight: 700 }}>{ai === 0 ? chukka.chukkaNum : ""}</td>
                  <td style={{ padding: "3px 6px" }}>{ai === 0 ? chukka.time : ""}</td>
                  <td style={{ padding: "3px 6px" }}>{ai === 0 ? (chukka.pitch || "") : ""}</td>
                  <td style={{ padding: "3px 6px", fontSize: 10 }}>{ai === 0 ? (chukka.branch !== "confirmed" ? chukka.branch?.toUpperCase() : "") : ""}</td>
                  <td style={{ padding: "3px 6px" }}>{ai === 0 ? team?.name : ""}</td>
                  <td style={{ padding: "3px 6px" }}>{player?.name}</td>
                  <td style={{ padding: "3px 6px", fontWeight: 700 }}>{horse ? (isLocked ? "🔒 " : "") + horse.name : "⚠ NONE"}</td>
                  <td style={{ padding: "3px 6px", fontSize: 10 }}>{a?.welfare ? wl[a.welfare.code] : ""}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 12, fontSize: 10, color: "#666", borderTop: "1px solid #ddd", paddingTop: 8 }}>
        <strong>Welfare:</strong> DONE · UNTACK ({welfareRules.fullyUntack}+ rest) · BANDS OFF ({welfareRules.bandagesOnly}+ rest) · BACK SOON · 🔒 = manual lock
      </div>
    </div>
  );
}

// ── Export / Import ───────────────────────────────────────────────────────────
function ExportImport({ data, onImport }) {
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function handleExport() {
    const json = JSON.stringify(data, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    } else { setShowImport(true); setImportText(json); }
  }

  function handleImport() {
    try { onImport(JSON.parse(importText)); setShowImport(false); setImportText(""); setError(""); }
    catch { setError("Invalid data — check you copied the full export"); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Card style={{ background: "#0a0f1e", borderColor: "#1e293b" }}>
        <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>Transfer data between devices</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={() => {
            const keys = [];
            try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch(e) {}
            const found = keys.filter(k => k && (k.includes('supa') || k.includes('allocator') || k.includes('conroy')));
            if (found.length === 0) { alert('No previous data found in browser storage.'); return; }
            for (const key of found) {
              try {
                const val = localStorage.getItem(key);
                if (!val) continue;
                const parsed = JSON.parse(val);
                if ((parsed.events?.length > 0 || parsed.roster?.length > 0) && parsed.roster !== undefined) {
                  if (parsed.roster?.length > 0 || parsed.events?.length > 0) {
                    localStorage.setItem('supa-allocator-v4', val);
                    alert('✓ Recovered data from key: ' + key + '\n\nFound ' + (parsed.events?.length || 0) + ' events and ' + (parsed.roster?.length || 0) + ' roster ponies.\n\nReloading now...');
                    window.location.reload();
                    return;
                  }
                }
              } catch(e) {}
            }
            alert('Found storage keys but no valid event data: ' + found.join(', '));
          }} style={{ flex: 1, background: "#422006", border: "1px solid #d97706", borderRadius: 6, color: "#fbbf24", padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            🔍 Recover lost data
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: showImport ? 12 : 0 }}>
          <button onClick={handleExport} style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: copied ? "#4ade80" : "#f1f5f9", padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{copied ? "✓ Copied!" : "📋 Export"}</button>
          <button onClick={() => { setShowImport(v => !v); setError(""); setImportText(""); }} style={{ flex: 1, background: showImport ? "#1e3a5f" : "#1e293b", border: "1px solid " + (showImport ? "#3b82f6" : "#334155"), borderRadius: 6, color: "#f1f5f9", padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📥 Import</button>
        </div>
        {showImport && (
          <div style={{ marginTop: 12 }}>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste exported data here..." rows={4}
              style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "monospace", resize: "vertical" }} />
            {error && <p style={{ color: "#f87171", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={handleImport} style={{ flex: 1, background: "#1d4ed8", border: "1px solid #1d4ed8", borderRadius: 6, color: "#fff", padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Import — overwrite current data</button>
              <button onClick={() => { setShowImport(false); setImportText(""); setError(""); }} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}


// ── Event Detail ──────────────────────────────────────────────────────────────
function EventDetail({ event, roster, onUpdate, onBack, onDelete }) {
  const [activeTab, setActiveTab] = useState("days");
  const [activeDayId, setActiveDayId] = useState(null);
  const [dayTab, setDayTab] = useState("dayview");
  const [printing, setPrinting] = useState(false);
  const [newDayName, setNewDayName] = useState("");

  const days = event.days || [];
  const activeDay = days.find(d => d.id === activeDayId);
  const allDayResults = days.map(d => d.results || {});

  function addDay() {
    const name = newDayName.trim() || `Day ${days.length + 1}`;
    const newDay = { id: uid(), name, schedule: [], results: {}, locks: {} };
    onUpdate({ ...event, days: [...days, newDay] });
    setActiveDayId(newDay.id);
    setNewDayName("");
    setActiveTab("day");
    setDayTab("dayview");
  }

  function updateDay(updated) {
    onUpdate({ ...event, days: days.map(d => d.id === updated.id ? updated : d) });
  }

  function deleteDay(id) {
    const remaining = days.filter(d => d.id !== id);
    onUpdate({ ...event, days: remaining });
    setActiveDayId(remaining[0]?.id || null);
    if (remaining.length === 0) setActiveTab("days");
  }

  if (printing && activeDay) {
    return (
      <div>
        <div style={{ padding: 12, background: "#1e293b", display: "flex", gap: 8 }}>
          <Btn onClick={() => window.print()}>🖨 Print</Btn>
          <Btn variant="secondary" onClick={() => setPrinting(false)}>← Back</Btn>
        </div>
        <PrintView day={activeDay} event={event} allDayResults={allDayResults} />
      </div>
    );
  }

  const mainTabs = [
    { id: "days", label: "Days" },
    { id: "teams", label: "Teams" },
    { id: "ponies", label: "Ponies" },
    { id: "welfare", label: "Welfare" },
  ];
  const dayTabs = [
    { id: "dayview", label: "Day View" },
    { id: "schedule", label: "Schedule" },
    { id: "results", label: "Results" },
  ];

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0a0f1e", borderBottom: "1px solid #1e293b", padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1 }}>
            <p style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, margin: 0 }}>{event.name}</p>
            <p style={{ color: "#475569", fontSize: 11, margin: 0 }}>
              {event.date ? new Date(event.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No date"}
              {" · "}{event.horses?.length || 0} ponies · {event.teams?.length || 0} teams · {days.length} day{days.length !== 1 ? "s" : ""}
            </p>
          </div>
          {activeDay && <Btn small onClick={() => setPrinting(true)}>🖨</Btn>}
        </div>
      </div>

      {/* Main nav */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", overflowX: "auto", background: "#0a0f1e" }}>
        {mainTabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: "none", border: "none",
            borderBottom: activeTab === t.id ? "2px solid #16a34a" : "2px solid transparent",
            color: activeTab === t.id ? "#f1f5f9" : "#475569",
            padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
        {days.map(d => (
          <button key={d.id} onClick={() => { setActiveDayId(d.id); setActiveTab("day"); }} style={{
            background: "none", border: "none",
            borderBottom: activeTab === "day" && activeDayId === d.id ? "2px solid #3b82f6" : "2px solid transparent",
            color: activeTab === "day" && activeDayId === d.id ? "#93c5fd" : "#475569",
            padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>{d.name}</button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>

        {/* Days management */}
        {activeTab === "days" && (
          <div>
            <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 16px" }}>Event Days</h2>

            {/* Summer 2026 quick-add */}
            {Object.keys(SUMMER_2026_RAW).filter(dn => !days.find(d => d.name === dn)).length > 0 && (
              <Card style={{ marginBottom: 16, background: "#14532d22", borderColor: "#16a34a44" }}>
                <p style={{ color: "#4ade80", fontWeight: 700, fontSize: 13, margin: "0 0 8px" }}>Summer Nationals 2026</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.keys(SUMMER_2026_RAW).filter(dn => !days.find(d => d.name === dn)).map(dn => (
                    <button key={dn} onClick={() => {
                      const newDay = { id: uid(), name: dn, schedule: [], results: {}, locks: {} };
                      onUpdate({ ...event, days: [...days, newDay] });
                      setActiveDayId(newDay.id); setActiveTab("day");
                    }} style={{ background: "#16a34a", border: "none", borderRadius: 6, color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      + {dn}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            <Card style={{ marginBottom: 16 }}>
              <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>Add custom day</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Input value={newDayName} onChange={setNewDayName} placeholder="Day name..." />
                <Btn onClick={addDay}>Add</Btn>
              </div>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {days.map(d => {
                const lockCount = Object.values(d.locks || {}).reduce((n, v) => n + Object.keys(v).length, 0);
                const chukkaCount = SUMMER_2026_RAW[d.name]
                  ? findConroyChukkas(d.name, event.teams, d.results || {}).length
                  : (d.schedule || []).length;
                return (
                  <div key={d.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => { setActiveDayId(d.id); setActiveTab("day"); }} style={{ background: "none", border: "none", color: "#f1f5f9", fontWeight: 600, fontSize: 15, cursor: "pointer", flex: 1, textAlign: "left", padding: 0 }}>
                      {d.name}
                      <span style={{ color: "#475569", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>{chukkaCount} chukkas{lockCount > 0 ? ` · ${lockCount} 🔒` : ""}</span>
                    </button>
                    <DeleteButton label="Delete day" onDelete={() => deleteDay(d.id)} />
                  </div>
                );
              })}
              {days.length === 0 && <p style={{ color: "#475569", fontSize: 14, textAlign: "center" }}>No days yet</p>}
            </div>

            <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #1e293b" }}>
              <DeleteButton label="Delete Event" onDelete={() => onDelete(event.id)} />
            </div>
          </div>
        )}

        {/* Day view */}
        {activeTab === "day" && activeDay && (
          <div>
            <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: "0 0 12px" }}>{activeDay.name}</h2>
            <div style={{ display: "flex", borderBottom: "1px solid #334155", marginBottom: 16 }}>
              {dayTabs.map(t => (
                <button key={t.id} onClick={() => setDayTab(t.id)} style={{
                  background: "none", border: "none",
                  borderBottom: dayTab === t.id ? "2px solid #3b82f6" : "2px solid transparent",
                  color: dayTab === t.id ? "#93c5fd" : "#475569",
                  padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>{t.label}</button>
              ))}
            </div>
            {dayTab === "dayview"  && <DayViewTab  day={activeDay} event={event} allDayResults={allDayResults} onUpdateDay={updateDay} />}
            {dayTab === "schedule" && <ScheduleTab day={activeDay} event={event} onUpdateDay={updateDay} />}
            {dayTab === "results"  && <ResultsTab  day={activeDay} event={event} onUpdateDay={updateDay} />}
          </div>
        )}

        {activeTab === "teams"   && <TeamsTab   event={event} onUpdate={onUpdate} />}
        {activeTab === "ponies"  && <PoniesTab  event={event} roster={roster} onUpdate={onUpdate} />}
        {activeTab === "welfare" && <WelfareTab event={event} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}

// ── Event Home ────────────────────────────────────────────────────────────────
function EventHome({ events, onSelect, onNew }) {
  return (
    <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: "#f1f5f9", fontSize: 18, margin: 0 }}>Events</h2>
        <Btn onClick={onNew}>+ New Event</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...events].reverse().map(event => (
          <button key={event.id} onClick={() => onSelect(event.id)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 16, cursor: "pointer", textAlign: "left", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>{event.name}</p>
                <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>
                  {event.date ? new Date(event.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date"}
                  {" · "}{event.horses?.length || 0} ponies · {event.teams?.length || 0} teams · {(event.days || []).length} day{(event.days || []).length !== 1 ? "s" : ""}
                </p>
              </div>
              <span style={{ color: "#475569", fontSize: 18 }}>›</span>
            </div>
          </button>
        ))}
        {events.length === 0 && (
          <Card style={{ textAlign: "center", padding: 32 }}>
            <p style={{ color: "#475569", margin: "0 0 16px" }}>No events yet</p>
            <Btn onClick={onNew}>+ Create your first event</Btn>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(() => loadData());
  const [view, setView] = useState("home");
  const [activeEventId, setActiveEventId] = useState(null);

  function update(next) { setData(next); saveData(next); }
  function updateRoster(roster) { update({ ...data, roster }); }
  function addEvent(event) { update({ ...data, events: [...data.events, event] }); setActiveEventId(event.id); setView("event"); }
  function updateEvent(updated) { update({ ...data, events: data.events.map(e => e.id === updated.id ? updated : e) }); }
  function deleteEvent(id) { update({ ...data, events: data.events.filter(e => e.id !== id) }); setView("home"); }

  const activeEvent = data.events.find(e => e.id === activeEventId);

  if (view === "newEvent") {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh" }}>
        <div style={{ background: "#0a0f1e", borderBottom: "1px solid #1e293b", padding: "12px 16px" }}>
          <h1 style={{ color: "#f1f5f9", margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>CONROY POLO</h1>
          <p style={{ color: "#475569", margin: 0, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>New Event</p>
        </div>
        <NewEventWizard roster={data.roster} onSave={addEvent} onCancel={() => setView("home")} />
      </div>
    );
  }

  if (view === "event" && activeEvent) {
    return <EventDetail event={activeEvent} roster={data.roster} onUpdate={updateEvent} onBack={() => setView("home")} onDelete={deleteEvent} />;
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", fontFamily: "'DM Mono', 'Courier New', monospace" }}>
      <div style={{ background: "#0a0f1e", borderBottom: "1px solid #1e293b", padding: "12px 16px" }}>
        <h1 style={{ color: "#f1f5f9", margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>CONROY POLO</h1>
        <p style={{ color: "#475569", margin: 0, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>SUPA Allocator</p>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", background: "#0a0f1e" }}>
        {[{ id: "home", label: "Events" }, { id: "roster", label: "Pony Roster" }].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            background: "none", border: "none",
            borderBottom: view === t.id ? "2px solid #16a34a" : "2px solid transparent",
            color: view === t.id ? "#f1f5f9" : "#475569",
            padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
        <ExportImport data={data} onImport={imported => { saveData(imported); setData(imported); }} />
        {view === "home"   && <EventHome events={data.events} onSelect={id => { setActiveEventId(id); setView("event"); }} onNew={() => setView("newEvent")} />}
        {view === "roster" && <RosterManager roster={data.roster} onChange={updateRoster} />}
      </div>
    </div>
  );
}
