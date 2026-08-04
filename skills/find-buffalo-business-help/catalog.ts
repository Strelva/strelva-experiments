export type OpportunityKind = "funding" | "permit" | "procurement" | "support";

export interface Opportunity {
  id: string;
  name: string;
  organization: string;
  kind: OpportunityKind;
  summary: string;
  nextStep: string;
  sourceUrl: string;
  signals: readonly string[];
}

export interface OpportunityMatch extends Omit<Opportunity, "signals"> {
  reason: string;
}

export const OPPORTUNITIES: readonly Opportunity[] = [
  { id: "buffalo-grant", name: "City of Buffalo Business Assistance Grant", organization: "City of Buffalo", kind: "funding", summary: "A 2026 listing for operating costs, inventory, marketing, professional services, and movable equipment.", nextStep: "Verify the current application window and eligibility before preparing materials.", sourceUrl: "https://www3.erie.gov/businesshub/press/city-buffalo-business-assistance-grant", signals: ["buffalo", "city", "grant", "rent", "payroll", "utilities", "inventory", "marketing", "equipment", "storefront", "operating"] },
  { id: "buffalo-permits", name: "Buffalo permits and licenses", organization: "City of Buffalo", kind: "permit", summary: "Construction, repair, sign, interior buildout, outdoor cafe, and other city permits.", nextStep: "Confirm the permit type before starting work.", sourceUrl: "https://epermits.buffalony.gov/submit-record", signals: ["open", "restaurant", "cafe", "patio", "sign", "storefront", "construction", "renovate", "repair", "building", "permit", "license", "property"] },
  { id: "erie-funding", name: "Erie County funding directory", organization: "Erie County Business Hub", kind: "funding", summary: "A county directory of grants, microloans, credit, and partner financing programs.", nextStep: "Review the directory and confirm current availability with the program owner.", sourceUrl: "https://www3.erie.gov/businesshub/funding-opportunities", signals: ["fund", "grant", "loan", "money", "capital", "equipment", "inventory", "grow", "expand", "startup", "small business"] },
  { id: "erie-microenterprise", name: "Erie County Microenterprise Loan and Grant", organization: "Erie County", kind: "funding", summary: "A loan and grant path for qualifying microenterprises with five or fewer employees in participating communities.", nextStep: "Check the current geography and household-income requirements with Erie County.", sourceUrl: "https://www3.erie.gov/economicdevelopment/businesshub/sites/www3.erie.gov.economicdevelopment/files/2025-07/microenterprise-loan-grant-flyer-rev-may-2025.pdf", signals: ["microenterprise", "small business", "five employees", "home business", "equipment", "inventory", "working capital", "loan", "grant", "start"] },
  { id: "erie-procurement", name: "Sell to Erie County", organization: "Erie County", kind: "procurement", summary: "Vendor registration, bid notifications, purchasing contracts, RFPs, and construction bids.", nextStep: "Join the county vendor list and review current bid postings.", sourceUrl: "https://www4.erie.gov/doing-business", signals: ["contract", "contractor", "bid", "rfp", "government", "county", "vendor", "procurement", "sell", "construction", "public work"] },
  { id: "nys-contracts", name: "New York State Contract Reporter", organization: "New York State", kind: "procurement", summary: "Search advertised State procurement opportunities and create alerts.", nextStep: "Create a free account and confirm each listing’s due date.", sourceUrl: "https://www.nyscr.ny.gov/home/contracts", signals: ["contract", "contractor", "bid", "government", "state", "vendor", "procurement", "rfp", "public work", "sell"] },
  { id: "nys-small-business", name: "New York small-business program finder", organization: "Empire State Development", kind: "support", summary: "State programs for financing, training, business growth, innovation, and technical assistance.", nextStep: "Use the State filters to build a program list for your goal.", sourceUrl: "https://esd.ny.gov/doing-business-ny/small-business-hub", signals: ["business", "help", "support", "start", "startup", "grow", "expand", "training", "funding", "loan", "grant", "technology", "manufacturing"] },
  { id: "ssbci", name: "Free legal, accounting, and financial assistance", organization: "Empire State Development", kind: "support", summary: "No-cost professional guidance for eligible New York businesses seeking capital.", nextStep: "Review eligibility and contact a participating provider.", sourceUrl: "https://www.esd.ny.gov/ssbci-technical-assistance-program", signals: ["legal", "accounting", "finance", "capital", "loan", "contract", "license", "certification", "startup", "formation", "bookkeeping"] },
  { id: "seed", name: "Pre-seed and Seed Matching Fund", organization: "New York Ventures", kind: "funding", summary: "Equity investment for qualifying high-growth New York startups with matching private investment.", nextStep: "Check the investment criteria and matching requirement.", sourceUrl: "https://esd.ny.gov/pre-seed-and-seed-matching-fund-program", signals: ["startup", "technology", "tech", "software", "venture", "seed", "investor", "investment", "raise", "high growth", "innovation"] }
] as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function findOpportunities(query: string): OpportunityMatch[] {
  const input = normalize(query);
  const scored = OPPORTUNITIES.map((opportunity) => {
    const hits = opportunity.signals.filter((signal) => input.includes(signal));
    return { opportunity, hits, score: hits.reduce((sum, hit) => sum + (hit.includes(" ") ? 3 : 1), 0) };
  }).sort((a, b) => b.score - a.score || a.opportunity.name.localeCompare(b.opportunity.name));
  const relevant = scored.filter(({ score }) => score > 0);
  const fallback = scored.filter(({ opportunity }) => opportunity.id === "erie-funding" || opportunity.id === "nys-small-business");
  return [...relevant, ...fallback.filter((item) => !relevant.some(({ opportunity }) => opportunity.id === item.opportunity.id))].slice(0, 5).map(({ opportunity, hits }) => {
    const { signals, ...result } = opportunity;
    void signals;
    return { ...result, reason: hits.length ? `Matched ${hits.slice(0, 3).join(", ")} in your description.` : "A broad official starting point for the goal you described." };
  });
}
