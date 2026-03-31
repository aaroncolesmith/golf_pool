import "server-only";

import { Golfer, Tournament } from "@/lib/types";

const DRAFTKINGS_GOLF_URL = "https://sportsbook.draftkings.com/sports/golf";
const SPORTBOOK_BASE_URL = "https://sportsbook.draftkings.com";
const DRAFTKINGS_API_BASE_URL = "https://sportsbook-nash.draftkings.com/sites/US-OR-SB/api/sportscontent/controldata";
const GOLF_SPORT_ID = "12";
const GOLF_WINNER_SUBCATEGORY_ID = "4508";

type DraftKingsUpcomingTournament = {
  id: string;
  leagueId: string;
  slug: string;
  name: string;
  startDate: string | null;
  url: string;
  oddsUrl: string;
};

type ImportedTournamentFeed = {
  tournament: Tournament;
  golfers: Golfer[];
  oddsSourceUrl: string;
};

type InitialStateData = {
  sports?: {
    data?: Array<{
      displayGroupId?: string | number;
      displayName?: string;
      eventGroupInfos?: Array<{
        eventGroupId?: number;
        eventGroupName?: string;
        nameIdentifier?: string;
        deepLink?: string;
        startDate?: string;
        description?: string;
      }>;
    }>;
  };
  sportsContent?: {
    navigation?: {
      leagues?: Array<{
        displayGroupId?: number;
        eventGroup?: Array<{
          eventGroupId?: number;
          name?: string;
          eventGroupDescription?: string;
          eventGroupName?: string;
        }>;
      }>;
    };
  };
};

type DraftKingsMarketsResponse = {
  leagues?: Array<{
    id?: string;
    name?: string;
    seoIdentifier?: string;
  }>;
  events?: Array<{
    id?: string;
    leagueId?: string;
    name?: string;
    startEventDate?: string;
  }>;
  markets?: Array<{
    id?: string;
    eventId?: string;
    name?: string;
    subcategoryId?: string;
    marketType?: {
      name?: string;
    };
  }>;
  selections?: Array<{
    marketId?: string;
    label?: string;
    displayOdds?: {
      american?: string;
    };
  }>;
};

function asArray<T>(value: T[] | T | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function extractInitialState(html: string): InitialStateData {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);

  if (!match) {
    throw new Error("Unable to find DraftKings page state.");
  }

  return JSON.parse(match[1]) as InitialStateData;
}

