/**
 * CMS's list of Advanced Diagnostic Laboratory Tests (ADLTs) — the one public,
 * licence-clean list that maps a lab test's BRAND name to its billing code
 * (fleet #2426: "Signatera" -> 0340U).
 *
 * Source: https://www.cms.gov/files/document/advanced-diagnostic-laboratory-tests-under-medicare-clfs.pdf
 * (linked from cms.gov "ADLT Information"; embedded source name
 * "2025.3.10_List of Approved ADLTs.xlsx"; HTTP Last-Modified
 * Tue, 11 Mar 2025 15:10:55 GMT, 118,376 bytes — checked 2026-09-25).
 *
 * WHY IT IS BAKED, NOT FETCHED. The list is a two-page PDF that changes a few
 * times a year and has no API; the gateway carries no PDF parser. It is a US
 * federal work (17 USC 105), so a copy is fine (CLAUDE.md, "build the copy").
 * The refresh path is the live Last-Modified check in the tool itself
 * (SNAPSHOT_LAST_MODIFIED below): when CMS republishes, every response says
 * so, and the README section "ADLT list" says how to re-extract.
 *
 * WHAT IS NOT HERE. The PDF's "Test Descriptor" column is the AMA's CPT PLA
 * descriptor text ("CPT Copyright ... American Medical Association. All rights
 * reserved") — the same text this pack already refuses to store. Only the CMS
 * facts are kept: code, lab, proprietary test name, approval date, the new-ADLT
 * initial period and its payment.
 *
 * `coverage_topic` is OURS, not CMS's: a phrase that matches the title of the
 * MolDX LCD / billing article for the test's category (each checked against the
 * live LCD title list on 2026-09-25). It finds the policy family; whether this
 * specific test is listed in the article's code table is a separate question
 * the article answers. null where no local policy title fits.
 */

export interface AdltTest {
  code: string;
  code_note: string | null;
  lab: string;
  test_name: string;
  aliases: string[];
  adlt_approval_date: string;
  new_adlt_initial_period: string | null;
  initial_period_payment_usd: number | null;
  existing_adlt: boolean;
  coverage_topic: string | null;
}

export const ADLT_SOURCE_URL = 'https://www.cms.gov/files/document/advanced-diagnostic-laboratory-tests-under-medicare-clfs.pdf';
export const ADLT_DATA_AS_OF = '2025-03-10';
export const SNAPSHOT_LAST_MODIFIED = 'Tue, 11 Mar 2025 15:10:55 GMT';

