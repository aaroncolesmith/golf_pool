import { AppState, Golfer, Pool, PoolEntry, Tournament, User } from "@/lib/types";

const tournamentId = "masters-2026";
const adminUserId = "user-admin";
const defaultPoolId = "pool-masters";

export const sampleTournaments: Tournament[] = [
  {
    id: tournamentId,
    name: "The Masters",
    course: "Augusta National Golf Club",
    startDate: "2026-04-09T12:00:00.000Z",
    status: "upcoming",
    purse: "$20,000,000",
    source: "sample",
  },
  {
    id: "pga-championship-2026",
    name: "PGA Championship",
    course: "Aronimink Golf Club",
    startDate: "2026-05-14T12:00:00.000Z",
    status: "upcoming",
    purse: "$18,500,000",
    source: "sample",
  },
];

const sampleGolferRows: [string, number, number, number, string, boolean, number][] = [
  ["Scottie Scheffler", 450, 0.182, -7, "1", true, 2],
  ["Rory McIlroy", 700, 0.125, -5, "T3", true, 2],
  ["Jon Rahm", 900, 0.1, -6, "2", true, 2],
  ["Xander Schauffele", 1400, 0.067, -4, "T6", true, 2],
  ["Ludvig Aberg", 1600, 0.059, -2, "T14", true, 2],
  ["Collin Morikawa", 1800, 0.053, -3, "T10", true, 2],
  ["Patrick Cantlay", 2200, 0.043, -1, "T18", true, 2],
  ["Viktor Hovland", 2500, 0.038, 0, "T28", true, 2],
  ["Tommy Fleetwood", 2800, 0.034, 1, "T39", true, 2],
  ["Hideki Matsuyama", 3000, 0.032, -2, "T14", true, 2],
  ["Jordan Spieth", 3500, 0.028, 2, "T47", true, 2],
  ["Brooks Koepka", 4000, 0.024, 3, "T53", true, 2],
  ["Sungjae Im", 5000, 0.019, -1, "T18", true, 2],
  ["Shane Lowry", 5500, 0.017, 4, "T61", false, 2],
  ["Russell Henley", 6000, 0.016, 0, "T28", true, 2],
  ["Sepp Straka", 6500, 0.015, 6, "CUT", false, 2],
  ["Corey Conners", 7000, 0.014, 1, "T39", true, 2],
  ["Tony Finau", 7500, 0.013, 5, "CUT", false, 2],
  ["Adam Scott", 8000, 0.012, 2, "T47", true, 2],
  ["Wyndham Clark", 9000, 0.011, 7, "CUT", false, 2],
  ["Min Woo Lee", 10000, 0.01, -1, "T18", true, 2],
  ["Sahith Theegala", 11000, 0.009, 2, "T47", true, 2],
  ["Akshay Bhatia", 12500, 0.008, 8, "CUT", false, 2],
  ["Brian Harman", 15000, 0.007, 3, "T53", true, 2],
];

export const sampleGolfers: Golfer[] = sampleGolferRows.map(
  ([name, oddsAmerican, impliedProbability, currentScoreToPar, position, madeCut, roundsComplete], index) => ({
  id: `golfer-${index + 1}`,
  name,
  oddsAmerican,
  impliedProbability,
  tournamentId,
  currentScoreToPar,
  position,
  madeCut,
  roundsComplete,
  }),
);

export const sampleUsers: User[] = [
  {
    id: adminUserId,
    email: "commissioner@example.com",
    userName: "Commissioner",
    createdAt: "2026-03-20T12:00:00.000Z",
  },
  {
    id: "user-2",
    email: "alex@example.com",
    userName: "Alex",
    createdAt: "2026-03-20T12:30:00.000Z",
  },
];

export const defaultTiers = [
  { id: "tier-1", label: "Tier 1", golferIds: sampleGolfers.slice(0, 4).map((golfer) => golfer.id) },
  { id: "tier-2", label: "Tier 2", golferIds: sampleGolfers.slice(4, 8).map((golfer) => golfer.id) },
  { id: "tier-3", label: "Tier 3", golferIds: sampleGolfers.slice(8, 12).map((golfer) => golfer.id) },
  { id: "tier-4", label: "Tier 4", golferIds: sampleGolfers.slice(12, 16).map((golfer) => golfer.id) },
  { id: "tier-5", label: "Tier 5", golferIds: sampleGolfers.slice(16, 20).map((golfer) => golfer.id) },
  { id: "tier-6", label: "Tier 6", golferIds: sampleGolfers.slice(20, 24).map((golfer) => golfer.id) },
];

export const samplePools: Pool[] = [
  {
    id: defaultPoolId,
    name: "Friends of Augusta",
    tournamentId,
    adminUserId,
    joinCode: "AZALEA26",
    invitedEmails: ["alex@example.com", "morgan@example.com"],
    memberUserIds: [adminUserId, "user-2"],
    createdAt: "2026-03-24T12:00:00.000Z",
    lockAt: "2026-04-09T11:45:00.000Z",
    tiers: defaultTiers,
  },
];

export const sampleEntries: PoolEntry[] = [
  {
    id: "entry-admin",
    poolId: defaultPoolId,
    userId: adminUserId,
    submittedAt: "2026-03-25T14:20:00.000Z",
    selections: [
      { tierId: "tier-1", golferId: "golfer-1" },
      { tierId: "tier-2", golferId: "golfer-6" },
      { tierId: "tier-3", golferId: "golfer-9" },
      { tierId: "tier-4", golferId: "golfer-13" },
      { tierId: "tier-5", golferId: "golfer-17" },
      { tierId: "tier-6", golferId: "golfer-21" },
    ],
  },
  {
    id: "entry-alex",
    poolId: defaultPoolId,
    userId: "user-2",
    submittedAt: "2026-03-26T09:10:00.000Z",
    selections: [
      { tierId: "tier-1", golferId: "golfer-3" },
      { tierId: "tier-2", golferId: "golfer-5" },
      { tierId: "tier-3", golferId: "golfer-10" },
      { tierId: "tier-4", golferId: "golfer-14" },
      { tierId: "tier-5", golferId: "golfer-18" },
      { tierId: "tier-6", golferId: "golfer-22" },
    ],
  },
];

export const initialState: AppState = {
  users: sampleUsers,
  currentUserId: null,
  pendingMagicLinks: [],
  tournaments: sampleTournaments,
  golfers: sampleGolfers,
  pools: samplePools,
  entries: sampleEntries,
};
