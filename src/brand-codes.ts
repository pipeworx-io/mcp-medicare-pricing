/**
 * Branded lab tests that are NOT ADLTs but carry their own code (fleet #2458).
 *
 * #2426 resolved brand names only through the CMS ADLT list, so the most-asked
 * branded test of all -- Oncotype DX, a Category I MAAA code (81519) -- came
 * back found:false. Two more sources close the class:
 *
 *  1. THIS TABLE: the Category I MAAA tests whose proprietary name is tied to
 *     its code in CPT Appendix O, each also the subject of a brand-named MolDX
 *     billing-and-coding article on the CMS Medicare Coverage Database. What is
 *     kept is the FACT (brand -> code -> lab), never the AMA descriptor text,
 *     under the same rule as adlt.ts. Every code here was checked on
 *     2026-09-26 to carry a rate on the loaded CLFS.
 *  2. NCBI GTR (Genetic Testing Registry), fetched LIVE per request: labs
 *     register their tests there and many state the CPT code. US government
 *     work, keyless E-utilities. It is lab-reported, so the answer says so.
 *
 * `coverage_topic` is a phrase from the title of the test's MolDX policy (a
 * brand-named billing article where one exists), matched live against the CMS
 * Coverage API title list -- ours, not CMS's, checked 2026-09-26.
 */

export interface BrandTest {
  code: string;
  lab: string;
  test_name: string;
  aliases: string[];
  coverage_topic: string | null;
}

export const BRAND_SOURCE = 'CPT Appendix O (MAAA) proprietary-name-to-code pairs, each with a brand-named or category MolDX billing article on the CMS Medicare Coverage Database';
export const BRAND_DATA_AS_OF = '2026-09-26';

export const BRAND_TESTS: BrandTest[] = [
  { code: '81519', lab: 'Genomic Health (Exact Sciences)', test_name: 'Oncotype DX Breast Recurrence Score', aliases: ['Oncotype DX', 'Oncotype DX Breast', 'Oncotype DX Breast Cancer Assay', 'Oncotype'], coverage_topic: 'Oncotype DX Breast Cancer Assay' },
  { code: '0045U', lab: 'Genomic Health (Exact Sciences)', test_name: 'Oncotype DX Breast DCIS Score', aliases: ['Oncotype DX DCIS', 'Oncotype DCIS'], coverage_topic: 'Oncotype DX Breast Cancer for DCIS' },
  { code: '81525', lab: 'Genomic Health (Exact Sciences)', test_name: 'Oncotype DX Colon Recurrence Score', aliases: ['Oncotype DX Colon', 'Oncotype DX Colon Cancer Assay'], coverage_topic: 'Oncotype DX Colon Cancer' },
  { code: '0047U', lab: 'Genomic Health (Exact Sciences)', test_name: 'Oncotype DX Genomic Prostate Score', aliases: ['Oncotype DX Prostate', 'Genomic Prostate Score', 'Oncotype GPS'], coverage_topic: 'Prostate Cancer Genomic Classifier Assay' },
  { code: '81518', lab: 'Biotheranostics (Hologic)', test_name: 'Breast Cancer Index', aliases: ['BCI'], coverage_topic: 'Breast Cancer Index' },
  { code: '81520', lab: 'NanoString Technologies (Veracyte)', test_name: 'Prosigna', aliases: ['Prosigna Breast Cancer Prognostic Gene Signature Assay', 'PAM50'], coverage_topic: 'Prosigna' },
  { code: '81521', lab: 'Agendia', test_name: 'MammaPrint', aliases: [], coverage_topic: 'MammaPrint' },
  { code: '81522', lab: 'Myriad Genetics', test_name: 'EndoPredict', aliases: [], coverage_topic: 'EndoPredict' },
  { code: '81528', lab: 'Exact Sciences', test_name: 'Cologuard', aliases: [], coverage_topic: null },
  { code: '81541', lab: 'Myriad Genetics', test_name: 'Prolaris', aliases: [], coverage_topic: 'Prostate Cancer Genomic Classifier Assay' },
  { code: '81542', lab: 'Veracyte (Decipher Biosciences)', test_name: 'Decipher Prostate', aliases: ['Decipher', 'Decipher Prostate Genomic Classifier'], coverage_topic: 'Prostate Cancer Genomic Classifier Assay' },
  { code: '81546', lab: 'Veracyte', test_name: 'Afirma Genomic Sequencing Classifier', aliases: ['Afirma', 'Afirma GSC'], coverage_topic: 'Molecular Testing for Risk Stratification of Thyroid Nodules' },
  { code: '81551', lab: 'MDxHealth', test_name: 'ConfirmMDx', aliases: ['ConfirmMDx for Prostate Cancer'], coverage_topic: 'Molecular Biomarkers to Risk-Stratify Patients at Increased Risk for Prostate Cancer' },
  { code: '81539', lab: 'OPKO Health (BioReference)', test_name: '4Kscore', aliases: ['4K score', '4Kscore Test'], coverage_topic: 'Molecular Biomarkers to Risk-Stratify Patients at Increased Risk for Prostate Cancer' },
];

