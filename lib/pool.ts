import { Golfer, Pool, TeamSelection, Tier } from "@/lib/types";

export function buildTiersFromOdds(golfers: Golfer[], totalTiers = 6): Tier[] {
  const ordered = [...golfers].sort((a, b) => b.impliedProbability - a.impliedProbability);
  const tierSize = Math.ceil(ordered.length / totalTiers);

  return Array.from({ length: totalTiers }, (_, index) => ({
    id: `tier-${index + 1}`,
    label: `Tier ${index + 1}`,
    golferIds: ordered.slice(index * tierSize, index * tierSize + tierSize).map((golfer) => golfer.id),
  })).filter((tier) => tier.golferIds.length > 0);
}

export function isPoolLocked(pool: Pool) {
  return new Date(pool.lockAt).getTime() <= Date.now();
}

export function validateSelections(pool: Pool, selections: TeamSelection[]) {
  const errors: string[] = [];

  if (selections.length !== pool.tiers.length) {
    errors.push(`You need ${pool.tiers.length} golfers before submitting.`);
  }

  const tierIds = new Set<string>();
  const golferIds = new Set<string>();

  for (const selection of selections) {
    const tier = pool.tiers.find((candidate) => candidate.id === selection.tierId);

    if (!tier) {
      errors.push("One of the tier selections is invalid.");
      continue;
    }

    if (tierIds.has(selection.tierId)) {
      errors.push("You can only choose one golfer per tier.");
    }

    if (golferIds.has(selection.golferId)) {
      errors.push("The same golfer cannot be selected twice.");
    }

    if (!tier.golferIds.includes(selection.golferId)) {
      errors.push("A selected golfer is not available in that tier.");
    }

    tierIds.add(selection.tierId);
    golferIds.add(selection.golferId);
  }

  return {
    isValid: errors.length === 0,
    errors: Array.from(new Set(errors)),
  };
}

export function poolSharePath(pool: Pool) {
  return `/join/${pool.joinCode}`;
}
