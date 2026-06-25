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
import { runExecute, runQualityTrain, runSend, runTrain } from "./actions.ts";
import { buildTenant, previewForProfile, registerTenant } from "./onboarding.ts";
import { runCycle } from "./cycle.ts";
import { loop, storePath } from "./daemon.ts";
import { Store } from "./store.ts";

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", x: "\x1b[0m" };
const tty = process.stdout.isTTY;
const col = (s: string, c: string) => (tty ? `${c}${s}${C.x}` : s);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store(storePath());

  switch (cmd) {
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
      console.log(ok ? col(`✓ ${leadId} -> ${status}`, C.g) : col(`Brak leada ${leadId}`, C.r));
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
  execute              autonomicznie zrealizuj wygrane zlecenia (deliverable)
  mark-exec <id> <O>   oceń wykonanie (ACCEPTED/REVISION/REJECTED)
  quality              model jakości wykonania (samokalibracja bramki)
  train                naucz modele scoringu z wyników (WON/LOST)
  onboard --email .. --headline ".."   auto-profil + proof-of-value [--register]`);
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
