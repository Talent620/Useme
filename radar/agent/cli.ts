// Control surface for the autonomous agent. Minimal commands so the operator
// only does what truly needs a human:
//
//   node agent/cli.ts once         # run a single cycle now
//   node agent/cli.ts loop         # run forever on the configured interval
//   node agent/cli.ts status       # store stats + source health
//   node agent/cli.ts leads [id]   # list leads (optionally for one tenant)
//   node agent/cli.ts draft <leadId>   # print the ready-to-send draft
//   node agent/cli.ts mark <leadId> <STATUS>   # WON/REJECTED/SENT...

import { DEFAULT_LEARN, loadConfig } from "./config.ts";
import { recordToMemory, runAttest, runBoard, runCrm, runExecute, runExecuteLead, runFinance, runForecast, runNegotiate, runPrice, runPriceTrain, runQualityTrain, runRank, runReport, runSend, runStrategy, runTrain, runVerifyAttestation } from "./actions.ts";
import { buildTenant, previewForProfile, registerTenant } from "./onboarding.ts";
import { VERSION } from "./version.ts";
import { applyStagedUpdate, checkAndStage } from "./updater.ts";
import { serve } from "./serve.ts";
import { runCycle } from "./cycle.ts";
import { loop, storePath } from "./daemon.ts";
import { Store } from "./store.ts";

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", x: "\x1b[0m" };
const tty = process.stdout.isTTY;
const col = (s: string, c: string) => (tty ? `${c}${s}${C.x}` : s);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  // Apply a self-update staged by a previous run (cron/manual) before anything.
  if (applyStagedUpdate().applied) console.error(col("✓ zastosowano automatyczną aktualizację", C.g));
  const store = new Store(storePath());

  switch (cmd) {
    case "version":
      console.log(`RadarPL ${VERSION}`);
      break;
    case "update": {
      console.log(col("Sprawdzam aktualizacje...", C.dim));
      const r = await checkAndStage(undefined, true);
      if (r.status === "staged") {
        const a = applyStagedUpdate();
        console.log(a.applied ? col(`✓ Zaktualizowano ${r.current} → ${r.latest}`, C.g) : col(`Pobrano ${r.latest}, zostanie wdrożone przy następnym starcie`, C.y));
      } else if (r.status === "up-to-date") {
        console.log(col(`✓ Masz najnowszą wersję (${r.current})`, C.g));
      } else {
        console.log(col(`Aktualizacja: ${r.status}${r.latest ? " (najnowsza: " + r.latest + ")" : ""}`, C.y));
      }
      break;
    }
    case "once": {
      const m = await runCycle(store, loadConfig(), Date.now());
      console.log(col("✓ Cykl zakończony", C.g));
      console.log(`  Źródła:        ${m.sources.map((s) => `${s.name}(${s.ok ? s.raw : "ERR"})`).join(", ")}`);
      console.log(`  Nowe sygnały:  ${m.newSignals}`);
      console.log(`  Nowe leady:    ${col(String(m.leadsCreated), C.b)}`);
      console.log(`  Do outreachu:  ${col(String(m.queuedForOutreach), C.y)}  ${col("(node agent/cli.ts outbox)", C.dim)}`);
      console.log(`  Wykonane:      ${col(String(m.executed), C.g)}  ${col("(zlecenia zrealizowane autonomicznie)", C.dim)}`);
      console.log(`  Digesty:       ${m.digests.map((d) => `${d.tenant}:${d.leads}`).join(", ") || "—"}`);
      console.log(col(`  Czas: ${m.durationMs} ms`, C.dim));
      for (const d of m.digests) console.log(col(`  → ${d.ref}`, C.dim));
      break;
    }
    case "loop":
      await loop();
      break;
    case "status": {
      const s = store.stats();
      console.log(col("\n  RadarPL — status agenta\n", C.b));
      console.log(`  Sygnałów widzianych:  ${s.signalsSeen}`);
      console.log(`  Leadów łącznie:       ${s.leads}`);
      console.log(`  Dostaw:               ${s.deliveries}`);
      console.log(`  Wysłanych ofert:      ${col(String(s.sends), C.b)}`);
      console.log(`  Wg statusu:           ${Object.entries(s.byStatus).map(([k, v]) => `${k}:${v}`).join(", ") || "—"}`);
      console.log(`  Outreach:             ${Object.entries(s.byOutreach).filter(([k]) => k !== "none").map(([k, v]) => `${k}:${v}`).join(", ") || "—"}`);
      const cfgS = loadConfig();
      const learned = cfgS.tenants
        .map((t) => ({ id: t.id, m: store.getLearned(t.id) }))
        .filter((x) => x.m);
      if (learned.length) {
        console.log(col("\n  Modele self-improving:", C.b));
        for (const { id, m } of learned) {
          console.log(`    ${id}: ${Object.keys(m!.keywordWeights).length} wag, ${m!.trainedOn} przykładów ${col(m!.updatedAt?.slice(0, 16).replace("T", " ") ?? "", C.dim)}`);
        }
      }
      console.log(col("\n  Zdrowie źródeł:", C.b));
      for (const [name, st] of Object.entries(s.sources)) {
        const mark = st.healthy ? col("●", C.g) : col("●", C.r);
        console.log(`    ${mark} ${name}  ${col(st.lastRunAt?.slice(0, 16).replace("T", " ") ?? "—", C.dim)}${st.lastError ? col("  " + st.lastError, C.r) : ""}`);
      }
      console.log();
      break;
    }
    case "leads": {
      const tenantId = args[0];
      const cfg = loadConfig();
      const tenants = tenantId ? cfg.tenants.filter((t) => t.id === tenantId) : cfg.tenants;
      for (const t of tenants) {
        const leads = store.leadsForTenant(t.id).slice(0, 20);
        console.log(col(`\n  ${t.name} (${t.id}) — ${leads.length} leadów`, C.b));
        for (const l of leads) {
          const sc = l.score >= 70 ? C.g : l.score >= 50 ? C.y : C.dim;
          console.log(`    ${col(`[${l.score}]`, sc)} ${l.id}  ${l.signalTitle}  ${col(l.status, C.dim)}`);
        }
      }
      console.log();
      break;
    }
    case "draft": {
      const lead = store.findLead(args[0]);
      if (!lead) return fail(`Brak leada ${args[0]}`);
      console.log(col(`Temat: ${lead.draftSubject}`, C.b));
      console.log("\n" + (lead.draftBody ?? ""));
      break;
    }
    case "mark": {
      const [leadId, status] = args;
      const ok = store.setLeadStatus(leadId, status as never);
      // Feed the long-term memory / data moat on closed deals.
      if (ok && status === "WON") recordToMemory(store, leadId!, "win");
      if (ok && status === "REJECTED") recordToMemory(store, leadId!, "loss");
      console.log(ok ? col(`✓ ${leadId} -> ${status}`, C.g) : col(`Brak leada ${leadId}`, C.r));
      break;
    }
    case "board": {
      const b = runBoard(store, loadConfig());
      console.log(col("\n  Zespół agentów (boardroom)\n", C.b));
      for (const a of b.agents) {
        console.log(`  ${col(a.name.padEnd(10), C.b)} ${col(a.summary, C.dim)}`);
        for (const r of a.recommendations) console.log(`     • ${r}`);
      }
      console.log(col("\n  CEO — priorytety:", C.b));
      b.priorities.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
      console.log();
      break;
    }
    case "finance": {
      const f = runFinance(store, loadConfig());
      console.log(col("\n  Agent finansowy (CFO)\n", C.b));
      console.log(`  Przychód (egzekucja): ${col(f.executionRevenue + " zł", C.g)}  ·  Koszt: ${f.cost} zł  ·  Marża: ${col(f.grossMargin + " zł", f.grossMargin >= 0 ? C.g : C.r)} (${f.marginPct}%)`);
      console.log(`  MRR: ${f.mrr} zł  ·  ARPU: ${f.arpu} zł  ·  Płacący: ${f.payingTenants}/${f.activeTenants}`);
      console.log(`  CAC: ${f.cac} zł  ·  LTV: ${f.ltv} zł  ·  LTV/CAC: ${col(String(f.ltvCacRatio), f.ltvCacRatio >= 3 ? C.g : C.y)}  ·  ROI: ${f.roi}x\n`);
      break;
    }
    case "crm": {
      const { pipeline, followUps } = runCrm(store, loadConfig());
      console.log(col("\n  CRM — pipeline\n", C.b));
      for (const [stage, n] of Object.entries(pipeline)) if (n) console.log(`    ${stage.padEnd(12)} ${n}`);
      console.log(col(`\n  Follow-upy do wysłania: ${followUps.length}`, followUps.length ? C.y : C.dim));
      for (const f of followUps.slice(0, 8)) console.log(col(`    ${f.leadId} (próba ${f.attempt}): ${f.message.slice(0, 70)}…`, C.dim));
      console.log();
      break;
    }
    case "onboard": {
      const f = parseFlags(args);
      if (!f.email || !f.headline) {
        console.log(col('Użycie: onboard --name "Jan" --email jan@x.pl --headline "Robię strony WordPress i SEO" [--min 500] [--max 50000] [--register]', C.y));
        return;
      }
      const profile = {
        name: f.name ?? f.email, email: f.email, headline: f.headline,
        minBudget: f.min ? Number(f.min) : undefined, maxBudget: f.max ? Number(f.max) : undefined,
      };
      const tenant = buildTenant(profile);
      console.log(col(`\n  Auto-profil dla ${tenant.name} [${tenant.plan}]`, C.b));
      console.log(`  Rola:        ${tenant.sender.role}`);
      console.log(`  Kategorie:   ${tenant.icp.categories.join(", ")}`);
      console.log(`  Słowa klucz: ${tenant.icp.keywords.join(", ")}`);
      const { leads } = await previewForProfile(profile);
      console.log(col(`\n  Proof-of-value — leady, które dostałbyś teraz (${leads.length}):`, C.b));
      for (const l of leads) {
        const sc = l.score >= 70 ? C.g : C.y;
        console.log(`    ${col(`[${l.score}]`, sc)} ${l.title}`);
      }
      if (f.register !== undefined) {
        const r = registerTenant(tenant);
        console.log(r.added ? col(`\n✓ Zarejestrowano ${tenant.id} — kolejne cykle będą go obsługiwać (tenantów: ${r.total})`, C.g)
                            : col(`\n• ${tenant.id} już istnieje`, C.dim));
      } else {
        console.log(col("\n  Dodaj --register aby zapisać i włączyć stały monitoring.", C.dim));
      }
      console.log();
      break;
    }
    case "execute": {
      const cfg = loadConfig();
      const before = store.executableLeads().length;
      if (!before) {
        console.log(col("  Brak wygranych zleceń do wykonania (oznacz lead jako WON).", C.dim));
        break;
      }
      console.log(col(`\n  Autonomiczna realizacja ${before} zleceń...\n`, C.b));
      const s = await runExecute(store, cfg);
      for (const it of s.items) {
        const g = it.gate === "auto" ? col("AUTO", C.g) : col("REVIEW", C.y);
        console.log(`  ${g} ${it.leadId} [${it.capability}] jakość ${it.confidence}/100  ${col(it.ref, C.dim)}`);
      }
      console.log(col(`\n✓ Wykonano ${s.executed} (auto: ${s.auto}, do przeglądu: ${s.review})`, C.g));
      break;
    }
    case "mark-exec": {
      const [leadId, outcome] = args;
      const ok = store.recordExecutionOutcome(leadId, outcome as never);
      console.log(ok ? col(`✓ Wykonanie ${leadId} -> ${outcome}`, C.g) : col(`Brak leada ${leadId}`, C.r));
      break;
    }
    case "strategy": {
      const cfg = loadConfig();
      const apply = parseFlags(args).apply !== undefined;
      const { funnel, recommendations, applied } = runStrategy(store, cfg, apply || undefined);
      const t = funnel.totals;
      console.log(col("\n  Agent-CEO — P&L lejka\n", C.b));
      console.log(`  Leady: ${t.leads}  ·  Wygrane: ${t.won}  ·  Przychód: ${col(t.revenue + " zł", C.g)}  ·  Koszt: ${t.cost} zł  ·  Marża: ${col(t.margin + " zł", t.margin >= 0 ? C.g : C.r)}`);
      const top = funnel.byCategory.slice(0, 5);
      if (top.length) {
        console.log(col("\n  Wg kategorii (marża / ROI):", C.b));
        for (const s of top) console.log(`    ${s.key.padEnd(12)} marża ${String(s.margin).padStart(7)} zł  ROI ${s.roi}x  (win ${Math.round(s.winRate * 100)}%, akcept ${Math.round(s.acceptanceRate * 100)}%)`);
      }
      console.log(col("\n  Rekomendacje (priorytet wg wpływu):", C.b));
      if (!recommendations.length) console.log(col("    — brak (za mało danych)", C.dim));
      for (const r of recommendations.slice(0, 8)) {
        const tag = r.autoApplicable ? col("[auto]", C.g) : col("[ręczne]", C.y);
        console.log(`    ${tag} ${col(r.action, C.b)} → ${r.target}  (+${r.expectedImpactPln} zł, ${Math.round(r.confidence * 100)}%)`);
        console.log(col(`        ${r.rationale}`, C.dim));
      }
      if (applied.length) console.log(col(`\n  ✓ Auto-zastosowano: wyłączono źródła ${applied.join(", ")}`, C.g));
      else console.log(col("\n  (dodaj --apply aby auto-zastosować bezpieczne ruchy)", C.dim));
      console.log();
      break;
    }
    case "serve": {
      const f = parseFlags(args);
      serve(f.port ? Number(f.port) : undefined, f.host);
      return; // keep process alive
    }
    case "auto": {
      // One button: run a full autonomous cycle, then surface the operator report.
      const cfg = loadConfig();
      const m = await runCycle(store, cfg, Date.now());
      console.log(col(`✓ Cykl: ${m.newSignals} nowych sygnałów, ${m.leadsCreated} leadów, ${m.executed} zleceń wykonanych`, C.g));
      const { ref } = runReport(store, cfg, new Date().toISOString());
      console.log(col(`  Panel: ${ref}  (node agent/cli.ts report)`, C.dim));
      break;
    }
    case "work": {
      const item = await runExecuteLead(store, loadConfig(), args[0] ?? "");
      if (!item) return fail(`Brak leada ${args[0]}`);
      const g = item.gate === "auto" ? col("AUTO", C.g) : col("REVIEW", C.y);
      console.log(`  ${g} ${item.leadId} [${item.capability}] jakość ${item.confidence}/100`);
      for (const f of item.files) console.log(col(`    → ${f}`, C.dim));
      break;
    }
    case "deliverables": {
      const dels = store.deliverables();
      if (!dels.length) { console.log(col("  Brak wykonanych zleceń (mark <id> WON → execute).", C.dim)); break; }
      console.log(col(`\n  Wykonane zlecenia (${dels.length}):\n`, C.b));
      for (const d of dels) {
        const g = d.gate === "auto" ? col("AUTO", C.g) : col("REVIEW", C.y);
        console.log(`    ${g} ${d.capability ?? "?"} ${d.confidence ?? "?"}/100  ${d.title}${d.outcome ? col(" · " + d.outcome, C.dim) : ""}`);
        console.log(col(`        ${d.ref}`, C.dim));
      }
      console.log();
      break;
    }
    case "report": {
      const { markdown, ref } = runReport(store, loadConfig(), new Date().toISOString());
      console.log(markdown);
      console.error(col(`\n  → zapisano: ${ref}`, C.dim));
      break;
    }
    case "forecast": {
      const { forecasts, recommendations } = runForecast(store);
      console.log(col("\n  Prognoza popytu (trend wg momentum)\n", C.b));
      if (!forecasts.length) { console.log(col("    — za mało danych", C.dim)); break; }
      for (const f of forecasts.slice(0, 8)) {
        const arrow = f.trend === "rising" ? col("▲ rośnie", C.g) : f.trend === "declining" ? col("▼ słabnie", C.r) : col("→ stabilnie", C.dim);
        console.log(`    ${f.key.padEnd(12)} ${arrow}  momentum ${f.momentum}x  prognoza ${f.predictedNext}/dzień  (slope ${f.slope})`);
      }
      if (recommendations.length) {
        console.log(col("\n  Prealokacja (wyprzedź popyt):", C.b));
        for (const r of recommendations) console.log(`    ${col(r.action, C.b)} → ${r.target}  ${col(`(${Math.round(r.confidence * 100)}%)`, C.dim)}\n        ${col(r.rationale, C.dim)}`);
      }
      console.log();
      break;
    }
    case "rank": {
      const { namespaces } = runRank(store);
      console.log(col("\n  RL-lite ranking — czego nauczył się agent z realnych wyników\n", C.b));
      let any = false;
      for (const { ns, arms } of namespaces) {
        if (!arms.length) continue;
        any = true;
        console.log(col(`  ${ns}:`, C.b));
        for (const a of arms) {
          const vc = a.value >= 0.6 ? C.g : a.value >= 0.3 ? C.y : C.dim;
          console.log(`    ${col(a.value.toFixed(3), vc)}  ${a.arm.padEnd(20)} ${col(`(${a.n} prób)`, C.dim)}`);
        }
      }
      if (!any) console.log(col("    — brak danych (oznacz leady WON/REJECTED: mark <id> WON)", C.dim));
      console.log();
      break;
    }
    case "price": {
      const r = runPrice(store, args[0] ?? "");
      if (!r) return fail(`Brak leada ${args[0]}`);
      console.log(col(`\n  Rekomendowana cena dla ${args[0]}\n`, C.b));
      console.log(`  Cena:         ${col(r.recommendedPrice + " zł", C.g)}  (${Math.round(r.fraction * 100)}% budżetu)`);
      console.log(`  P(wygranej):  ${col(Math.round(r.winProbability * 100) + "%", r.winProbability >= 0.5 ? C.g : C.y)}`);
      console.log(`  Wartość ocz.: ${col(r.expectedValue + " zł", C.b)}  ·  Marża: ${r.marginPct}%`);
      console.log(col(`  Podstawa: intent ${r.basis.score}/100, historia win ${Math.round(r.basis.histWinRate * 100)}% (${r.basis.histSamples} prób), konkurencja ${r.basis.competition.toFixed(2)}`, C.dim));
      console.log();
      break;
    }
    case "attest": {
      const r = await runAttest(store, args[0] ?? "");
      if ("error" in r) return fail(r.error);
      const oc = r.outcome === "pass" ? C.g : C.r;
      console.log(col(`\n  Proof-of-Outcome dla ${r.leadId}\n`, C.b));
      console.log(`  Werdykt:      ${col(r.outcome.toUpperCase(), oc)}`);
      console.log(`  artifactHash: ${col(r.attestation.artifactHash.slice(0, 16) + "…", C.dim)}`);
      console.log(`  specHash:     ${col(r.attestation.specHash.slice(0, 16) + "…", C.dim)}`);
      console.log(`  resultHash:   ${col(r.attestation.resultHash.slice(0, 16) + "…", C.dim)}`);
      console.log(col(`  Każdy z tym plikiem i specyfikacją może niezależnie zweryfikować: verify ${r.leadId}`, C.dim));
      console.log();
      break;
    }
    case "verify": {
      const r = await runVerifyAttestation(store, args[0] ?? "");
      if ("error" in r) return fail(r.error);
      const oc = r.ok ? C.g : C.r;
      console.log(col(`\n  Weryfikacja atestacji ${r.leadId} (re-egzekucja)\n`, C.b));
      console.log(`  Wynik:        ${col(r.ok ? "✓ POTWIERDZONA" : "✗ NIEZGODNA", oc)}`);
      console.log(`  artifact:     ${r.artifactMatch ? col("✓", C.g) : col("✗ zmieniony", C.r)}  ·  spec: ${r.specMatch ? col("✓", C.g) : col("✗ dryf", C.r)}  ·  result: ${r.resultMatch ? col("✓", C.g) : col("✗", C.r)}  ·  podpis: ${r.signatureValid ? col("✓", C.g) : col("✗", C.r)}`);
      console.log();
      break;
    }
    case "negotiate": {
      const leadId = args[0] ?? "";
      const offer = Number(args[1]);
      if (!leadId || !Number.isFinite(offer)) return fail("Użycie: negotiate <leadId> <ofertaKlienta>");
      const r = runNegotiate(store, leadId, offer);
      if (!r) return fail(`Brak leada ${leadId}`);
      const ac = r.action === "accept" ? C.g : r.action === "counter" ? C.y : C.r;
      const label = r.action === "accept" ? "AKCEPTUJ" : r.action === "counter" ? "KONTROFERTA" : "ODPUŚĆ";
      console.log(col(`\n  Negocjacje — runda ${r.round} (lead ${leadId})\n`, C.b));
      console.log(`  Nasza cena: ${r.ourPrice} zł  ·  Oferta klienta: ${r.clientOffer} zł  ·  Próg (floor): ${r.floor} zł`);
      console.log(`  Decyzja:    ${col(label, ac)}${r.price ? ` → ${col(r.price + " zł", C.b)}` : ""}${r.acceptProbability ? col(`  (akcept. ${Math.round(r.acceptProbability * 100)}%)`, C.dim) : ""}`);
      console.log(`  EV:         ${col(r.expectedValue + " zł", r.expectedValue >= 0 ? C.g : C.r)}`);
      console.log(col(`  ${r.rationale}`, C.dim));
      console.log();
      break;
    }
    case "price-train": {
      const r = runPriceTrain(store);
      console.log(col("\n  Kalibracja modelu cenowego z historii win/loss\n", C.b));
      if (r.trainedOn < 8) {
        console.log(col(`  Za mało zamkniętych transakcji z ceną (${r.trainedOn}/8). Oznaczaj WON/REJECTED — model nauczy się sam.`, C.y));
      } else {
        console.log(`  Próbki:    ${col(String(r.trainedOn), C.b)}  ·  log-loss: ${col(String(r.logLoss), r.logLoss < 0.6 ? C.g : C.y)}`);
        console.log(`  Wagi:      bias ${r.weights.bias}  ·  intent ${r.weights.score}  ·  wrażliwość na cenę ${col(String(r.weights.priceFraction), C.b)}`);
        console.log(col("  ✓ Zapisano — kolejne cykle wyceniają realną elastycznością cenową.", C.g));
      }
      console.log();
      break;
    }
    case "quality": {
      const model = runQualityTrain(store);
      const caps = Object.values(model.byCapability);
      if (!caps.length) {
        console.log(col("  Brak ocen wykonania (użyj: mark-exec <leadId> ACCEPTED|REVISION|REJECTED).", C.dim));
        break;
      }
      console.log(col("\n  Model jakości wykonania (samokalibracja bramki):\n", C.b));
      for (const q of caps) {
        const rate = Math.round(q.acceptanceRate * 100);
        const rc = rate >= 80 ? C.g : rate >= 50 ? C.y : C.r;
        console.log(`    ${col(q.capability.padEnd(9), C.b)} akceptacja ${col(rate + "%", rc)} (${q.accepted}/${q.n})  → próg ${q.minConfidence}/100, iteracje ${q.maxIterations}`);
      }
      console.log();
      break;
    }
    case "train": {
      const cfg = loadConfig();
      const learn = cfg.settings.learn ?? DEFAULT_LEARN;
      console.log(col("\n  Trening modeli z wyników (WON/REPLIED vs REJECTED):\n", C.b));
      for (const r of runTrain(store, cfg)) {
        if (!r.trained) {
          console.log(`    ${r.tenantId}: ${col(`za mało danych (${r.examples}/${learn.minExamples})`, C.dim)}`);
          continue;
        }
        const pos = r.top.filter((x) => x.weight > 0).slice(0, 3).map((x) => `${x.keyword}+${x.weight}`);
        const neg = r.top.filter((x) => x.weight < 0).slice(0, 3).map((x) => `${x.keyword}${x.weight}`);
        console.log(`    ${col(r.tenantId, C.b)}: ${r.examples} przykładów  ${col(pos.join(" ") || "—", C.g)}  ${col(neg.join(" ") || "", C.r)}`);
      }
      console.log();
      break;
    }
    case "outbox": {
      const pending = store.outbox();
      if (!pending.length) {
        console.log(col("  Skrzynka pusta — brak leadów do wysłania.", C.dim));
        break;
      }
      console.log(col(`\n  Do wysłania (${pending.length}):\n`, C.b));
      for (const l of pending) {
        const sc = l.score >= 85 ? C.g : C.y;
        const flag = l.outreachStatus === "approved" ? col("✓ zaakceptowany", C.g) : col("⏳ czeka", C.y);
        console.log(`    ${col(`[${l.score}]`, sc)} ${l.id}  ${l.signalTitle}  ${flag}`);
      }
      console.log(col("\n  approve <id> | reject <id> | approve all | send\n", C.dim));
      break;
    }
    case "approve": {
      if (args[0] === "all") {
        let n = 0;
        for (const l of store.outbox("queued")) { store.setOutreach(l.id, "approved"); n++; }
        console.log(col(`✓ Zaakceptowano ${n} leadów`, C.g));
      } else {
        const ok = store.setOutreach(args[0], "approved");
        console.log(ok ? col(`✓ ${args[0]} zaakceptowany`, C.g) : col(`Brak leada ${args[0]}`, C.r));
      }
      break;
    }
    case "reject": {
      const ok = store.setOutreach(args[0], "skipped");
      console.log(ok ? col(`✓ ${args[0]} pominięty`, C.y) : col(`Brak leada ${args[0]}`, C.r));
      break;
    }
    case "send": {
      const cfg = loadConfig();
      const summary = await runSend(store, cfg);
      if (!summary.items.length && !summary.capped) {
        console.log(col("  Brak zaakceptowanych leadów do wysłania.", C.dim));
        break;
      }
      for (const it of summary.items) console.log(`  ${col("→", C.g)} ${it.leadId} via ${it.via}  ${col(it.ref, C.dim)}`);
      console.log(col(`\n✓ Wysłano ${summary.sent}${summary.capped ? `, wstrzymano ${summary.capped} (dzienny limit)` : ""}`, C.g));
      break;
    }
    default:
      console.log(`RadarPL agent. Komendy:
  once                 jeden cykl teraz
  loop                 pętla autonomiczna (interwał z configu)
  status               statystyki + zdrowie źródeł
  leads [tenantId]     lista leadów
  draft <leadId>       pokaż gotowy draft wiadomości
  outbox               leady czekające na wysłanie (bramka akceptacji)
  approve <id>|all     zaakceptuj lead(y) do wysłania
  reject <id>          pomiń lead w outreachu
  send                 wyślij zaakceptowane (limit dzienny z configu)
  mark <leadId> <S>    ustaw status (WON/REJECTED/SENT/REPLIED)
  serve [--port 7777]  panel webowy (przejrzysty UI, live, przyciski akcji)
  auto                 JEDEN PRZYCISK: pełny cykl + wykonanie + panel
  execute              autonomicznie zrealizuj wygrane zlecenia (deliverable)
  work <leadId>        wykonaj konkretne zlecenie teraz (na żądanie)
  deliverables         lista gotowych prac (ścieżki do plików)
  mark-exec <id> <O>   oceń wykonanie (ACCEPTED/REVISION/REJECTED)
  quality              model jakości wykonania (samokalibracja bramki)
  board                zespół agentów (CEO/Sales/Research/.../Finance) + priorytety
  finance              agent finansowy: P&L, MRR, CAC, LTV, ROI
  crm                  pipeline + follow-upy do wysłania
  strategy [--apply]   agent-CEO: P&L lejka + rekomendacje realokacji
  forecast             prognoza popytu + prealokacja (wyprzedź trend)
  rank                 RL-lite: czego agent nauczył się z wyników (źródła/kanały/kategorie)
  price <leadId>       rekomendowana cena + P(wygranej) + wartość oczekiwana
  price-train          skalibruj wagi modelu cenowego z historii win/loss (auto co cykl)
  negotiate <id> <kwota>  doradca kontroferty (accept/counter/decline, EV + próg)
  attest <leadId>      wygeneruj replayowalny dowód wykonania (Proof-of-Outcome)
  verify <leadId>      niezależnie zweryfikuj atestację przez re-egzekucję
  report               panel operatora: pełny stan + co trzeba zrobić
  train                naucz modele scoringu z wyników (WON/LOST)
  onboard --email .. --headline ".."   auto-profil + proof-of-value [--register]
  version              pokaż wersję
  update               sprawdź i zainstaluj aktualizację (auto co release w daemonie)`);
  }
}

function fail(msg: string) {
  console.error(col(msg, C.r));
  process.exitCode = 1;
}

/** Parse `--key value` and boolean `--flag` args into a record. */
function parseFlags(args: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "";
      }
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
