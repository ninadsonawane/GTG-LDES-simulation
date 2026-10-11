# GTG–LDES operating-point experiment

An **independent simulation based on P4**, built by Ninad Sonawane to understand how a gas turbine generator (GTG) setpoint affects long-duration energy storage (LDES) under synthetic AI demand. It is not an exact reproduction of the authors' workload trace, controller or optimization results.

**Paper:** H. Mun, D. Zechevikj, S. Santoso and L. Jiang, “Optimal Operation of Gas Turbine Generator and Energy Storage for Islanded Microgrid AI Data Centers Under Workload Dynamics,” *Inventions*, 2026, 11, 81. https://doi.org/10.3390/inventions11040081

## Research question and hypothesis

**Question:** How does GTG output change storage utilization, and which operating points respect storage power and SoC limits?

**Hypothesis:** Moving constant generation toward an efficiency-adjusted demand level can reduce accumulated SoC drift and energy movement. The setpoint that minimizes one utilization metric need not minimize the others or satisfy operating limits. Average SoC and a good terminal SoC are insufficient substitutes for checking the full trajectory.

This is a supporting foundational experiment. It does not demonstrate a new optimizer, battery lifetime improvement or full-system reliability.

## Run the simulation

Open `index.html` directly in a browser. The application runs offline; it requires no installation, backend, CDN or account. Alternatively, with Node.js 18 or newer:

```sh
npm run serve
```

Open http://127.0.0.1:8080. Change GTG output using the slider or numeric field. Adjust workload proportions, demand mean, fluctuation intensity, storage parameters, duration and seed. All numerical results update automatically. The optional sweep evaluates 101 GTG setpoints from 1 to 12 MW.

To reproduce the default numerical experiment:

```sh
npm test
npm run experiment
```

No npm dependencies are required. The experiment writes `results/experiment.json` and `results/sweep.csv`. An optional JSON parameter file can be supplied with `node scripts/run-experiment.cjs settings.json`. Use the `parameters` object from the browser settings export as that file's contents. Efficiencies and initial SoC are fractions in the model/JSON; the UI displays percentages.

## Input → calculation → output

| Stage | Definition |
|---|---|
| Inputs | Synthetic facility demand trace; constant GTG setpoint; storage energy and power ratings; efficiencies; initial SoC; duration, timestep and seed |
| Power balance | LDES supplies demand deficits and absorbs generator surplus |
| Energy state | Integrate charge/discharge power with efficiency to obtain SoC at each timestep |
| Four P4 metrics | Mode transitions, charging-time ratio, absolute average-SoC deviation from 80%, AC-side energy movement |
| Feasibility checks | Required storage power versus rating; every SoC state versus 20–90%; physical 0–100% violations |

For a given demand sample `L[k]` and generator output `G`:

```text
D[k] = max(L[k] - G, 0)        discharge, MW at the AC bus
C[k] = max(G - L[k], 0)        charge, MW at the AC bus
G + D[k] = L[k] + C[k]
SoC[k+1] = SoC[k] + (etaCharge*C[k] - D[k]/etaDischarge) * dtHours / capacityMWh
dtHours = dtSeconds / 3600
```

The SoC equation follows P4 §2.3.3, Eq. 16. P4 §2.4 is the basis for the four metrics and 101-point sweep. **Charging/discharging are never simultaneous.**

## What follows P4, and what is independently assumed?

| Item | Provenance |
|---|---|
| Training, fine-tuning and inference phases | P4 §2.2 |
| Phase selection proportional to target time share / dwell time | P4 Eq. 15; independently implemented |
| 48 nodes; nominal 12 MW block | P4 facility scale |
| 132 MWh default nameplate energy | Upper representative sizing case in P4 Table 4; not a claim about the capacity used in every paper plot |
| 20–90% normal SoC band; 80% reference | P4 §2.3.3 |
| 1–12 MW, 101-point generator sweep | P4 §2.4.1 |
| Four utilization metrics | P4 §2.4.2 |
| Dwell times, activity levels, auxiliary model, fluctuation statistics | Independent illustrative assumptions below |
| 95% charge and 95% discharge efficiency | Independent assumptions; not extracted numerical values from P4 |
| Weighted normalized objective and SoC-restoration controller | Not implemented; no automatic optimal-setpoint claim |
| P4 Table 5 segmented schedule | Not implemented here; this experiment varies constant setpoints as in §2.4 |

### Synthetic demand assumptions

- Each of 48 asynchronous nodes occupies one of three phases. Deterministic nominal dwell times are 600 s (training), 180 s (fine-tuning), 30 s (inference). Phase selection weights are proportional to the requested shares divided by these durations. Initial phases use the requested shares with random remaining durations. Shares are time-allocation targets, not a guarantee of exact finite-horizon phase occupancy.
- Relative activity levels are 1, 0.75 and 0.35. Within-phase fluctuation amplitudes are 0.04, 0.14 and 0.30, multiplied by the input intensity. A seeded bounded AR(1) process uses a 30 s correlation time. Activity is bounded to 0.05–1.25. This is an illustrative aggregate model, not the paper's detailed checkpoint, fine-tuning-stage or request-arrival model.
- Raw node power is `0.04 + 0.114 * activity` MW. Raw auxiliary power is `0.4 + 0.25 * IT` MW. The whole facility trace (IT and auxiliaries) is then rescaled to the requested average demand. Consequently, at a fixed requested mean, changing phase shares affects variability, not mean energy. Raw node ratings are not preserved after rescaling. Zero fluctuation intensity removes within-phase noise but not variation from phase switching.
- The generator is constant. Storage instantaneously supplies the remaining mismatch. No generator ramp or voltage/frequency dynamics are simulated.
- The default horizon is 24 h at 5 s resolution, seed 20261011. The UI supports up to 168 h and 1–60 s timesteps. A duration must contain a whole number of timesteps. This model does not apply the seven-day phase-share schedule from P4 Table 2.