export const norm = (s: string) => s.toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9]/g, '');

type Named = { code: string; test_name: string; aliases: string[]; lab: string };

/**
 * Match free text to rows: by code, then exact name/alias, then containment
 * (either way, longest name wins so "Oncotype DX colon" is colon, not breast),
 * then lab. A name hit beats a lab hit.
 */
export function matchTests<T extends Named>(rows: T[], query: string): { matched_by: 'code' | 'test_name' | 'lab' | null; tests: T[] } {
  const q = norm(query);
  if (q.length < 3) return { matched_by: null, tests: [] };
  const byCode = rows.filter((t) => norm(t.code) === q);
  if (byCode.length) return { matched_by: 'code', tests: byCode };
  const names = (t: T) => [t.test_name, ...t.aliases].map(norm);
  const exact = rows.filter((t) => names(t).includes(q));
  if (exact.length) return { matched_by: 'test_name', tests: exact };
  const byName = rows.filter((t) => names(t).some((n) => n.length >= 4 && (n.includes(q) || q.includes(n))));
  if (byName.length) {
    const longest = Math.max(...byName.map((t) => Math.max(...names(t).filter((n) => q.includes(n)).map((n) => n.length), 0)));
    const narrowed = longest > 0 ? byName.filter((t) => names(t).some((n) => n.length === longest && q.includes(n))) : byName;
    return { matched_by: 'test_name', tests: narrowed };
  }
  const byLab = rows.filter((t) => q.length >= 4 && norm(t.lab).includes(q));
  if (byLab.length) return { matched_by: 'lab', tests: byLab };
  return { matched_by: null, tests: [] };
}

export interface GtrHit { code: string; test_name: string; lab: string; gtr_accession: string; url: string }

/**
 * NCBI GTR, live: tests whose registered name matches the query AND whose lab
 * stated a CPT code. null when NCBI did not answer (distinct from "no hit").
 */
export async function gtrLookup(query: string, fetcher: typeof fetch): Promise<GtrHit[] | null> {
  const q = norm(query);
  if (q.length < 4) return [];
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const tool = '&tool=pipeworx&email=support%40pipeworx.io';
  try {
    const s = await fetcher(`${base}/esearch.fcgi?db=gtr&retmode=json&retmax=40&term=${encodeURIComponent(query)}${tool}`);
    if (!s.ok) return null;
    const ids = ((await s.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const r = await fetcher(`${base}/esummary.fcgi?db=gtr&retmode=json&id=${ids.join(',')}${tool}`);
    if (!r.ok) return null;
    const res = ((await r.json()) as { result?: Record<string, any> }).result ?? {};
    const hits: GtrHit[] = [];
    for (const id of ids) {
      const x = res[id];
      if (!x || typeof x.testname !== 'string') continue;
      const n = norm(x.testname);
      if (!(n.includes(q) || (n.length >= 4 && q.includes(n)))) continue;
      const codes = String(x.cptcode ?? '').split(/[^0-9A-Za-z]+/).map((c: string) => c.toUpperCase()).filter((c: string) => /^(\d{5}|\d{4}U)$/.test(c));
      for (const code of codes) {
        hits.push({ code, test_name: x.testname, lab: String(x.offerer ?? ''), gtr_accession: String(x.accession ?? ''), url: `https://www.ncbi.nlm.nih.gov/gtr/tests/${id}/` });
      }
    }
    return hits;
  } catch {
    return null;
  }
}
