import { CITY_SCENARIOS } from "@/config/game";
import type { CityId, DisasterScenario } from "@/types";

const R = CITY_SCENARIOS.raleigh;
const M = CITY_SCENARIOS.miami;
const N = CITY_SCENARIOS["new-york"];
const S = CITY_SCENARIOS["san-francisco"];

export const SCENARIOS: Record<CityId, DisasterScenario> = {
  raleigh: {
    id: "raleigh-hurricane-cascade",
    cityId: "raleigh",
    name: "Hurricane Cascade",
    narrative: [
      "A tropical system moves inland and stalls over the Triangle.",
      "Rainfall accumulates rapidly and low-lying roads begin flooding.",
      "Communities that look close to shelter can become functionally isolated.",
    ],
    durationHours: R.durationHours,
    briefing: {
      headline: "Emergency briefing: Hurricane Cascade",
      script:
        "Emergency briefing. A slow-moving tropical system is stalling over the Triangle. " +
        "Rainfall will push Crabtree Creek, Walnut Creek and their tributaries out of their banks over the next day and a half. " +
        "An evacuation order covers every home in or near the mapped flood hazard area. " +
        "You have ten million dollars and three minutes to decide where shelters, buses and road protection go. " +
        "Some neighborhoods depend on a single crossing. Find them before the water does.",
      hazard: "Riverine and flash flooding along Raleigh's creeks, reaching the 0.2% annual-chance flood extent at peak.",
      timeline: [
        { hour: 0, label: "Rain bands arrive" },
        { hour: R.orderHour, label: "Evacuation order issued" },
        { hour: 5, label: "Floodways begin to overtop" },
        { hour: 9, label: "1% annual-chance zones flood" },
        { hour: 16, label: "0.2% zones begin flooding" },
        { hour: R.hazard.peakHour, label: "Flood peak" },
      ],
      uncertainty: [
        "Water arrival timing is a scenario proxy, not a hydraulic model.",
        "Seeded random events can close an unexpected road or speed up a creek.",
        "Population is estimated from census tracts and spread along residential streets.",
      ],
    },
    hazards: ["Intense rainfall", "Flash flooding", "Creek and river rise", "Low-lying road closure", "Shelter access loss"],
    randomEvents: [
      { id: "culvert-failure", label: "Culvert overtopped", description: "A road outside the mapped floodplain floods where it crosses a stream." },
      { id: "creek-surge", label: "Creek rises faster than expected", description: "One creek's water arrives two hours earlier than forecast." },
    ],
  },
  miami: {
    id: "miami-storm-surge-siege",
    cityId: "miami",
    name: "Storm Surge Siege",
    narrative: [
      "A major hurricane approaches South Florida.",
      "Storm surge pushes in from Biscayne Bay while rain overwhelms drainage.",
      "Inland neighborhoods can flood even if they never see the ocean.",
    ],
    durationHours: M.durationHours,
    briefing: {
      headline: "Emergency briefing: Storm Surge Siege",
      script:
        "Emergency briefing. A major hurricane will make landfall south of Miami overnight. " +
        "Heavy rain arrives first and floods low streets and ponding areas. Canals back up as the bay rises. " +
        "Then storm surge pushes in from Biscayne Bay through Brickell, Downtown and Coconut Grove. " +
        "The water has three sources. Barriers stop surge but not rain. Pumps clear rain but not surge. " +
        "You have ten million dollars and three minutes. Stay ahead of the water.",
      hazard: "Compound flooding: storm surge in FEMA coastal zones, rainfall ponding in low-lying blocks, and canal overflow.",
      timeline: [
        { hour: 0, label: "Outer bands arrive" },
        { hour: M.orderHour, label: "Evacuation order for surge zones" },
        { hour: 6.5, label: "Rain ponding in low streets" },
        { hour: 9, label: "Canals overflow" },
        { hour: 11, label: "Storm surge reaches the shoreline" },
        { hour: M.hazard.peakHour, label: "Surge and rain peak together" },
      ],
      uncertainty: [
        "Surge, rain and canal timing are scenario proxies from FEMA zone class and distance to the coast or canals.",
        "Seeded events can bring the surge early, fail a canal pump or close a canal bridge.",
        "Population is estimated from census tracts and spread along residential streets.",
      ],
    },
    hazards: ["Storm surge", "Rainfall flooding", "Canal overflow", "Road inundation", "Shelter access loss"],
    randomEvents: [
      { id: "surge-early", label: "Surge arrives early", description: "The surge front arrives 1.5 hours earlier than forecast." },
      { id: "pump-failure", label: "Pump failure", description: "One canal overflows two hours early." },
      { id: "bridge-closed", label: "Canal bridge closed", description: "A canal crossing outside the mapped zones closes." },
    ],
  },
  "new-york": {
    id: "nyc-heat-grid",
    cityId: "new-york",
    name: "Heat Grid",
    narrative: [
      "A multi-day heat dome sits over Upper Manhattan and the South Bronx.",
      "Energy demand peaks and part of the grid fails.",
      "Residents without cooling become increasingly vulnerable as the heat builds.",
    ],
    durationHours: N.durationHours,
    briefing: {
      headline: "Emergency briefing: Heat Grid",
      script:
        "Emergency briefing. A heat dome is settling over Harlem and the South Bronx, among the most heat-vulnerable neighborhoods in New York. " +
        "Heat will build block by block through the afternoon and stay high overnight. " +
        "Older adults and low-income households without air conditioning are most at risk. " +
        "The grid is strained. If power fails, cooling centers without backup generators go dark. " +
        "You have ten million dollars and three minutes. Put cooling within walking distance of the people who need it.",
      hazard: "Extreme heat, strongest where buildings are dense and shade, parks and water are scarce, plus a possible blackout.",
      timeline: [
        { hour: 0, label: "Heat dome settles in (10:00)" },
        { hour: N.orderHour, label: "Heat emergency declared" },
        { hour: N.hazard.heat!.dangerStart, label: "Hottest blocks turn dangerous" },
        { hour: N.hazard.peakHour, label: "Peak heat and grid strain" },
        { hour: 12, label: "Hot night, little relief" },
      ],
      uncertainty: [
        "Block heat is a proxy from green space and density, not measured temperature.",
        "A seeded blackout knocks out power in a cluster of neighborhoods.",
        "Who lacks home cooling is estimated from age, poverty and the NYC Heat Vulnerability Index.",
      ],
    },
    hazards: ["Extreme heat", "Urban heat island", "Cooling access deficit", "Partial power failure"],
    randomEvents: [{ id: "blackout", label: "Blackout", description: "A grid failure cuts power to a cluster of neighborhoods." }],
  },
  "san-francisco": {
    id: "sf-the-big-one",
    cityId: "san-francisco",
    name: "The Big One",
    narrative: [
      "The San Andreas Fault ruptures offshore at 4:30 in the morning.",
      "Filled land liquefies, roads buckle and fires break out.",
      "The earthquake is only the beginning.",
    ],
    durationHours: S.durationHours,
    briefing: {
      headline: "Emergency briefing: The Big One",
      script:
        "Emergency briefing. A magnitude seven point eight earthquake on the northern San Andreas Fault is the scenario that planners prepare for. " +
        "There is no warning. Shaking is violent on filled land in the Marina, South of Market and Mission Bay, where the ground liquefies. " +
        "Roads buckle, some buildings trap residents, and fires break out with low water pressure. " +
        "You have ten million dollars and three minutes to stage rescue teams, clear corridors and open shelters. " +
        "Find out what fails after the shaking stops.",
      hazard: "Ground shaking, liquefaction (USGS/ABAG scenario for the San Andreas), road damage, fire and aftershocks.",
      timeline: [
        { hour: 0, label: "M7.8 earthquake (04:30)" },
        { hour: S.hazard.quake!.damageHour, label: "Liquefaction and collapse" },
        { hour: S.hazard.quake!.fire.startHour, label: "Fires ignite" },
        { hour: S.hazard.quake!.aftershockWindow[0], label: "Aftershocks likely" },
        { hour: S.hazard.peakHour, label: "Fires at their largest" },
      ],
      uncertainty: [
        "Liquefaction comes from a scenario hazard map, not a prediction of this exact quake.",
        "Fire ignition points and the aftershock are seeded game events.",
        "Population is estimated from census tracts and spread along residential streets.",
      ],
    },
    hazards: ["Ground shaking", "Liquefaction", "Road and bridge damage", "Fire", "Aftershocks"],
    randomEvents: [
      { id: "fire", label: "Fires ignite", description: "Fires start in fuel-dense blocks after the shaking." },
      { id: "aftershock", label: "Aftershock", description: "A strong aftershock closes damaged roads on soft ground." },
    ],
  },
};