function slugifyTournamentName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractTournamentDate(name: string, description?: string) {
  const source = `${name} ${description ?? ""}`;
  const match = source.match(/\b([A-Z][a-z]{2,8}\.? \d{1,2}(?:-\d{1,2})?(?:, \d{4})?)\b/);

  if (!match) {
    return null;
  }

  const normalized = match[1].replace(/(\d{1,2})-(\d{1,2})(, \d{4})?/, "$1$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTournamentName(name: string) {
  return name.replace(/\s+Sportsbook\s*$/i, "").trim();
}

function titleCaseSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function americanOddsToImpliedProbability(oddsAmerican: number) {
  if (oddsAmerican === 0) {
    return 0;
  }

  if (oddsAmerican > 0) {
    return 100 / (oddsAmerican + 100);
  }

  return Math.abs(oddsAmerican) / (Math.abs(oddsAmerican) + 100);
}

function parseAmericanOdds(value?: string) {
  if (!value) {
    return Number.NaN;
  }

  return Number.parseInt(value.replace(/[^\d+-]/g, ""), 10);
}

function createTournamentId(slug: string) {
  return `dk-${slug}`;
}

function createGolferId(tournamentId: string, golferName: string) {
  return `${tournamentId}-${slugifyTournamentName(golferName)}`;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`DraftKings request failed with ${response.status}.`);
  }

  return response.text();
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      accept: "application/json,text/plain,*/*",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`DraftKings API request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

function buildMarketsApiUrl(leagueId: string, subcategoryId = GOLF_WINNER_SUBCATEGORY_ID) {
  const params = new URLSearchParams({
    isBatchable: "false",
    templateVars: `${leagueId},${subcategoryId}`,
    eventsQuery: `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`,
    marketsQuery: `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`,
    include: "Events",
    entity: "events",
  });

  return `${DRAFTKINGS_API_BASE_URL}/league/leagueSubcategory/v1/markets?${params.toString()}`;
}

function buildGolfersFromSelections(payload: DraftKingsMarketsResponse, tournamentId: string) {
  const outrightMarket = asArray(payload.markets).find(
    (market) =>
      market.name?.toLowerCase() === "winner" ||
      market.marketType?.name?.toLowerCase() === "outright winner",
  );

  if (!outrightMarket?.id) {
    throw new Error("Could not find the DraftKings outright winner market.");
  }

  return asArray(payload.selections)
    .filter((selection) => selection.marketId === outrightMarket.id)
    .map((selection) => {
      const name = selection.label?.trim() ?? "";
      const oddsAmerican = parseAmericanOdds(selection.displayOdds?.american);

      return {
        id: createGolferId(tournamentId, name),
        name,
        oddsAmerican,
        impliedProbability: americanOddsToImpliedProbability(oddsAmerican),
        tournamentId,
        currentScoreToPar: 0,
        position: "TBD",
        madeCut: true,
        roundsComplete: 0,
      };
    })
    .filter((golfer) => golfer.name && Number.isFinite(golfer.oddsAmerican))
    .sort((a, b) => b.impliedProbability - a.impliedProbability);
}

export async function getUpcomingDraftKingsTournaments(): Promise<DraftKingsUpcomingTournament[]> {
  const html = await fetchText(DRAFTKINGS_GOLF_URL);
  const state = extractInitialState(html);
  const sportsGolf = asArray(state.sports?.data).find(
    (sport) => String(sport.displayGroupId) === GOLF_SPORT_ID || /golf/i.test(sport.displayName ?? ""),
  );

  const eventGroupInfos = asArray(sportsGolf?.eventGroupInfos);

  if (eventGroupInfos.length) {
    return eventGroupInfos
      .map((eventGroup) => {
        const name = normalizeTournamentName(
          eventGroup.eventGroupName ?? titleCaseSlug(eventGroup.nameIdentifier ?? "pga-tournament"),
        );
        const slug = eventGroup.nameIdentifier || slugifyTournamentName(name);
        const leagueId = String(eventGroup.eventGroupId ?? slug);

        return {
          id: leagueId,
          leagueId,
          slug,
          name,
          startDate: eventGroup.startDate ?? extractTournamentDate(name, eventGroup.description),
          url: eventGroup.deepLink ? `${SPORTBOOK_BASE_URL}${eventGroup.deepLink}` : `${SPORTBOOK_BASE_URL}/leagues/golf/${slug}`,
          oddsUrl: eventGroup.deepLink ? `${SPORTBOOK_BASE_URL}${eventGroup.deepLink}` : `${SPORTBOOK_BASE_URL}/leagues/golf/${slug}`,
        };
      })
      .filter((eventGroup) => eventGroup.slug);
  }

  const golfLeague = asArray(state.sportsContent?.navigation?.leagues).find(
    (league) => String(league.displayGroupId) === GOLF_SPORT_ID,
  );
  const legacyEventGroups = asArray(golfLeague?.eventGroup);

  if (!legacyEventGroups.length) {
    throw new Error("No golf tournaments were found on DraftKings.");
  }

  return legacyEventGroups
    .map((eventGroup) => {
      const rawName = eventGroup.name ?? eventGroup.eventGroupName ?? "PGA Tournament";
      const name = normalizeTournamentName(rawName);
      const slug = slugifyTournamentName(name);
      const leagueId = String(eventGroup.eventGroupId ?? slug);

      return {
        id: leagueId,
        leagueId,
        slug,
        name,
        startDate: extractTournamentDate(name, eventGroup.eventGroupDescription),
        url: `${SPORTBOOK_BASE_URL}/leagues/golf/${slug}`,
        oddsUrl: `${SPORTBOOK_BASE_URL}/leagues/golf/${slug}`,
      };
    })
    .filter((eventGroup) => eventGroup.slug);
}

export async function importDraftKingsTournament(slug: string, leagueId?: string): Promise<ImportedTournamentFeed> {
  const upcoming = await getUpcomingDraftKingsTournaments();
  const matchingTournament = upcoming.find((candidate) => candidate.slug === slug);
  const resolvedLeagueId = leagueId ?? matchingTournament?.leagueId;

  if (!resolvedLeagueId) {
    throw new Error("Could not determine the DraftKings league ID for this tournament.");
  }

  const tournamentUrl = `${SPORTBOOK_BASE_URL}/leagues/golf/${slug}`;
  const oddsSourceUrl = buildMarketsApiUrl(resolvedLeagueId);
  const payload = await fetchJson<DraftKingsMarketsResponse>(oddsSourceUrl);
  const tournamentId = createTournamentId(slug);
  const golfers = buildGolfersFromSelections(payload, tournamentId);

  if (golfers.length === 0) {
    throw new Error("Could not parse any golfers from the DraftKings markets feed.");
  }

  const event = asArray(payload.events)[0];
  const league = asArray(payload.leagues)[0];

  return {
    tournament: {
      id: tournamentId,
      name: matchingTournament?.name ?? league?.name ?? titleCaseSlug(slug),
      course: "TBD",
      startDate: matchingTournament?.startDate ?? event?.startEventDate ?? new Date().toISOString(),
      status: "upcoming",
      purse: "TBD",
      source: "draftkings",
      sourceUrl: tournamentUrl,
      oddsSourceUrl,
      importMeta: {
        leagueId: Number.parseInt(resolvedLeagueId, 10) || null,
        eventId: event?.id ?? null,
        categoryId: null,
        subcategoryId: Number.parseInt(GOLF_WINNER_SUBCATEGORY_ID, 10) || null,
      },
    },
    golfers,
    oddsSourceUrl,
  };
}

export type { DraftKingsUpcomingTournament, ImportedTournamentFeed };