### Fair comparison and caching

GTG output, storage ratings, efficiencies and initial SoC **never regenerate demand**. Demand changes only when its own inputs (shares, mean, intensity, seed, duration or timestep) change. Every sweep uses the same immutable demand trace and starts from the same initial SoC. There is no state carryover between setpoint candidates.

### Metrics and validity

- **Transitions:** count changes between nonzero charging and discharging modes. Idle samples are ignored and an initial mode is not counted as a transition. A `1e-10 MW` tolerance treats numerical near-zero power as idle. This explicit counting convention need not match the paper's undocumented treatment of idle samples. Transitions are not rainflow cycles, equivalent full cycles or battery degradation.
- **Charging time:** fraction of intervals whose charging power exceeds the idle tolerance.
- **SoC deviation:** `abs(mean(SoC[k], k=0..N-1) - 0.8) * 100`, in percentage points. This is the deviation of average SoC, not the average absolute deviation of the trajectory.
- **Energy movement:** `sum(C[k] + D[k]) * dtHours`, in MWh at the AC bus. This is gross throughput, not net stored energy or monetary cost.
- **Operating validity:** every stored-energy state (including the initial and terminal states) must be within 20–90%, and every required storage power must be within the rating. Values are not silently clipped. Crossing physical 0–100% bounds makes the subsequent algebraic trajectory nonphysical. Power exceedance implies unmet load or unabsorbed surplus would occur without another action; the displayed balance assumes unconstrained storage and does not simulate that remedy.
- Passing these checks does not prove 12-hour outage autonomy, N+1 redundancy, Tier compliance, dynamic stability or lifespan. There is no outage, calendar/cycle aging, fuel or lifecycle cost model.
- All metrics use the full timestep-resolution trace. Dense charts retain binned extrema rather than plotting every point; hover displays a nearby sampled value. Changing timestep can materially change transition counts and the synthetic fluctuation trace.

## Experimental protocol and interpretation

1. Freeze demand, seed and storage settings. Compare 2, 5, 6 MW and a setpoint near average demand.
2. Inspect power limits and the complete SoC trajectory before comparing metric values.
3. Run the 101-point sweep. Report the four metrics separately; do not label a numerical metric minimum an optimal dispatch without a defined objective and feasibility requirement.
4. Repeat across workload shares and multiple seeds to test whether an observation is trace-specific. This repository's default result is one scenario, not statistical validation.
5. Export the trace, settings and sweep. The settings export records model parameters and selected metrics so comparisons can be reproduced.

Expected interpretation is deliberately limited: low generation produces net depletion; high generation produces net accumulation. Close to average demand, efficiency losses can still cause downward drift. A low transition count alone can represent continuous charging/discharging and does not prove good operation. Future work could add time-varying dispatch, explicit reserve constraints and uncertainty before drawing reliability or economic conclusions.

## Checks

`npm test` checks analytical charge/discharge cases, timestep units, loss accumulation, idle transition counting, unclipped violations, SoC metric conventions, deterministic demand, fixed-trace comparisons, sweep consistency and invalid-input handling.

`tests/browser-check.cjs` is an optional browser verification using Playwright. Install Playwright separately if needed; set `BROWSER_EXECUTABLE` when using a system browser. It checks controls, trace reuse, demand regeneration, errors, the sweep, CSV downloads and narrow-screen layout. Browser QA outputs go to ignored `test-results/`.

## Reproducible default result

The committed result files use the default 24-hour synthetic trace, 8 MW mean demand, 8.2 MW GTG, 132 MWh storage and 95% efficiency each way. These values are **this implementation's output**, not P4's reported result.

| Metric | Default result |
|---|---:|
| Charge/discharge transitions | 1,066 |
| Charging-time ratio | 84.63% |
| Absolute average-SoC deviation from 80% | 1.74 percentage points |
| AC-side energy movement | 5.45 MWh |
| Minimum / maximum SoC | 80.00% / 83.43% |
| Final SoC | 83.43% |
| Sweep candidates within modeled limits | 33 of 101 |

**Interpretation:** The selected GTG output exceeds the demand mean, so storage accumulates energy despite efficiency losses. This 24-hour case remains within modeled limits, but its upward drift is not evidence of long-term energy neutrality. The 33 feasible candidates depend on the assumed horizon, capacity, seed and limits; they are not universal operating recommendations.

Ten numerical tests and browser checks passed before publication. The browser checks confirmed fixed-trace comparisons, invalid-input handling, all 101 sweep candidates, trace/sweep/settings exports, offline operation and 375-pixel layout. Browser and Node default metrics agree to floating-point precision.

