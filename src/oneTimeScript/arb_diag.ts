// Diagnóstico da "arbitragem" do bog_value_probe: é preço real ou cotação podre?
import dotenv from "dotenv"; dotenv.config();
import fs from "node:fs"; import path from "node:path";
import { createClient } from "@supabase/supabase-js";
const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const FROM = "2026-03-16", TO = "2026-08-18";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, { db: { schema: "hml" } });
const norm = (s: string) => s.toLowerCase().replace(/\([a-z]{2,3}\)/g,"").replace(/[^a-z0-9]/g,"");
const fieldOf = new Map<string, number>(); const bspOf = new Map<string, number>();
const csv = new Map<string, { race: string; date: string }>();
for (const f of fs.readdirSync(DIR).filter(x=>x.endsWith(".csv"))) {
  if (/place/i.test(f)) continue;
  for (const line of fs.readFileSync(path.join(DIR,f),"utf8").split("\n").slice(1)) {
    const c = line.split(","); if (c.length<17 || !(+c[7]>0)) continue;
    const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/); if (!dm) continue;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`; if (date<FROM||date>TO) continue;
    const race = `${c[1]}|${c[3]}`; fieldOf.set(race,(fieldOf.get(race)||0)+1);
    csv.set(`${date}|${norm(c[5])}`, { race, date }); bspOf.set(`${date}|${norm(c[5])}`, +c[7]);
  }
}
(async () => {
  const rc: any[] = [];
  for (let p=0;;p++){ const {data}=await db.from("racecards_hr_enriched").select("id,date")
    .gte("date",FROM).lte("date",TO).order("id").range(p*1000,p*1000+999);
    if(!data?.length)break; rc.push(...data); if(data.length<1000)break; }
  const dateOf = new Map(rc.map((r:any)=>[r.id,r.date]));
  const rh = new Map<number,string>(); const ids = rc.map((r:any)=>r.id);
  for(let i=0;i<ids.length;i+=150){ const ch=ids.slice(i,i+150);
    for(let off=0;;off+=1000){ const {data}=await db.from("race_horses_hr_enriched")
      .select("id,racecard_id,horse,non_runner").in("racecard_id",ch).range(off,off+999);
      if(!data?.length)break;
      for(const r of data as any[]){ if(r.non_runner)continue; const d=dateOf.get(r.racecard_id);
        if(d) rh.set(r.id, `${d}|${norm(r.horse)}`); }
      if(data.length<1000)break; } }
  // TODAS as cotações por cavalo (não só a melhor)
  const quotes = new Map<number, number[]>();
  for(let p=0;;p++){ const {data}=await db.from("odds_enriched").select("race_horse_id,odd")
    .order("id").range(p*1000,p*1000+999); if(!data?.length)break;
    for(const r of data as any[]){ if(!(r.odd>1))continue;
      if(!quotes.has(r.race_horse_id))quotes.set(r.race_horse_id,[]);
      quotes.get(r.race_horse_id)!.push(r.odd); }
    if(data.length<1000)break; }
  type Rn = { best:number; second:number; n:number; bsp:number };
  const per = new Map<string, Rn[]>();
  // quantos cavalos tinham preço de manhã por corrida, INCLUINDO os que não
  // aparecem no CSV (= foram retirados depois da foto das 04:00)
  const pricedInRace = new Map<string, number>();
  const raceOfHorse = new Map<number,string>();
  for(const [rhid,key] of rh){ const c=csv.get(key); if(c) raceOfHorse.set(rhid,c.race); }
  // reconstrói corrida->cavalos cotados via racecard, não via CSV
  const rcOf = new Map<number,string>();
  for(const [rhid,key] of rh){ const c=csv.get(key); if(c) rcOf.set(rhid,c.race); }
  for(const [rhid,key] of rh){ const c=csv.get(key); if(!c)continue;
    const q=(quotes.get(rhid)||[]).slice().sort((a,b)=>b-a); if(!q.length)continue;
    if(!per.has(c.race))per.set(c.race,[]);
    per.get(c.race)!.push({best:q[0],second:q.length>1?q[1]:q[0],n:q.length,bsp:bspOf.get(key)||0}); }
  const arbs:[string,Rn[],number][]=[]; const normal:[string,Rn[],number][]=[];
  for(const [race,rr] of per){ const fs2=fieldOf.get(race)||0;
    if(fs2<3||rr.length!==fs2)continue;
    const inv=rr.reduce((s,x)=>s+1/x.best,0);
    (inv<1?arbs:normal).push([race,rr,inv]); }
  const stat=(g:[string,Rn[],number][],lab:string)=>{
    const sp=g.flatMap(([,rr])=>rr.map(x=>x.best/x.second));
    const bs=g.flatMap(([,rr])=>rr.filter(x=>x.bsp>0).map(x=>x.best/x.bsp));
    const nb=g.flatMap(([,rr])=>rr.map(x=>x.n));
    const med=(a:number[])=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)]||0;};
    const mx=(a:number[])=>Math.max(...a,0);
    console.log(`  ${lab.padEnd(28)} corridas=${String(g.length).padStart(5)}  melhor/2º: mediana ${med(sp).toFixed(3)} máx ${mx(sp).toFixed(1)}  |  melhor/BSP: mediana ${med(bs).toFixed(3)} máx ${mx(bs).toFixed(1)}  |  casas/cavalo mediana ${med(nb)}`);
  };
  console.log("\n🔬 A 'arbitragem' é preço real ou cotação podre?\n");
  stat(normal,"corridas normais");
  stat(arbs,"corridas 'com arbitragem'");
  console.log("\n  Se nas 'arb' o melhor preço for muito acima do 2º e muito acima do BSP,");
  console.log("  é cotação obsoleta/errada de UMA casa — não é preço que você conseguiria pegar.\n");
  // quanto do arb some se descartar a melhor cotação e usar a 2ª
  let sobra=0;
  for(const [,rr] of arbs){ const inv=rr.reduce((s,x)=>s+1/x.second,0); if(inv<1)sobra++; }
  console.log(`  arbitragens que SOBREVIVEM usando o 2º melhor preço: ${sobra} de ${arbs.length}`);

  // ===== TESTE DA RETIRADA =====
  // Reconta por racecard: quantos cavalos NÃO-retirados tinham preço, vs quantos
  // efetivamente correram (CSV). Se nas "arb" sobra cavalo cotado que não correu,
  // o livro < 1 é fatia de probabilidade que sumiu — Rule 4, não arbitragem.
  const cotadosPorRc = new Map<number, number>(); const correramPorRc = new Map<number, string>();
  for(let i=0;i<ids.length;i+=150){ const ch=ids.slice(i,i+150);
    for(let off=0;;off+=1000){ const {data}=await db.from("race_horses_hr_enriched")
      .select("id,racecard_id,horse,non_runner").in("racecard_id",ch).range(off,off+999);
      if(!data?.length)break;
      for(const r of data as any[]){
        if(r.non_runner)continue;
        if(!(quotes.get(r.id)||[]).length)continue;
        cotadosPorRc.set(r.racecard_id,(cotadosPorRc.get(r.racecard_id)||0)+1);
        const d=dateOf.get(r.racecard_id); if(!d)continue;
        const c=csv.get(`${d}|${norm(r.horse)}`); if(c) correramPorRc.set(r.racecard_id,c.race);
      }
      if(data.length<1000)break; } }
  const arbSet=new Set(arbs.map(([r])=>r));
  let aC=0,aN=0,nC=0,nN=0,aExtra=0,nExtra=0;
  for(const [rcid,race] of correramPorRc){
    const cot=cotadosPorRc.get(rcid)||0; const corr=fieldOf.get(race)||0;
    if(cot===0||corr===0)continue;
    if(arbSet.has(race)){ aC+=cot; aN+=corr; if(cot>corr)aExtra++; }
    else { nC+=cot; nN+=corr; if(cot>corr)nExtra++; }
  }
  // TESTE 2: nº de non_runner e tamanho de campo por corrida
  const nrPorRc = new Map<number, number>(); const rcRace = new Map<number, string>();
  for(let i=0;i<ids.length;i+=150){ const ch=ids.slice(i,i+150);
    for(let off=0;;off+=1000){ const {data}=await db.from("race_horses_hr_enriched")
      .select("id,racecard_id,horse,non_runner").in("racecard_id",ch).range(off,off+999);
      if(!data?.length)break;
      for(const r of data as any[]){
        if(r.non_runner) nrPorRc.set(r.racecard_id,(nrPorRc.get(r.racecard_id)||0)+1);
        else { const d=dateOf.get(r.racecard_id); if(d){ const c=csv.get(`${d}|${norm(r.horse)}`);
               if(c) rcRace.set(r.racecard_id,c.race); } }
      }
      if(data.length<1000)break; } }
  { const arbSet2=new Set(arbs.map(([r])=>r));
    let aNr=0,aCnt=0,nNr=0,nCnt=0; const aFs:number[]=[],nFs:number[]=[];
    for(const [rcid,race] of rcRace){ const nr=nrPorRc.get(rcid)||0; const fs2=fieldOf.get(race)||0;
      if(!fs2)continue;
      if(arbSet2.has(race)){aNr+=nr;aCnt++;aFs.push(fs2);} else {nNr+=nr;nCnt++;nFs.push(fs2);} }
    const med=(a:number[])=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)]||0;};
    console.log("\n  ══ TESTE 2: retiradas e tamanho de campo ══");
    console.log(`  'arb':    ${aCnt} corridas, non_runner/corrida = ${(aNr/Math.max(aCnt,1)).toFixed(2)}, campo mediano ${med(aFs)}`);
    console.log(`  normais:  ${nCnt} corridas, non_runner/corrida = ${(nNr/Math.max(nCnt,1)).toFixed(2)}, campo mediano ${med(nFs)}`);
  }
  // TESTE 3 (o decisivo): taxa de "arbitragem" APENAS em corridas com ZERO
  // retiradas. Se o livro < 1 for arbitragem de verdade, a taxa se mantém.
  // Se for fatia de probabilidade que sumiu com a retirada, desaba.
  { const rcByRace = new Map<string, number>();
    for(const [rcid,race] of rcRace) rcByRace.set(race, rcid);
    let limpas=0, limpasArb=0, sujas=0, sujasArb=0;
    const arbSet3=new Set(arbs.map(([r])=>r));
    for(const [race,] of per){
      const fs2=fieldOf.get(race)||0; const rr=per.get(race)!;
      if(fs2<3||rr.length!==fs2)continue;
      const rcid=rcByRace.get(race); if(rcid===undefined)continue;
      const nr=nrPorRc.get(rcid)||0;
      if(nr===0){ limpas++; if(arbSet3.has(race))limpasArb++; }
      else { sujas++; if(arbSet3.has(race))sujasArb++; }
    }
    console.log("\n  ══ TESTE 3 — O DECISIVO ══");
    console.log(`  corridas SEM retirada:  ${limpas} → ${limpasArb} com livro < 1 (${(100*limpasArb/Math.max(limpas,1)).toFixed(2)}%)`);
    console.log(`  corridas COM retirada:  ${sujas} → ${sujasArb} com livro < 1 (${(100*sujasArb/Math.max(sujas,1)).toFixed(2)}%)`);
  }
  console.log("\n  ══ TESTE DA RETIRADA (cavalos cotados de manhã vs cavalos que correram) ══");
  console.log(`  corridas 'arb':     cotados ${aC}, correram ${aN}  → ${(aC-aN)} cavalos cotados a mais; ${aExtra} corridas com sobra`);
  console.log(`  corridas normais:   cotados ${nC}, correram ${nN}  → ${(nC-nN)} cavalos cotados a mais; ${nExtra} corridas com sobra`);
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
