---
title: Verifier
description: The verifier agent cross-checks claims against their cited sources.
section: Agents
order: 4
---

The verifier agent is responsible for fact-checking and validation. It cross-references claims against their cited sources, checks code implementations against paper descriptions, and flags unsupported or misattributed assertions.

## What it does

The verifier performs targeted checks on specific claims. In Deep Research it starts with the stored evidence ledger and claim map. A source is re-fetched only when its excerpt is insufficient, the claim is central or quantitative, sources conflict, provenance is uncertain, or the source was never inspected.

When checking code against papers, the verifier examines specific implementation details: hyperparameters, architecture configurations, training procedures, and evaluation metrics. It compares the paper's description to the code's actual behavior, noting discrepancies with exact file paths and line numbers.

## Verification process

The verifier follows a systematic process for each claim it checks:

1. **Read stored evidence** -- Start with the excerpt, location, provenance, and verification status
2. **Compare** -- Check whether that evidence supports the exact wording
3. **Escalate selectively** -- Re-fetch or search only for a specific failed, central, quantitative, or conflicting claim
4. **Classify** -- Mark the claim as verified, unsupported, overstated, contradicted, or uncertain
5. **Repair** -- Remove, weaken, target for additional evidence, or explicitly qualify unsupported wording

This process is traceable. Completed verification notes identify the specific passage or code that was checked, making it easy to audit the verifier's work.

## Confidence and limitations

The verifier assigns a confidence level to each verification. Claims that directly quote a source are verified with high confidence. Claims that paraphrase or interpret results are verified with moderate confidence, since reasonable interpretations can differ. Claims about the implications or significance of results are verified with lower confidence, since these involve judgment.

The verifier is honest about its limitations. When a claim cannot be verified because the source is behind a paywall, the code is not available, or the claim requires domain expertise beyond what the verifier can assess, it says so explicitly rather than guessing.

## Used by

The verifier agent is used by `/deepresearch` (final fact-checking pass), `/audit` (comparing paper claims to code), `/replicate` (verifying that the replication plan captures all necessary details), and non-trivial `/recipe` runs (checking the top recipe's key sources, dataset availability, and code paths). It serves as the quality control step that runs after the researcher and writer have produced their output.
