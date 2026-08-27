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
      "allOf": {
        "children": [
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
    "when": {
      "claimContainsAny": {
        "si": [
          "J1"
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
    "note": "If any J1 is present, the ranked J1 (payment desc, code asc tiebreak) controls and every non-exempt line — including other J1 lines on a multi-J1 claim — bundles into it. Scope excludes the ranked J1 itself via isNotHighestBy so it never resolves as its own bundling target; a line not a J1 member of the ranking set is never vacuously excluded (§4.3: subjectInAmong false, not an error)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "Q1"
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
    "when": {
      "claimContainsAny": {
        "si": [
          "S",
          "T",
          "V"
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
    "note": "Scope excludes lines already bundled by J1 control (band 2000) — J1 control takes priority, and a second bundleUnder write on the same line is a lint error (§4.3)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
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
    "when": {
      "claimContainsAny": {
        "si": [
          "T"
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
    "note": "Q2 packages against T only — it pays alongside S or V, unlike Q1. The narrower trigger list is deliberate (§9.2)."
  },
  {
    "id": "OPPS.PKG.Q4.COMPANION",
    "version": "2026.1",
    "effectiveFrom": "20260101",
    "effectiveTo": null,
    "phase": "ADJUDICATE",
    "band": 4000,
    "subBand": "a",
    "order": 4200,
    "epoch": "E2",
    "scopeTarget": "line",
    "citation": "Pub 100-04 Ch.4 §10.4; IOCE conditional packaging",
    "scope": {
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "Q4"
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
    "when": {
      "claimContainsAny": {
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
          "tiebreak": "codeAsc"
        }
      }
    ],
    "note": "Q4's trigger list includes J2 even when C-APC 8011 did not fire; Q1's does not. On a bare G0463 claim a Q4 lab bundles while a Q1 line pays. This asymmetry is correct — see OPPS.PKG.Q1.COMPANION."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "Q4"
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
    "when": {
      "claimContainsNone": {
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
    "note": "An unpackaged Q4 converts to SI A and routes to CLFS via the shared resolver (§2.3). The interpreter never imports routing.ts (§4.3) — the adjudicate phase wiring calls routing.resolve(code, 'A') after this rule fires and sets the final status/basis/rate there, not in the registry."
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
      "allOf": {
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
    "when": {
      "isNotHighestBy": {
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
    "note": "Reads epoch E3a — the results of sub-band a's companion-packaging rules — so 'among' only ranks Q1/Q2 lines that survived companion packaging, never a line already bundled there. Sub-band b is required precisely because a single band-4000 epoch would let this rule's bundleUnder name an already-bundled line (§2.5)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "S"
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "SI S pays 100% of its own APC, never discounted when multiple S lines are present. Guarded against a line already bundled by J1 control (§9.1: 'all non-exempt lines' bundle into a controlling J1)."
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
      "allOf": {
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
    "note": "Every T line is set PAID/OPPS_APC here; this milestone computes no dollar amounts (no setAmount/multiply in the operator set — see dsl/operators.ts), so the MPPR 100%/50% split is not applied to a figure. The rank evidence needed to apply it later is captured by OPPS.DISP.T.MPPR_RANK."
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
      "allOf": {
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
    "when": {
      "ordinalAtLeast": {
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
    "then": [
      {
        "flag": {
          "code": "OPPS.T.MPPR_NOT_PRICED",
          "severity": "gap",
          "message": "Ch.4 §10.5 reduces this line to 50% as the 2nd-or-later-ranked T line by relative weight (fallback: payment, for the 8 New Technology APC T codes with no weight) — but this milestone computes no dollar amounts, so the reduction is not applied to any figure."
        }
      }
    ],
    "note": "Records the MPPR rank in the trace (Evaluation.examined.ordinal) via ordinalAtLeast even though no amount is computed this milestone (§4.3's ordinal-recording rationale)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "SI V pays its own visit APC."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "N"
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
    "note": "basis NONE, not OPPS_APC: N carries no Addendum B rate at all (consistent with packaging), so there is no rate-based basis to name. status PACKAGED, not PAID (SI N pays nothing separately — reporting PAID told a reader the line pays, the opposite of the truth) and not BUNDLED (N has no controlling line to name via bundledUnder; it is packaged by SI definition, not by a companion-packaging effect, so bundledUnder stays null)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "K"
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_DRUG_ASP"
        }
      }
    ],
    "note": "SI K is priced — all 526 codes carry a rate."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "R"
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_BLOOD"
        }
      }
    ],
    "note": "SI R (blood/blood products) is priced but not exempt from J1 packaging."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "P"
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
          "status": "PAID_UNPRICED"
        }
      },
      {
        "setBasis": {
          "value": "PHP_PER_DIEM"
        }
      }
    ],
    "note": "SI P is unpriced by data design (partial hospitalization per diem), not exempt from J1 packaging."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "Fires only on the ranked, unbundled J1 line — every other J1 line on a multi-J1 claim was bundled under it by OPPS.PKG.J1.CONTROL (band 2000). The 'comprehensive' character of a J1 APC is priced into the Addendum B rate itself, not a separate basis code — spec §9.1/§9.4 do not state J1's own basis explicitly; OPPS_APC is this build's judgment call (see final report)."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
            "args": {
              "si": [
                "J2"
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
          "status": "PAID"
        }
      },
      {
        "setBasis": {
          "value": "OPPS_APC"
        }
      }
    ],
    "note": "C-APC 8011 (U15) is held/not built this batch, so J2 is always 'unfired' here: it pays its own visit APC and has zero packaging power over other lines — no J2-control rule exists, by omission, matching §9.1."
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
      "allOf": {
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
    "note": "Fires on a Q1/Q2 line that survived both companion packaging (band 4000a) and the same-SI survivor tiebreak (band 4000b) unbundled."
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
      "allOf": {
        "children": [
          {
            "op": "siIn",
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
    "note": "Q3 can still be bundled under a controlling J1 (it is not in the exempt set) — guarded accordingly."
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
      "allOf": {
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
    "when": {
      "claimContainsAny": {
        "si": [
          "Q3"
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
    "note": "SI Q3 is used as the operational proxy for 'composite-APC-eligible companion' — Q3 codes are themselves the composite-APC category, so this is the only claim-derivable signal available; see final report for why this is a judgment call, not a spec-stated rule."
  }
];
