export type Golfer = {
  id: string;
  name: string;
  oddsAmerican: number;
  impliedProbability: number;
  tournamentId: string;
  currentScoreToPar: number;
  position: string;
  madeCut: boolean;
  roundsComplete: number;
};

export type Tier = {
  id: string;
  label: string;
  golferIds: string[];
};

export type Tournament = {
  id: string;
  name: string;
  course: string;
  startDate: string;
  status: "upcoming" | "in_progress" | "finished";
  purse: string;
  source?: "sample" | "draftkings";
  sourceUrl?: string;
  oddsSourceUrl?: string;
  importMeta?: {
    leagueId: number | null;
    eventId: string | null;
    categoryId: number | null;
    subcategoryId: number | null;
  } | null;
};

export type User = {
  id: string;
  email: string;
  userName: string;
  createdAt: string;
};

export type AuthResult = {
  ok: boolean;
  message: string;
  detail?: string;
};

export type TeamSelection = {
  tierId: string;
  golferId: string;
};

export type PoolEntry = {
  id: string;
  poolId: string;
  userId: string;
  selections: TeamSelection[];
  submittedAt: string | null;
};

export type Pool = {
  id: string;
  name: string;
  tournamentId: string;
  adminUserId: string;
  joinCode: string;
  invitedEmails: string[];
  memberUserIds: string[];
  createdAt: string;
  lockAt: string;
  tiers: Tier[];
};

export type AppState = {
  users: User[];
  currentUserId: string | null;
  tournaments: Tournament[];
  golfers: Golfer[];
  pools: Pool[];
  entries: PoolEntry[];
  scoresLastSyncedAt: string | null;
};

export type LeaderboardRow = {
  entryId: string;
  userId: string;
  teamName: string;
  countingGolfers: Golfer[];
  benchGolfers: Golfer[];
  teamScore: number | null;
  status: "live" | "locked" | "eliminated";
};
