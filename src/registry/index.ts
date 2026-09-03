// GENERATED FILE — do not edit by hand.
// Produced by tools/gen-registry.mjs from src/registry/*.json.
// Regenerate with `npm run gen:data`.
//
// The *.json files in this directory are the authored, reviewable source
// of truth for the rule registry (spec §2.7) — edit those, never this file.
// This mirror exists only so src/index.ts can import registry content as a
// plain .ts literal instead of a JSON module, which is what let
// `resolveJsonModule` come out of tsconfig.json entirely (spec §12.1).
// Rule *shape* — including each operator payload — is still validated at
// load time by dsl/validate.ts; this file does no validation of its own.

export const EXEMPT_RULES: readonly unknown[] = [
  {
    "id": "OPPS.EXEMPT.STATUTORY",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 1000,
    "order": 1100,
    "epoch": "E0",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4 C-APC exclusion list; spec §9.6",
    "scope": {
      "siIn": {
        "si": [
          "U",
          "G",
          "H",
          "F",
          "L"
        ]
      }
    },
    "then": [
      {
        "exempt": {}
      }
    ],
    "note": "Statutory C-APC exclusion set: brachytherapy (U), pass-through drugs (G), pass-through devices (H), vaccines (L), corneal tissue/CRNA/Hep B (F). 202 codes, all separately paid by statute."
  },
  {
    "id": "OPPS.EXEMPT.UNVERIFIED_POLICY",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 1000,
    "order": 1200,
    "epoch": "E0",
    "scopeTarget": "line",
    "citation": "spec §9.6 — no source on disk confirms C-APC status for S1/H1/K1",
    "scope": {
      "siIn": {
        "si": [
          "S1",
          "H1",
          "K1"
        ]
      }
    },
    "then": [
      {
        "exempt": {}
      },
      {
        "flag": {
          "code": "OPPS.EXEMPT.UNVERIFIED_POLICY",
          "severity": "assumption",
          "message": "S1/H1/K1 exemption from C-APC packaging is a structural inference (skin-substitute/device/drug APC ranges paid separately by statute), not confirmed by Addendum D1 or CMS-1834-FC — neither is on disk. 316 codes affected."
        }
      }
    ],
    "note": "Direction of the error is disclosed, not guessed away: exempting these wrongly means more lines pay separately, which raises the Medicare benchmark AB pays a multiple of — the safer default to carry while unverified (§9.6)."
  }
];

