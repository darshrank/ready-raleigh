/**
 * Every tunable game number lives here (costs, budget, timers, coverage
 * radii, flood levels, scoring weights). The product plan marks these as
 * placeholders to tune, so change them here and nowhere else.
 */
export const CONFIG = {
  budget: 10_000_000,
  timers: {
    briefingSeconds: 25,
    planningSeconds: 180,
  },

  interventions: {
    shelter: {
      label: 'Shelter',
      cost: 3_000_000,
      /** people one shelter can take */
      capacity: 3_000,
      /** residents with a car are covered if they can drive there within this */
      driveMinutes: 15,
      blurb: 'Covers residents who can drive to it within 15 minutes on roads that are still open.',
    },
    bus: {
      label: 'Bus pickup',
      cost: 1_000_000,
      /** riders one pickup point can move during the event */
      capacity: 400,
      /** households without a car within this walk of the stop */
      walkMinutes: 10,
      /** max bus ride from the stop to an open shelter */
      rideMinutes: 20,
      blurb: 'Households without a car within a 10-minute walk ride a bus to the nearest open shelter.',
    },
    road: {
      label: 'Road protection',
      cost: 2_000_000,
      blurb: 'Raise or barrier one flood-prone road so it stays open for the whole event.',
    },
  },

  travel: {
    /** free-flow speeds by OSM road class, km/h */
    speedKmh: {
      motorway: 95, trunk: 75, primary: 55, secondary: 50, tertiary: 45,
      unclassified: 40, residential: 35, living_street: 15,
    } as Record<string, number>,
    /** evacuation traffic: fraction of free-flow speed actually achieved */
    evacuationSpeedFactor: 0.6,
    walkKmh: 4.5,
  },

  flood: {
    /** water levels above normal channel stage (m) that the event steps through */
    stages: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
    /** a road closes once water on it is this deep (m) - 30 cm floats most cars */
    roadClosureDepth: 0.3,
    /** a home is at risk once water reaches it (m of depth at the building) */
    homeFloodDepth: 0,
  },

  scoring: {
    /** extra weight per person in each vulnerable group (base weight is 1) */
    weights: { elderly: 1, poverty: 1, nocar: 1 },
  },

  simulation: {
    /** seconds of animation per flood stage */
    secondsPerStage: 4,
    /** animation seconds per real minute of travel */
    secondsPerTravelMinute: 0.3,
    peoplePerDot: 12,
    maxDots: 3000,
  },
} as const

export type InterventionKind = keyof typeof CONFIG.interventions
