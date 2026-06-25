// Control surface for the autonomous agent. Minimal commands so the operator
// only does what truly needs a human:
//
//   node agent/cli.ts once         # run a single cycle now
//   node agent/cli.ts loop         # run forever on the configured interval
//   node agent/cli.ts status       # store stats + source health
//   node agent/cli.ts leads [id]   # list leads (optionally for one tenant)
//   node agent/cli.ts draft <leadId>   # print the ready-to-send draft
//   node agent/cli.ts mark <leadId> <STATUS>   # WON/REJECTED/SENT...

import { trainModel } from "../packages/core/src/index.ts";
import { DEFAULT_LEARN, DEFAULT_OUTREACH, loadConfig } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { loop, storePath } from "./daemon.ts";
import { sendOutreach } from "./outreach.ts";
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
    case "train": {
      const cfg = loadConfig();
      const learn = cfg.settings.learn ?? DEFAULT_LEARN;
      console.log(col("\n  Trening modeli z wyników (WON/REPLIED vs REJECTED):\n", C.b));
      for (const t of cfg.tenants) {
        const ex = store.trainingExamples(t.id);
        if (ex.length < learn.minExamples) {
          console.log(`    ${t.id}: ${col(`za mało danych (${ex.length}/${learn.minExamples})`, C.dim)}`);
          continue;
        }
        const model = trainModel(ex, Date.now());
        store.setLearned(t.id, model);
        const top = Object.entries(model.keywordWeights).sort((a, b) => b[1] - a[1]);
        const pos = top.filter(([, w]) => w > 0).slice(0, 3).map(([k, w]) => `${k}+${w}`);
        const neg = top.filter(([, w]) => w < 0).slice(-3).map(([k, w]) => `${k}${w}`);
        console.log(`    ${col(t.id, C.b)}: ${ex.length} przykładów  ${col(pos.join(" ") || "—", C.g)}  ${col(neg.join(" ") || "", C.r)}`);
      }
      store.save();
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
      const out = cfg.settings.outreach ?? DEFAULT_OUTREACH;
      const approved = store.outbox("approved");
      if (!approved.length) { console.log(col("  Brak zaakceptowanych leadów do wysłania.", C.dim)); break; }
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const byTenant = new Map<string, typeof approved>();
      for (const l of approved) {
        const arr = byTenant.get(l.tenantId) ?? [];
        arr.push(l);
        byTenant.set(l.tenantId, arr);
      }
      let sent = 0, capped = 0;
      for (const [tenantId, leads] of byTenant) {
        const tenant = cfg.tenants.find((t) => t.id === tenantId);
        if (!tenant) continue;
        let used = store.sentCountSince(tenantId, since);
        for (const l of leads) {
          if (used >= out.dailyCapPerTenant) { capped++; continue; }
          const now = new Date().toISOString();
          const res = await sendOutreach(tenant, l, now);
          store.recordSend(tenantId, l.id, res.via, now);
          used++; sent++;
          console.log(`  ${col("→", C.g)} ${l.id} via ${res.via}  ${col(res.ref, C.dim)}`);
        }
      }
      store.save();
      console.log(col(`\n✓ Wysłano ${sent}${capped ? `, wstrzymano ${capped} (dzienny limit)` : ""}`, C.g));
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
  train                naucz modele scoringu z wyników (WON/LOST)`);
  }
}

function fail(msg: string) {
  console.error(col(msg, C.r));
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