export const ADLT_TESTS: AdltTest[] = [
  { code: '0537U', code_note: null, lab: 'Guardant Health, Inc.', test_name: 'Shield', aliases: ['Guardant Shield'], adlt_approval_date: '2025-03-10', new_adlt_initial_period: '2025-04-01 to 2025-12-31', initial_period_payment_usd: 1495, existing_adlt: false, coverage_topic: null },
  { code: '0473U', code_note: null, lab: 'Tempus AI, Inc.', test_name: 'xT CDx', aliases: ['Tempus xT', 'Tempus xT CDx'], adlt_approval_date: '2024-06-26', new_adlt_initial_period: '2024-07-01 to 2025-03-31', initial_period_payment_usd: 4500, existing_adlt: false, coverage_topic: 'Next-Generation Sequencing for Solid Tumors' },
  { code: '0356U', code_note: null, lab: 'Naveris, Inc.', test_name: 'NavDx', aliases: [], adlt_approval_date: '2024-03-18', new_adlt_initial_period: '2024-04-01 to 2024-12-31', initial_period_payment_usd: 1800, existing_adlt: false, coverage_topic: 'Minimal Residual Disease' },
  { code: '0315U', code_note: null, lab: 'Castle Biosciences, Inc.', test_name: 'DecisionDx-SCC', aliases: ['DecisionDx SCC'], adlt_approval_date: '2023-06-30', new_adlt_initial_period: '2023-07-01 to 2024-03-31', initial_period_payment_usd: 8500, existing_adlt: false, coverage_topic: 'Risk Stratification of Cutaneous Squamous Cell Carcinoma' },
  { code: '0360U', code_note: null, lab: 'Biodesix, Inc.', test_name: 'Nodify CDT', aliases: [], adlt_approval_date: '2023-06-30', new_adlt_initial_period: null, initial_period_payment_usd: null, existing_adlt: true, coverage_topic: null },
  { code: '0295U', code_note: null, lab: 'Prelude Corporation', test_name: 'DCISionRT', aliases: [], adlt_approval_date: '2023-03-23', new_adlt_initial_period: '2023-04-01 to 2023-12-31', initial_period_payment_usd: 5435, existing_adlt: false, coverage_topic: null },
  { code: '0108U', code_note: null, lab: 'Castle Biosciences, Inc. / Cernostics, Inc.', test_name: "TissueCypher Barrett's Esophagus Assay", aliases: ['TissueCypher'], adlt_approval_date: '2022-03-24', new_adlt_initial_period: '2022-04-01 to 2022-12-31', initial_period_payment_usd: 2350, existing_adlt: false, coverage_topic: 'Upper Gastrointestinal Metaplasia, Dysplasia, and Neoplasia' },
  { code: '0340U', code_note: null, lab: 'Natera, Inc.', test_name: 'Signatera', aliases: [], adlt_approval_date: '2021-06-17', new_adlt_initial_period: '2021-07-01 to 2022-03-31', initial_period_payment_usd: 3500, existing_adlt: false, coverage_topic: 'Minimal Residual Disease' },
  { code: '0242U', code_note: null, lab: 'Guardant Health, Inc.', test_name: 'Guardant360 CDx', aliases: ['Guardant360', 'Guardant 360'], adlt_approval_date: '2021-03-18', new_adlt_initial_period: '2021-04-01 to 2021-12-31', initial_period_payment_usd: 5000, existing_adlt: false, coverage_topic: 'Plasma-Based Genomic Profiling in Solid Tumors' },
  { code: '0239U', code_note: null, lab: 'Foundation Medicine, Inc.', test_name: 'FoundationOne Liquid CDx', aliases: ['F1 Liquid CDx', 'FoundationOne Liquid'], adlt_approval_date: '2021-01-25', new_adlt_initial_period: '2021-04-01 to 2021-12-31', initial_period_payment_usd: 3500, existing_adlt: false, coverage_topic: 'Plasma-Based Genomic Profiling in Solid Tumors' },
  { code: '81554', code_note: 'Effective 2021-01-01', lab: 'Veracyte', test_name: 'Envisia Genomic Classifier', aliases: ['Envisia'], adlt_approval_date: '2020-09-17', new_adlt_initial_period: '2020-10-01 to 2021-06-30', initial_period_payment_usd: 5500, existing_adlt: false, coverage_topic: 'Idiopathic Pulmonary Fibrosis' },
  { code: '0172U', code_note: 'Effective 2020-07-01', lab: 'Myriad', test_name: 'myChoice CDx', aliases: ['Myriad myChoice'], adlt_approval_date: '2019-12-11', new_adlt_initial_period: '2020-01-01 to 2020-09-30', initial_period_payment_usd: 4040, existing_adlt: false, coverage_topic: 'Next-Generation Sequencing for Solid Tumors' },
  { code: '0090U', code_note: null, lab: 'Myriad', test_name: 'myPath Melanoma', aliases: ['Myriad myPath'], adlt_approval_date: '2019-09-06', new_adlt_initial_period: '2019-10-01 to 2020-06-30', initial_period_payment_usd: 1950, existing_adlt: false, coverage_topic: 'Molecular Assays for the Diagnosis of Cutaneous Melanoma' },
  { code: '0080U', code_note: null, lab: 'Biodesix, Inc.', test_name: 'BDX-XL2', aliases: ['BDX XL2'], adlt_approval_date: '2019-05-17', new_adlt_initial_period: '2019-07-01 to 2020-03-31', initial_period_payment_usd: 3520, existing_adlt: false, coverage_topic: null },
  { code: '81529', code_note: 'Effective 2021-01-01', lab: 'Castle Biosciences, Inc.', test_name: 'DecisionDx-Melanoma', aliases: ['DecisionDx Melanoma'], adlt_approval_date: '2019-05-17', new_adlt_initial_period: '2019-07-01 to 2020-03-31', initial_period_payment_usd: 7193, existing_adlt: false, coverage_topic: 'Melanoma Risk Stratification' },
  { code: '81552', code_note: 'Effective 2020-01-01; CMS lists an earlier code for this test ("Previously ...")', lab: 'Castle Biosciences, Inc.', test_name: 'DecisionDx-UM', aliases: ['DecisionDx UM', 'Decision Dx-UM'], adlt_approval_date: '2019-05-17', new_adlt_initial_period: null, initial_period_payment_usd: null, existing_adlt: true, coverage_topic: 'Uveal Melanoma' },
  { code: '81538', code_note: null, lab: 'Biodesix, Inc.', test_name: 'VeriStrat', aliases: [], adlt_approval_date: '2018-12-21', new_adlt_initial_period: null, initial_period_payment_usd: null, existing_adlt: true, coverage_topic: null },
  { code: '0037U', code_note: null, lab: 'Foundation Medicine, Inc.', test_name: 'FoundationOne CDx', aliases: ['F1CDx', 'F1 CDx'], adlt_approval_date: '2018-05-18', new_adlt_initial_period: '2018-07-01 to 2019-03-31', initial_period_payment_usd: 3500, existing_adlt: false, coverage_topic: 'Next-Generation Sequencing for Solid Tumors' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Match a caller's free text to ADLT rows: by code, then by test name/alias
 * (either contains the other, so "Signatera MRD test" still resolves), then by
 * lab. A test-name hit wins over a lab hit — "Guardant360" must not return
 * Shield just because both are Guardant's.
 */
export function matchAdlt(query: string): { matched_by: 'code' | 'test_name' | 'lab' | null; tests: AdltTest[] } {
  const q = norm(query);
  if (q.length < 3) return { matched_by: null, tests: [] };
  const byCode = ADLT_TESTS.filter((t) => norm(t.code) === q);
  if (byCode.length) return { matched_by: 'code', tests: byCode };
  const names = (t: AdltTest) => [t.test_name, ...t.aliases].map(norm);
  const exact = ADLT_TESTS.filter((t) => names(t).includes(q));
  if (exact.length) return { matched_by: 'test_name', tests: exact };
  const byName = ADLT_TESTS.filter((t) => names(t).some((n) => n.length >= 4 && (n.includes(q) || q.includes(n))));
  if (byName.length) {
    // "Guardant360 CDx" contains "guardant360", and so does nothing else; but a
    // query that CONTAINS two names ("FoundationOne CDx") keeps only the longest.
    const longest = Math.max(...byName.map((t) => Math.max(...names(t).filter((n) => q.includes(n)).map((n) => n.length), 0)));
    const narrowed = longest > 0 ? byName.filter((t) => names(t).some((n) => n.length === longest && q.includes(n))) : byName;
    return { matched_by: 'test_name', tests: narrowed };
  }
  const byLab = ADLT_TESTS.filter((t) => q.length >= 4 && norm(t.lab).includes(q));
  if (byLab.length) return { matched_by: 'lab', tests: byLab };
  return { matched_by: null, tests: [] };
}
