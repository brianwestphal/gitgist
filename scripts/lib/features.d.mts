export type RequirementKind = 'FR' | 'NFR' | 'T';

export interface Requirement {
  id: string;
  kind: RequirementKind;
  status: string;
  title: string;
}

export interface CoverageResult {
  required: Requirement[];
  uncovered: string[];
  stale: string[];
}

export declare const REQUIRED_STATUSES: Set<string>;

export declare function parseRequirements(text: string): Requirement[];

export declare function collectCovers(
  files: { name: string; text: string }[],
): Map<string, string[]>;

export declare function computeCoverage(
  requirements: Requirement[],
  coversById: Map<string, string[]>,
): CoverageResult;