export const PACKAGING_RULES: readonly unknown[] = [
  {
    "id": "OPPS.PKG.J1.CONTROL",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 2000,
    "order": 2100,
    "epoch": "E1",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4 (comprehensive APC packaging)",
    "scope": {
      "always": {}
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "J1"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "isExempt",
                "args": {}
              }
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "isHighestBy",
                "args": {
                  "field": "rateMils",
                  "among": {
                    "op": "siIn",
                    "args": {
                      "si": [
                        "J1"
                      ]
                    }
                  },
                  "tiebreak": "codeAsc"
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "siIn",
            "args": {
              "si": [
                "J1"
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: scope is 'always' (not an SI selector) because this rule's real domain is every non-exempt line regardless of SI — §4.3 explicitly forbids enumerating 'every SI except the exempt ones' as a scope workaround, since §9.6's category-based exemptions are not SI-derivable. isExempt/isHighestBy (claim-relational) moved into 'when', joined with the pre-existing claimContainsAny(J1) gate; behaviourally identical (§4.3: 'costs nothing behaviourally' — when is read against the same frozen epoch scope was). If any J1 is present, the ranked J1 (payment desc, code asc tiebreak) controls and every non-exempt line — including other J1 lines on a multi-J1 claim — bundles into it. The isNotHighestBy clause excludes the ranked J1 itself so it never resolves as its own bundling target; a line not a J1 member of the ranking set is never vacuously excluded (§4.3: subjectInAmong false, not an error)."
  },
  {
    "id": "OPPS.PKG.J1.COMPLEXITY_NOT_APPLIED",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 2000,
    "order": 2900,
    "epoch": "E1",
    "scopeTarget": "claim",
    "citation": "spec §9.1 — J1 complexity adjustment combination table not sourced",
    "scope": {
      "claimAlways": {}
    },
    "when": {
      "claimLineCountAtLeast": {
        "si": [
          "J1"
        ],
        "count": 2
      }
    },
    "then": [
      {
        "flag": {
          "code": "OPPS.J1.COMPLEXITY_NOT_APPLIED",
          "severity": "gap",
          "message": "Two or more J1 lines are present. CMS's complexity-adjustment combination table (Ch.4) would move some multi-J1 combinations to a higher-paying APC in the same clinical family; that table is not on disk, so the claim pays the single ranked J1 rate and the amount may be understated."
        }
      }
    ],
    "note": "Claim-scoped: fires exactly once regardless of how many J1 lines are present, per §4.2's scopeTarget discipline — not once per line."
  },
  {
    "id": "OPPS.CAPC8011.CONTROL",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 3000,
    "order": 3100,
    "epoch": "E1",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4 (C-APC comprehensive packaging); spec §9.1",
    "scope": {
      "always": {}
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "J2"
              ]
            }
          },
          {
            "op": "claimUnitsAtLeast",
            "args": {
              "code": "G0378",
              "units": 8
            }
          },
          {
            "op": "claimContainsNone",
            "args": {
              "si": [
                "T"
              ]
            }
          },
          {
            "op": "claimContainsNone",
            "args": {
              "si": [
                "J1"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "isExempt",
                "args": {}
              }
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "isHighestBy",
                "args": {
                  "field": "rateMils",
                  "among": {
                    "op": "siIn",
                    "args": {
                      "si": [
                        "J2"
                      ]
                    }
                  },
                  "tiebreak": "codeAsc"
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "siIn",
            "args": {
              "si": [
                "J2"
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: scope is 'always' for the identical reason as OPPS.PKG.J1.CONTROL — isExempt/isHighestBy are claim-relational and this rule's real domain (every non-exempt line except the ranked J2) is not SI-derivable (§4.3). isExempt/isHighestBy moved into 'when', joined with the four pre-existing claim-level gates; behaviourally unchanged (same frozen epoch backs both scope and when — dsl/evaluate.ts). C-APC 8011 firing (spec §9.1: 'the same packaging power a controlling J1 has' — rev 4's regression was specifying only that the J2 line became unpriced, leaving every other line to pay its own APC, the opposite of comprehensive payment). Of the six §9.1 firing conditions, four are the claim-level gates above (J2 present; >=8 G0378 units via claimUnitsAtLeast, which sums across lines so 4+4 split over two lines still satisfies it, §19.7; no SI T; no SI J1). Condition 5 (date relation) and condition 6 (bill type 13X) are not checked in this 'when' — see OPPS.CAPC8011.CONTROLLING's note and flag, which document both and apply to the identical 'when' this rule shares. No J1/8011 overlap is possible: the 'no SI J1' condition here is exactly what keeps this rule and OPPS.PKG.J1.CONTROL mutually exclusive."
  },
  {
    "id": "OPPS.CAPC8011.CONTROLLING",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 3000,
    "order": 3110,
    "epoch": "E1",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4; spec §9.1, §9.4, §12.7",
    "scope": {
      "siIn": {
        "si": [
          "J2"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "J2"
              ]
            }
          },
          {
            "op": "claimUnitsAtLeast",
            "args": {
              "code": "G0378",
              "units": 8
            }
          },
          {
            "op": "claimContainsNone",
            "args": {
              "si": [
                "T"
              ]
            }
          },
          {
            "op": "claimContainsNone",
            "args": {
              "si": [
                "J1"
              ]
            }
          },
          {
            "op": "isHighestBy",
            "args": {
              "field": "rateMils",
              "among": {
                "op": "siIn",
                "args": {
                  "si": [
                    "J2"
                  ]
                }
              },
              "tiebreak": "codeAsc"
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_COMPREHENSIVE"
        }
      },
      {
        "flag": {
          "code": "OPPS.8011.RATE_UNAVAILABLE",
          "severity": "gap",
          "message": "C-APC 8011 fired and this J2 line controls the claim's comprehensive packaging (all non-exempt lines bundle into it, per OPPS.CAPC8011.CONTROL), but no source in this data set carries an APC 8011 rate — Addendum B has 934 distinct APCs, none in the 8000 range, and no OPPS Addendum A file is on disk (§9.1, §16). Packaging is still applied; pricing is not — packaging and pricing are separate concerns."
        }
      },
      {
        "flag": {
          "code": "OPPS.8011.DATE_RELATION_UNVERIFIED_POLICY",
          "severity": "assumption",
          "message": "Condition 5 of 8011's six firing conditions (the visit's line-item date of service is the same day as, or the day before, the observation service, with G0379 same day) is one reviewer's reading of Pub 100-04 Ch.4 and was never adversarially verified. It is also not mechanically enforced by this rule's 'when': the closed DSL operator set (spec §4.3) has no cross-line date-relational operator — dosOnOrAfter/dosBefore compare a line's own date of service to a fixed literal written into the rule, not to another line's date at evaluation time — so this condition cannot currently be expressed in the registry at all. This rule fires on the other five conditions (see this rule's note for condition 6, the bill-type check)."
        }
      }
    ],
    "note": "D45 migration: scope stays 'siIn: [J2]' — that half was already statically decidable from the code alone — and only the claim-relational 'isHighestBy' moved into 'when', joined with the four pre-existing claim-level gates; behaviourally unchanged (same frozen epoch backs both). The ranked (highest-rateMils, code-asc tiebreak) J2 line's own disposition when C-APC 8011 fires — mirrors OPPS.DISP.J1.CONTROLLING's role for J1. Placed at band 3000 (not band 5000, where OPPS.DISP.J2 lives) so the PAID_UNPRICED/OPPS_COMPREHENSIVE write happens before band 5000 runs; OPPS.DISP.J2's scope was updated (§4.3: setStatus is first-writer-wins-per-band, a cross-band overwrite is an error) to exclude any line already PAID_UNPRICED here, so the two rules do not collide. Condition 6 (bill type begins '13') is not re-checked in this rule's 'when': §8.0's claim-level applicability gate already rejects any claim whose typeOfBill does not begin '13' before phase 2 (ADJUDICATE) ever runs (see phases/classify.ts), so every claim reaching this rule already satisfies condition 6 structurally — re-testing it here would be dead code. That upstream gate's own textbook first-two-digits reading is itself unconfirmed against this feed (§19.25); this note carries that caveat forward since the rule itself cannot restate it in a 'when' it does not evaluate. Condition 5 is documented in the OPPS.8011.DATE_RELATION_UNVERIFIED_POLICY flag above, including why the DSL cannot check it mechanically as built — see the final report for why this is treated as a genuine spec/implementation gap rather than something this unit could resolve within its granted file scope (src/registry/*.json, src/flags.ts, src/dsl/evaluate.ts if strictly needed — adding a cross-line date operator would mean editing dsl/operators.ts, a spec change per §4.3, and out of scope here)."
  },
  {
    "id": "OPPS.PKG.Q1.COMPANION",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "a",
    "order": 4100,
    "epoch": "E2",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4.1 (STV-packaged codes)",
    "scope": {
      "siIn": {
        "si": [
          "Q1"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "S",
                "T",
                "V"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "siIn",
            "args": {
              "si": [
                "S",
                "T",
                "V"
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing claimContainsAny gate) — both read the same frozen epoch snapshot (dsl/evaluate.ts), so this is behaviourally identical, not a relaxation. Excludes lines already bundled by J1 control (band 2000) — J1 control takes priority, and a second bundleUnder write on the same line is a lint error (§4.3)."
  },
  {
    "id": "OPPS.PKG.Q2.COMPANION",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "a",
    "order": 4110,
    "epoch": "E2",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4.1 (T-packaged codes)",
    "scope": {
      "siIn": {
        "si": [
          "Q2"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "T"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "siIn",
            "args": {
              "si": [
                "T"
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing claimContainsAny gate) — same frozen epoch backs both, so this is behaviourally identical. Q2 packages against T only — it pays alongside S or V, unlike Q1. The narrower trigger list is deliberate (§9.2)."
  },
  {
    "id": "OPPS.PKG.Q4.COMPANION",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "b",
    "order": 4350,
    "epoch": "E3a",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4; IOCE conditional packaging",
    "scope": {
      "siIn": {
        "si": [
          "Q4"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "J1",
                "J2",
                "S",
                "T",
                "V",
                "Q1",
                "Q2",
                "Q3"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "allOf",
            "args": {
              "children": [
                {
                  "op": "siIn",
                  "args": {
                    "si": [
                      "J1",
                      "J2",
                      "S",
                      "T",
                      "V",
                      "Q1",
                      "Q2",
                      "Q3"
                    ]
                  }
                },
                {
                  "op": "not",
                  "args": {
                    "child": {
                      "op": "statusIn",
                      "args": {
                        "status": [
                          "BUNDLED"
                        ]
                      }
                    }
                  }
                }
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing claimContainsAny gate) — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q4]' this rule always meant. Q4's trigger list includes J2 even when C-APC 8011 did not fire; Q1's does not. On a bare G0463 claim a Q4 lab bundles while a Q1 line pays. This asymmetry is correct — see OPPS.PKG.Q1.COMPANION. 'among' excludes already-BUNDLED lines because Q1.COMPANION (order 4100, subBand a) and Q2.COMPANION (order 4110, subBand a) can bundle a Q1 or Q2 line, and this rule's 'among' pool includes both SIs. A predicate guard alone is not enough, though: 'among' is ranked against this rule's declared epoch's frozen snapshot (§2.5), not live per-line state, so a subBand-a rule reading epoch E2 (the snapshot taken *before* subBand a runs) would never see Q1.COMPANION's own same-window bundling reflected in that snapshot regardless of the guard — the same hazard OPPS.PKG.Q.SURVIVOR_TIEBREAK's note describes, and the reason that rule lives in subBand b at epoch E3a rather than subBand a at epoch E2. This rule was moved to subBand b / epoch E3a for the identical reason: only a rule reading the post-subBand-a snapshot can have a guard that actually excludes lines subBand a bundled. Scope (siIn Q4, not-BUNDLED) still reads this line's own live state regardless of epoch, so moving windows does not change which Q4 line acts — only what the 'among' ranking pool can see. OPPS.PKG.Q4.CONVERT stays in subBand a: its 'when' (claimContainsNone of this rule's trigger SI set) is the exact complement of this rule's 'when' over the same SI census, which subBand a's rules never mutate for J1/J2/S/T/V/Q1/Q2/Q3 (only convertSI on this line's own Q4->A, which is on the opposite branch of the same mutual exclusion) — so the two rules cannot both fire for the same line regardless of which window either runs in."
  },
  {
    "id": "OPPS.PKG.Q4.CONVERT",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "a",
    "order": 4210,
    "epoch": "E2",
    "scopeTarget": "line",
    "citation": "spec §9.3 — Q4 conversion is the CLFS entry point",
    "scope": {
      "siIn": {
        "si": [
          "Q4"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsNone",
            "args": {
              "si": [
                "J1",
                "J2",
                "S",
                "T",
                "V",
                "Q1",
                "Q2",
                "Q3"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "convertSI": {
          "to": "A"
        }
      },
      {
        "route": {}
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing claimContainsNone gate) — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q4]' this rule always meant. An unpackaged Q4 converts to SI A and routes to CLFS via the shared resolver (§2.3). The interpreter never imports routing.ts (§4.3) — the adjudicate phase wiring calls routing.resolve(code, 'A') after this rule fires and sets the final status/basis/rate there, not in the registry."
  },
  {
    "id": "OPPS.PKG.Q.SURVIVOR_TIEBREAK",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "b",
    "order": 4300,
    "epoch": "E3a",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4.1 (\"highest paid\" survivor rule)",
    "scope": {
      "siIn": {
        "si": [
          "Q1",
          "Q2"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "isNotHighestBy",
            "args": {
              "field": "rateMils",
              "among": {
                "op": "allOf",
                "args": {
                  "children": [
                    {
                      "op": "siIn",
                      "args": {
                        "si": [
                          "Q1",
                          "Q2"
                        ]
                      }
                    },
                    {
                      "op": "not",
                      "args": {
                        "child": {
                          "op": "statusIn",
                          "args": {
                            "status": [
                              "BUNDLED"
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              },
              "tiebreak": "codeAsc"
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "BUNDLED"
        }
      },
      {
        "bundleUnder": {
          "highestBy": "rateMils",
          "among": {
            "op": "allOf",
            "args": {
              "children": [
                {
                  "op": "siIn",
                  "args": {
                    "si": [
                      "Q1",
                      "Q2"
                    ]
                  }
                },
                {
                  "op": "not",
                  "args": {
                    "child": {
                      "op": "statusIn",
                      "args": {
                        "status": [
                          "BUNDLED"
                        ]
                      }
                    }
                  }
                }
              ]
            }
          },
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "D45 migration: the outer not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing isNotHighestBy condition) — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q1, Q2]' this rule always meant. The guard nested inside isNotHighestBy's own 'among' was already in a relational-condition position, not scope, and is unchanged. Reads epoch E3a — the results of sub-band a's companion-packaging rules — so 'among' only ranks Q1/Q2 lines that survived companion packaging, never a line already bundled there. Sub-band b is required precisely because a single band-4000 epoch would let this rule's bundleUnder name an already-bundled line (§2.5)."
  }
];

export const DISPOSITION_RULES: readonly unknown[] = [
  {
    "id": "OPPS.DISP.S",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5100,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10; spec §9.4",
    "scope": {
      "siIn": {
        "si": [
          "S"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [S]' this rule always meant. SI S pays 100% of its own APC, never discounted when multiple S lines are present. Guarded against a line already bundled by J1 control (§9.1: 'all non-exempt lines' bundle into a controlling J1)."
  },
  {
    "id": "OPPS.DISP.T",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5110,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.5 (MPPR)",
    "scope": {
      "siIn": {
        "si": [
          "T"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      },
      {
        "flag": {
          "code": "OPPS.T.MPPR_RANKING_UNVERIFIED",
          "severity": "assumption",
          "message": "MPPR ranks by relative weight (Ch.4 §10.5), not by payment (§10.4.1's Q-group survivor rule) — one reviewer's reading of the manual, not adversarially verified."
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [T]' this rule always meant. Every T line is set PAID/OPPS_APC here; this milestone computes no dollar amounts (no setAmount/multiply in the operator set — see dsl/operators.ts), so the MPPR 100%/50% split is not applied to a figure. The rank evidence needed to apply it later is captured by OPPS.DISP.T.MPPR_RANK."
  },
  {
    "id": "OPPS.DISP.T.MPPR_RANK",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5111,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.5 (MPPR)",
    "scope": {
      "siIn": {
        "si": [
          "T"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "ordinalAtLeast",
            "args": {
              "field": "weight",
              "among": {
                "op": "allOf",
                "args": {
                  "children": [
                    {
                      "op": "siIn",
                      "args": {
                        "si": [
                          "T"
                        ]
                      }
                    },
                    {
                      "op": "not",
                      "args": {
                        "child": {
                          "op": "statusIn",
                          "args": {
                            "status": [
                              "BUNDLED"
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              },
              "tiebreak": "codeAsc",
              "fallbackField": "rateMils",
              "atLeast": 2
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "flag": {
          "code": "OPPS.T.MPPR_NOT_PRICED",
          "severity": "gap",
          "message": "Ch.4 §10.5 reduces this line to 50% as the 2nd-or-later-ranked T line by relative weight (fallback: payment, for the 8 New Technology APC T codes with no weight) — but this milestone computes no dollar amounts, so the reduction is not applied to any figure."
        }
      }
    ],
    "note": "D45 migration: the outer not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing ordinalAtLeast condition) — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [T]' this rule always meant. The guard nested inside ordinalAtLeast's own 'among' was already in a relational-condition position, not scope, and is unchanged. Records the MPPR rank in the trace (Evaluation.examined.ordinal) via ordinalAtLeast even though no amount is computed this milestone (§4.3's ordinal-recording rationale)."
  },
  {
    "id": "OPPS.DISP.V",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5120,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4",
    "scope": {
      "siIn": {
        "si": [
          "V"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [V]' this rule always meant. SI V pays its own visit APC."
  },
  {
    "id": "OPPS.DISP.N",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5130,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4 — 2,076 codes, none carrying a rate",
    "scope": {
      "siIn": {
        "si": [
          "N"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PACKAGED"
        }
      },
      {
        "setBasis": {
          "value": "NONE"
        }
      },
      {
        "flag": {
          "code": "OPPS.N.PACKAGED",
          "severity": "info",
          "message": "SI N is always $0, no modifier override. Charges are still reported for rate-setting/outlier purposes (§9.4); not separately payable under any basis."
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [N]' this rule always meant. basis NONE, not OPPS_APC: N carries no Addendum B rate at all (consistent with packaging), so there is no rate-based basis to name. status PACKAGED, not PAID (SI N pays nothing separately — reporting PAID told a reader the line pays, the opposite of the truth) and not BUNDLED (N has no controlling line to name via bundledUnder; it is packaged by SI definition, not by a companion-packaging effect, so bundledUnder stays null)."
  },
  {
    "id": "OPPS.DISP.K",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5140,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4 — 526 codes, all carry an Addendum B rate",
    "scope": {
      "siIn": {
        "si": [
          "K"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_DRUG_ASP"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [K]' this rule always meant. SI K is priced — all 526 codes carry a rate."
  },
  {
    "id": "OPPS.DISP.G",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5150,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 117 codes, exempt, all carry a rate",
    "scope": {
      "siIn": {
        "si": [
          "G"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_DRUG_ASP"
        }
      }
    ],
    "note": "SI G is exempt (band 1000) and therefore never bundled by J1 control — no not-BUNDLED guard needed here (it would always evaluate true)."
  },
  {
    "id": "OPPS.DISP.U",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5160,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 17 codes, exempt, all carry a rate",
    "scope": {
      "siIn": {
        "si": [
          "U"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "SI U (brachytherapy) is exempt — see OPPS.DISP.G's note on why no not-BUNDLED guard is needed."
  },
  {
    "id": "OPPS.DISP.R",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5170,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4 — 41 codes, all carry a rate",
    "scope": {
      "siIn": {
        "si": [
          "R"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_BLOOD"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [R]' this rule always meant. SI R (blood/blood products) is priced but not exempt from J1 packaging."
  },
  {
    "id": "OPPS.DISP.P",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5180,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4 — 4 codes, none rated",
    "scope": {
      "siIn": {
        "si": [
          "P"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "PHP_PER_DIEM"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [P]' this rule always meant. SI P is unpriced by data design (partial hospitalization per diem), not exempt from J1 packaging."
  },
  {
    "id": "OPPS.DISP.H",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5190,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 19 codes, exempt, none rated (pass-through device)",
    "scope": {
      "siIn": {
        "si": [
          "H"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "COST"
        }
      }
    ],
    "note": "SI H (pass-through device) is exempt and unrated — a correct data state (paid at reasonable cost), not a gap. See OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.L",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5200,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 48 codes, exempt, none rated (vaccines)",
    "scope": {
      "siIn": {
        "si": [
          "L"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "COST"
        }
      }
    ],
    "note": "SI L (vaccines) is exempt and unrated — see OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.F",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5210,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 1 code, exempt, unrated (corneal tissue / CRNA / Hep B)",
    "scope": {
      "siIn": {
        "si": [
          "F"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "COST"
        }
      }
    ],
    "note": "SI F is exempt and unrated — see OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.S1",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5220,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 298 codes, UNVERIFIED_POLICY exempt, all rated",
    "scope": {
      "siIn": {
        "si": [
          "S1"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "SI S1 pays its own APC. Exempt per OPPS.EXEMPT.UNVERIFIED_POLICY — see OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.K1",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5230,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 5 codes, UNVERIFIED_POLICY exempt, all rated",
    "scope": {
      "siIn": {
        "si": [
          "K1"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_DRUG_ASP"
        }
      }
    ],
    "note": "SI K1 pays as a drug/biological. Exempt per OPPS.EXEMPT.UNVERIFIED_POLICY — see OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.H1",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5240,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.4, §9.6 — 13 codes, UNVERIFIED_POLICY exempt, none rated (pass-through device)",
    "scope": {
      "siIn": {
        "si": [
          "H1"
        ]
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "COST"
        }
      }
    ],
    "note": "SI H1 is a pass-through device, APC-assigned but no dollar amount. Exempt per OPPS.EXEMPT.UNVERIFIED_POLICY — see OPPS.DISP.G's note on the omitted guard."
  },
  {
    "id": "OPPS.DISP.J1.CONTROLLING",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5250,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.1 — J1 comprehensive control",
    "scope": {
      "siIn": {
        "si": [
          "J1"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [J1]' this rule always meant. Fires only on the ranked, unbundled J1 line — every other J1 line on a multi-J1 claim was bundled under it by OPPS.PKG.J1.CONTROL (band 2000). The 'comprehensive' character of a J1 APC is priced into the Addendum B rate itself, not a separate basis code — spec §9.1/§9.4 do not state J1's own basis explicitly; OPPS_APC is this build's judgment call (see final report)."
  },
  {
    "id": "OPPS.DISP.J2",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5260,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.1, §9.4 — J2 unfired",
    "scope": {
      "siIn": {
        "si": [
          "J2"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED",
              "PAID_UNPRICED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED/PAID_UNPRICED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [J2]' this rule always meant. U15: C-APC 8011 is now built (band 3000, OPPS.CAPC8011.CONTROL / OPPS.CAPC8011.CONTROLLING in opps.packaging.json). When 8011 fires, its controlling J2 is set PAID_UNPRICED/OPPS_COMPREHENSIVE at band 3000 — excluded here by the 'PAID_UNPRICED' guard, since a cross-band setStatus overwrite is a lint/runtime error (§4.3), not cosmetic. A non-controlling J2 on a fired-8011 claim is excluded by the pre-existing 'BUNDLED' guard, same as any other non-exempt line. When 8011 does not fire (any of its six conditions fails), this rule is the one that applies: J2 pays its own visit APC and has zero packaging power over other lines, matching §9.1."
  },
  {
    "id": "OPPS.DISP.Q1Q2.SURVIVOR",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5270,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.2",
    "scope": {
      "siIn": {
        "si": [
          "Q1",
          "Q2"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q1, Q2]' this rule always meant. Fires on a Q1/Q2 line that survived both companion packaging (band 4000a) and the same-SI survivor tiebreak (band 4000b) unbundled."
  },
  {
    "id": "OPPS.DISP.Q3",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5280,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "spec §9.2 — Q3 composite combination table not sourced",
    "scope": {
      "siIn": {
        "si": [
          "Q3"
        ]
      }
    },
    "when": {
      "not": {
        "child": {
          "op": "statusIn",
          "args": {
            "status": [
              "BUNDLED"
            ]
          }
        }
      }
    },
    "then": [
      {
        "setStatus": {
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      },
      {
        "flag": {
          "code": "OPPS.Q3.COMPOSITE_NOT_EVALUATED",
          "severity": "gap",
          "message": "Q3 is never companion-packaged, but Ch.4 §10.4.1's composite APC combination table is not on disk — this line pays its own APC without composite evaluation, a known gap, not a modeled rule."
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q3]' this rule always meant. Q3 can still be bundled under a controlling J1 (it is not in the exempt set) — guarded accordingly."
  },
  {
    "id": "OPPS.DISP.Q1Q2.COMPOSITE_FLAG",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 5000,
    "order": 5290,
    "epoch": "E3b",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4.1 — STV/T-packaged codes packaged into a composite companion",
    "scope": {
      "siIn": {
        "si": [
          "Q1",
          "Q2"
        ]
      }
    },
    "when": {
      "allOf": {
        "children": [
          {
            "op": "claimContainsAny",
            "args": {
              "si": [
                "Q3"
              ]
            }
          },
          {
            "op": "not",
            "args": {
              "child": {
                "op": "statusIn",
                "args": {
                  "status": [
                    "BUNDLED"
                  ]
                }
              }
            }
          }
        ]
      }
    },
    "then": [
      {
        "flag": {
          "code": "OPPS.Q3.COMPOSITE_NOT_EVALUATED",
          "severity": "gap",
          "message": "This Q1/Q2 line pays alongside a composite-APC-eligible (SI Q3) companion. Ch.4 §10.4.1 would package its payment into the composite, but composite evaluation is not performed (no combination table on disk) — reuses OPPS.Q3.COMPOSITE_NOT_EVALUATED's flag code since it is the same non-goal (§12.7: one flag code per non-goal)."
        }
      }
    ],
    "note": "D45 migration: the not-BUNDLED status guard moved from 'scope' into 'when' (joined with the pre-existing claimContainsAny gate) — same frozen epoch backs both, so this is behaviourally identical; scope is now the bare 'siIn: [Q1, Q2]' this rule always meant. SI Q3 is used as the operational proxy for 'composite-APC-eligible companion' — Q3 codes are themselves the composite-APC category, so this is the only claim-derivable signal available; see final report for why this is a judgment call, not a spec-stated rule."
  },
  {
    "id": "NCCI.PTP.PAIR",
    "version": "2026.2",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 6000,
    "order": 6100,
    "epoch": "E4",
    "scopeTarget": "line",
    "citation": "NCCI Policy Manual I-14 — Procedure-to-Procedure (PTP) edit tables and the Correct Coding Modifier Indicator (CCMI)",
    "scope": {
      "always": {}
    },
    "when": {
      "ncciPtpBundled": {}
    },
    "then": [
      {
        "flag": {
          "code": "NCCI.PTP.BUNDLED",
          "severity": "warning",
          "message": "This line's code is the Column 2 (bundled) member of an active NCCI PTP edit against another code on this claim, and the edit is not bypassed. CCMI 0 is never bypassable; CCMI 1 is bypassed only by the exact NCCI PTP-associated modifier set (I-14: anatomic E1-E4/FA/F1-F9/TA/T1-T9/LT/RT/LC/LD/RC/LM/RI; global surgery 24/25/57/58/78/79; other 27/59/91/XE/XS/XP/XU). Modifiers 22, 76, and 77 are explicitly NOT in that set and do NOT bypass this edit (I-14) — this is the exact near-miss a hand-written rule is warned to get wrong, and `ncciPtpBundled`'s underlying `lineBypassesPtpEdit` (src/data/ncciPolicy.ts) checks membership in the closed modifier set, never generic modifier presence, so a line carrying only 22/76/77 still fires this flag."
        }
      }
    ],
    "note": "U27/U28 — live against the loaded facility Outpatient Hospital PTP table (ccioph-v323r0-f1..f4, v32.3, active edits only — see src/data/ncciPtp.ncci2026oct.ts). DISCLOSURE ONLY, not enforcement: this rule never calls setStatus/bundleUnder to actually deny or bundle the line. That is a real, disclosed architecture limit, not an oversight — this rule sits at band 6000/epoch E4, downstream of every standard disposition rule (band 5000). §4.3's setStatus conflict-resolution rule is 'last-writer-wins by order, within a band only' and 'a cross-band overwrite is a lint error' (enforced by tools/lint-registry.mjs's CROSS_BAND_SETSTATUS check), so a band-6000 rule structurally cannot overwrite a status a band-5000 rule already wrote for the same line — see docs/ref/opps-architecture-edit-plan.md Tier C1, which names this exact problem and proposes moving reserved edit slots to a new band 1500 ahead of packaging/disposition; that re-banding is a re-epoching of phases 2-3 and a regeneration of every golden trace, out of scope for this unit. So 'goes live' here means: the interpreter genuinely evaluates a real PTP condition against real data (no longer 'unimplemented'/NOT_EVALUATED on every line regardless of whether a conflict exists), and discloses a real finding via `flag` when one exists — but it does not (and structurally cannot, without the re-banding above) change a line's paid/denied status. `dataRequired`/`unimplemented` are removed because they are only legal together (§4.3, dsl/evaluate.ts) and this rule's `when` is no longer `unimplemented`. `alwaysEvaluate` is also removed: it existed only to make the always-fire NOT_EVALUATED gap visible on every line even past a `stop`; a real conditional rule does not need it, and a line with no PTP conflict now correctly shows a normal NOT_MET trace entry instead of a gap flag, which is a strictly more honest disclosure than before (previously every line reported the edit family as uniformly unchecked, regardless of whether a conflict existed). Multiple simultaneous controlling-code matches: `computeNcciPtpFacts` (src/phases/classify.ts) takes the first bundled match by claim-line order — the manual and the spec are both silent on tie-break among several controlling codes, and this build does not invent one; the flag message is deliberately generic (does not name the specific controlling line) so this is not load-bearing. The `mod1`/`mod2` feed ceiling (D68/D89) still applies: PTP bypass reads `subject.modifiers`, whatever the feed actually populates there — if the feed caps at two modifiers, a line legitimately carrying a third bypass modifier will be wrongly reported as bundled, a real, disclosed limitation, not silently absorbed."
  },
  {
    "id": "MUE.LIMIT",
    "version": "2026.2",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 6000,
    "order": 6110,
    "epoch": "E4",
    "scopeTarget": "line",
    "citation": "NCCI Medically Unlikely Edits (MUE) table, NCCI Policy Manual I-28/I-29/I-31/I-34",
    "scope": {
      "always": {}
    },
    "when": {
      "unimplemented": {
        "reason": "the per-code MUE unit-limit table IS on disk and queryable (lookupNcciMue, src/data/index.ts, U30) as of 2026.2, but comparing a claim line's actual reported units against it correctly requires spec §19.2 (unit semantics), which remains open (D89) — see this rule's note"
      }
    },
    "then": [
      {
        "flag": {
          "code": "OPPS.NCCI_MUE.NOT_EVALUATED",
          "severity": "gap",
          "message": "Medically Unlikely Edit unit limits were not applied to this line. The MUE table itself is loaded (U30), but comparing this line's units against it correctly is not yet implemented — see this rule's note (§9.5, §19.2, D89). This effect is structurally unreachable: 'when' is 'unimplemented', which the interpreter short-circuits to outcome NOT_EVALUATED before any then[] effect runs (including this one); it exists only to satisfy the registry schema's non-empty-effects requirement (§4.2)."
        }
      }
    ],
    "dataRequired": true,
    "alwaysEvaluate": true,
    "note": "U29/U30 — DATA LAYER IS LIVE, RULE IS NOT. `lookupNcciMue()` (src/data/index.ts) is fully queryable against the real facility-outpatient MUE table (15,162 codes; MAI distribution 1:42/2:6148/3:8972; 1,392 codes carry MUE 0). What blocks this specific rule from following NCCI.PTP.PAIR live is NOT a missing file — it is that a correct MUE determination requires comparing a claim line's ACTUAL REPORTED UNITS (MAI 1: per line; MAI 2/3: summed across all lines for that code and date of service, per I-28/I-29) against `mueValue`, and this build has never settled how claim-line units are read/aggregated for this purpose (spec §19.2, still open per D89 — the same open question the milestone-1/2 boundary in docs/NCCI_INTEGRATION.md §5 names as MUE's actual gate, not PTP's). Shipping a comparison here without that settled would be exactly the kind of guessed unit semantics the build brief warned against — better to keep reporting NOT_EVALUATED honestly than to fabricate a plausible-looking MUE denial. The one MUE fact this build DOES assert without needing §19.2 at all is §4.4's 'MUE 0 means not payable, not no-limit' (see `mueZeroMeansNotPayable` in src/data/ncciPolicy.ts and its accessor-level test) — that is a property of the value alone, not a units comparison, so it needed no rule to be true and correct today; it just is not wired into a `then` effect here because doing so ONLY for the MUE-0 case while leaving every other MAI un-evaluated would selectively deny some lines and not others under the same nominally-reserved slot, which is a worse disclosure than reporting the whole slot NOT_EVALUATED uniformly. See NCCI.PTP.PAIR's note for the dataRequired boolean-vs-string decision, which applies identically here."
  },
  {
    "id": "OPPS.CLASSIFY.DELETED",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 6000,
    "order": 6120,
    "epoch": "E4",
    "scopeTarget": "line",
    "citation": "spec §8.1 — DELETED is suspended; no source on disk supplies a termination date for any code in the loaded data",
    "scope": {
      "always": {}
    },
    "when": {
      "unimplemented": {
        "reason": "requires HCPCS code-termination dates for the loaded codes; the on-disk HCPCS file's TERM_DT covers only 6,610 of Addendum B's 18,986 codes and none of those 6,610 carry a populated value (§8.1)"
      }
    },
    "then": [
      {
        "flag": {
          "code": "OPPS.DELETED.NOT_EVALUATED",
          "severity": "gap",
          "message": "Whether this code has since been terminated was not checked — no code in the loaded data carries a termination date (§8.1). This effect is structurally unreachable — see NCCI.PTP.PAIR's then[] note for why."
        }
      }
    ],
    "dataRequired": true,
    "alwaysEvaluate": true,
    "note": "Distinct from INVALID_HISTORICAL (U5, driven by the already-loaded historical-validity index that DOES drive a real determination): DELETED asks whether a code CURRENTLY present in Addendum B has since been terminated; INVALID_HISTORICAL asks whether a code ABSENT from current data was still active on the claim's date of service. Different question, different (unloaded) file — do not conflate the two when reading a trace (§8.1 is explicit about this). Reserved per §9.5's mechanism even though DELETED is an §8.1 (phase 1 / CLASSIFY) verdict in the spec's own prose: this unit's brief places all three reserved slots — including this one — in phase ADJUDICATE band 6000, matching §9.5's 'the same mechanism covers a rule that is specified but not yet built' and keeping every reserved slot in one place a reader can check in a single pass."
  }
];
